-- Local preparation only. Apply with the matching application release.
alter table public.players alter column birth_year drop not null;
alter table public.parents add column notifications_held boolean not null default false;

-- Keep the former single customer as the primary ID for backward compatibility.
create table public.parent_stripe_customers (
 id uuid primary key default gen_random_uuid(),
 parent_id uuid not null references public.parents(id),
 stripe_customer_id text not null check(stripe_customer_id like 'cus\_%'),
 billing_email text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(parent_id,stripe_customer_id)
);
create index parent_stripe_customer_lookup on public.parent_stripe_customers(stripe_customer_id);
alter table public.parent_stripe_customers enable row level security;
grant select on public.parent_stripe_customers to authenticated;
grant all on public.parent_stripe_customers to service_role;
create policy admin_read on public.parent_stripe_customers for select to authenticated using(public.is_admin());
create policy own_customer on public.parent_stripe_customers for select to authenticated using(
 parent_id in(select id from public.parents where auth_user_id=auth.uid() and archived_at is null)
);
create trigger touch_updated before update on public.parent_stripe_customers for each row execute function public.touch_updated();
create trigger audit_change after insert or update or delete on public.parent_stripe_customers for each row execute function public.audit_change();

insert into public.parent_stripe_customers(parent_id,stripe_customer_id,billing_email)
 select id,stripe_customer_id,billing_email from public.parents where stripe_customer_id is not null;
insert into public.parent_stripe_customers(parent_id,stripe_customer_id)
 select distinct parent_id,stripe_customer_id from public.subscriptions where parent_id is not null
 on conflict(parent_id,stripe_customer_id) do nothing;

create function public.sync_primary_stripe_customer() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.stripe_customer_id is not null then
  insert into public.parent_stripe_customers(parent_id,stripe_customer_id,billing_email)
  values(new.id,new.stripe_customer_id,new.billing_email)
  on conflict(parent_id,stripe_customer_id) do update set billing_email=excluded.billing_email;
 end if;
 return new;
end $$;
create trigger sync_primary_stripe_customer after insert or update of stripe_customer_id,billing_email on public.parents
 for each row execute function public.sync_primary_stripe_customer();

drop policy own_subscription on public.subscriptions;
create policy own_subscription on public.subscriptions for select to authenticated using(
 stripe_customer_id in(select stripe_customer_id from public.parent_stripe_customers)
);

create function public.family_name_key(value text) returns text language sql immutable set search_path=public as $$
 select lower(regexp_replace(btrim(value),'[[:space:]]+',' ','g'))
$$;
create index parents_family_identity on public.parents(lower(btrim(contact_email)),public.family_name_key(full_name)) where archived_at is null;

