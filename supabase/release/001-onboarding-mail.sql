-- Explicit onboarding release. Starts no jobs and sends no messages by itself.
begin;
insert into system_settings(key,value) values('portal_delivery_release','{"enabled":false,"recipients":[],"invitation_recipients":[],"automatic_invitations":false}') on conflict(key) do nothing;
create function public.parent_delivery_allowed(recipient text, kind text, payload jsonb) returns boolean language plpgsql stable security definer set search_path=public as $$
declare settings jsonb; recipient_email text:=lower(btrim(recipient));
begin
 select value into settings from system_settings where key='portal_delivery_release';
 if coalesce((settings->>'enabled')::boolean,false) is not true or not coalesce(settings->'recipients','[]'::jsonb) ? recipient_email then return false; end if;
 if kind='invitation' then
  return coalesce((payload->>'manual_release')::boolean,false) and coalesce(settings->'invitation_recipients','[]'::jsonb) ? recipient_email
   and exists(select 1 from parent_invitations i join parents p on p.id=i.parent_id where i.id::text=payload->>'invitation_id' and lower(btrim(i.email))=recipient_email and lower(btrim(p.contact_email))=recipient_email and i.consumed_at is null and i.expires_at>now() and p.archived_at is null);
 end if;
 if kind not in ('planning','attendance','correction','change','report','stamp_card') then return false; end if;
 return exists(select 1 from parents p join profiles f on f.id=p.auth_user_id join auth.users u on u.id=f.id
  where lower(btrim(p.contact_email))=recipient_email and lower(btrim(u.email))=recipient_email and u.email_confirmed_at is not null and f.role='parent' and p.archived_at is null and not p.notifications_held);
end $$;
revoke all on function public.parent_delivery_allowed(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.parent_delivery_allowed(text,text,jsonb) to service_role;
create or replace function public.hold_family_notification() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='pending' and not parent_delivery_allowed(new.recipient,new.kind,new.payload) then new.status:='held'; end if;
 return new;
end $$;
create or replace function public.claim_notifications(batch_size int default 20) returns setof public.notification_jobs language plpgsql security definer set search_path=public as $$
begin
 update notification_jobs set status='uncertain',last_error='Versandleasing abgelaufen; SMTP-Ergebnis manuell prüfen' where status='processing' and locked_at<now()-interval '10 minutes';
 return query update notification_jobs j set status='processing',locked_at=now(),lease_token=gen_random_uuid(),attempts=attempts+1
 where j.id in(select n.id from notification_jobs n where n.status='pending' and n.available_at<=now()
 and parent_delivery_allowed(n.recipient,n.kind,n.payload)
 order by n.created_at for update of n skip locked limit least(batch_size,100)) returning j.*;
end $$;
create function public.release_parent_invitation(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare p parents; invitation uuid; settings jsonb;
begin
 if not exists(select 1 from profiles where id=(input->>'actor_id')::uuid and role='admin') then raise exception 'Admin required'; end if;
 select * into p from parents where id=(input->>'parent_id')::uuid for update;
 if not found or p.archived_at is not null or not exists(select 1 from parent_stripe_customers where parent_id=p.id) then raise exception 'Valid family and Stripe mapping required'; end if;
 select value into settings from system_settings where key='portal_delivery_release';
 if coalesce((settings->>'enabled')::boolean,false) is not true or not coalesce(settings->'invitation_recipients','[]'::jsonb) ? lower(btrim(p.contact_email)) then raise exception 'Recipient not released'; end if;
 if coalesce(input->>'token_hash','') !~ '^[a-f0-9]{64}$' or coalesce(input->>'url','') !~ '^https://proacademy-portal[.]proacademy-by-ak[.]workers[.]dev/einladung[?]token=[a-zA-Z0-9_-]+$' then raise exception 'Invalid invitation link'; end if;
 update parent_invitations set expires_at=now() where parent_id=p.id and consumed_at is null;
 insert into parent_invitations(parent_id,email,token_hash,expires_at,created_by) values(p.id,p.contact_email,input->>'token_hash',now()+interval '7 days',(input->>'actor_id')::uuid) returning id into invitation;
 -- Fresh official onboarding, including formerly connected test accounts.
 update parents set notifications_held=true where id=p.id;
 insert into notification_jobs(idempotency_key,kind,recipient,payload,status)
 values('invitation:'||invitation,'invitation',p.contact_email,jsonb_build_object('url',input->>'url','parent_name',p.full_name,'invitation_id',invitation,'manual_release',true),'pending');
 insert into audit_log(actor_id,action,table_name,record_id,new_value) values((input->>'actor_id')::uuid,'INVITATION_RELEASED','parent_invitations',invitation,jsonb_build_object('parent_id',p.id,'manual',true));
 return invitation;
end $$;
revoke all on function public.release_parent_invitation(jsonb) from public,anon,authenticated;
grant execute on function public.release_parent_invitation(jsonb) to service_role;
create or replace function public.accept_invitation(invitation_hash text) returns uuid language plpgsql security definer set search_path=public as $$
declare inv parent_invitations; p parents; verified text;
begin
 select lower(btrim(email)) into verified from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if verified is null then raise exception 'Bestätigte Anmeldung erforderlich'; end if;
 select * into inv from parent_invitations where token_hash=invitation_hash and consumed_at is null and expires_at>now() for update;
 if not found or lower(btrim(inv.email))<>verified then raise exception 'Einladung ungültig oder abgelaufen'; end if;
 select * into p from parents where id=inv.parent_id for update;
 if p.archived_at is not null or lower(btrim(p.contact_email))<>verified then raise exception 'Elternkonto nicht verfügbar'; end if;
 if p.auth_user_id is not null and p.auth_user_id<>auth.uid() then raise exception 'Elternkonto bereits verbunden'; end if;
 if not exists(select 1 from parent_stripe_customers where parent_id=p.id) then raise exception 'Stripe-Zuordnung fehlt'; end if;
 if exists(select 1 from profiles where id=auth.uid() and role<>'parent') then raise exception 'Elternkonto erforderlich'; end if;
 insert into profiles(id,full_name,role) values(auth.uid(),p.full_name,'parent') on conflict(id) do nothing;
 update parents set auth_user_id=auth.uid(),notifications_held=false where id=p.id;
 update parent_invitations set consumed_at=now() where id=inv.id;
 -- Historical held notifications stay held; only future notifications are eligible.
 return inv.parent_id;
end $$;
commit;