-- Only exact normalized name AND email matches share an account. No fuzzy merges.
create or replace function public.link_stripe_family(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare parent public.parents; sub public.subscriptions; candidates uuid[]; email_key text; name_key text;
begin
 email_key:=lower(btrim(input->>'email'));
 name_key:=public.family_name_key(input->>'parent_name');
 if coalesce(email_key,'')='' or coalesce(name_key,'')='' then raise exception 'Name und E-Mail erforderlich'; end if;
 -- Serialize sibling imports even when their Stripe customer IDs differ.
 perform pg_advisory_xact_lock(hashtext('family:'||email_key));
 perform pg_advisory_xact_lock(hashtext(input->>'customer_id'));
 if nullif(input->>'parent_id','') is not null then
  select * into parent from public.parents where id=(input->>'parent_id')::uuid for update;
  if not found or parent.archived_at is not null then raise exception 'Elternkonto nicht gefunden oder archiviert'; end if;
  if lower(btrim(parent.contact_email))<>email_key or public.family_name_key(parent.full_name)<>name_key then
   raise exception 'Name und E-Mail müssen zum bestehenden Elternkonto passen';
  end if;
 else
  select array_agg(id) into candidates from public.parents
   where lower(btrim(contact_email))=email_key and public.family_name_key(full_name)=name_key and archived_at is null;
  if cardinality(candidates)>1 then raise exception 'Mehrere passende Elternkonten; bestehende Eltern-ID auswählen'; end if;
  if cardinality(candidates)=1 then
   select * into parent from public.parents where id=candidates[1] for update;
  else
   insert into public.parents(full_name,contact_email,stripe_customer_id,notifications_held)
    values(btrim(input->>'parent_name'),email_key,input->>'customer_id',true) returning * into parent;
  end if;
 end if;
 select * into sub from public.subscriptions where stripe_subscription_id=input->>'subscription_id'
  and stripe_customer_id=input->>'customer_id' for update;
 if not found then raise exception 'Abonnement nicht synchronisiert'; end if;
 if sub.parent_id is not null and sub.parent_id<>parent.id then raise exception 'Abonnement bereits einem anderen Elternkonto zugeordnet'; end if;
 if not exists(select 1 from public.players where id=(input->>'player_id')::uuid and archived_at is null) then
  raise exception 'Aktives Kind nicht gefunden';
 end if;
 if exists(select 1 from public.subscription_players where subscription_id=sub.id and stripe_item_id=input->>'item_id' and player_id<>(input->>'player_id')::uuid) then
  raise exception 'Abonnement-Item bereits einem anderen Kind zugeordnet';
 end if;
 update public.parents set notifications_held=true,stripe_customer_id=coalesce(stripe_customer_id,input->>'customer_id') where id=parent.id;
 insert into public.parent_stripe_customers(parent_id,stripe_customer_id) values(parent.id,input->>'customer_id') on conflict do nothing;
 insert into public.parent_players(parent_id,player_id) values(parent.id,(input->>'player_id')::uuid) on conflict do nothing;
 insert into public.subscription_players(subscription_id,stripe_item_id,player_id) values(sub.id,input->>'item_id',(input->>'player_id')::uuid) on conflict do nothing;
 update public.subscriptions set parent_id=parent.id where id=sub.id;
 insert into public.audit_log(actor_id,actor_type,action,table_name,record_id,new_value)
  values((input->>'actor_id')::uuid,'user','STRIPE_LINK','parents',parent.id,input-'token');
 perform public.queue_parent_invitation(jsonb_build_object('parent_id',parent.id,'actor_id',input->>'actor_id'));
 return parent.id;
end $$;

-- Held mail is visible in the outbox but never eligible for the delivery worker.
alter table public.notification_jobs drop constraint notification_jobs_status_check;
alter table public.notification_jobs add constraint notification_jobs_status_check
 check(status in ('held','pending','processing','sent','failed','uncertain'));
create function public.hold_family_notification() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='pending' and exists(select 1 from public.parents where notifications_held
  and lower(btrim(contact_email))=lower(btrim(new.recipient))) then new.status:='held'; end if;
 return new;
end $$;
create trigger hold_family_notification before insert or update on public.notification_jobs
 for each row execute function public.hold_family_notification();

create function public.hold_existing_family_notifications() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.notifications_held then
  update public.notification_jobs set status='held' where status='pending'
   and lower(btrim(recipient))=lower(btrim(new.contact_email));
 end if;
 return new;
end $$;
create trigger hold_existing_family_notifications after insert or update of notifications_held,contact_email on public.parents
 for each row execute function public.hold_existing_family_notifications();

create or replace function public.claim_notifications(batch_size int default 20) returns setof public.notification_jobs language plpgsql security definer set search_path=public as $$
begin
 update public.notification_jobs set status='uncertain',last_error='Versandleasing abgelaufen; SMTP-Ergebnis manuell prüfen'
  where status='processing' and locked_at<now()-interval '10 minutes';
 return query update public.notification_jobs j set status='processing',locked_at=now(),lease_token=gen_random_uuid(),attempts=attempts+1
 where j.id in(select n.id from public.notification_jobs n where n.status='pending' and n.available_at<=now()
  and not exists(select 1 from public.parents p where p.notifications_held and lower(btrim(p.contact_email))=lower(btrim(n.recipient)))
  order by n.created_at for update of n skip locked limit least(batch_size,100)) returning j.*;
end $$;

-- Store only the invitation intent. A fresh, expiring link belongs to the later release step.
create function public.queue_parent_invitation(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare p public.parents; job uuid;
begin
 select * into p from public.parents where id=(input->>'parent_id')::uuid for update;
 if not found or p.archived_at is not null or not exists(select 1 from public.parent_stripe_customers where parent_id=p.id) then
  raise exception 'Gültige Stripe-Zuordnung erforderlich';
 end if;
 update public.parents set notifications_held=true where id=p.id;
 insert into public.notification_jobs(idempotency_key,kind,recipient,payload,status)
  values('held-invitation:'||p.id,'invitation',p.contact_email,jsonb_build_object('parent_id',p.id,'parent_name',p.full_name),'held')
  on conflict(idempotency_key) do update set recipient=excluded.recipient,payload=excluded.payload
   where notification_jobs.status='held'
  returning id into job;
 if job is null then raise exception 'Einladung bereits zur Verarbeitung freigegeben'; end if;
 insert into public.audit_log(actor_id,actor_type,action,table_name,record_id,new_value)
  values((input->>'actor_id')::uuid,'user','INVITATION_HELD','notification_jobs',job,jsonb_build_object('parent_id',p.id,'status','held'));
 return job;
end $$;

revoke execute on function public.sync_primary_stripe_customer(),public.hold_family_notification(),public.hold_existing_family_notifications(),public.queue_parent_invitation(jsonb) from public,anon,authenticated;
grant execute on function public.queue_parent_invitation(jsonb) to service_role;
revoke execute on function public.family_name_key(text) from public,anon;
grant execute on function public.family_name_key(text) to authenticated,service_role;
