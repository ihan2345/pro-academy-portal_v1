-- Prepared for release. No cron, webhook registration, mail or enablement flags.
begin;
create table public.camp_review_snapshots (
 payment_link_id text primary key,
 camp_id uuid not null references public.camps(id),
 records jsonb not null default '[]' check(jsonb_typeof(records)='array'),
 checked_at timestamptz,
 attempted_at timestamptz,
 error text
);
create table public.camp_payment_events (
 event_id text primary key,
 camp_id uuid not null references public.camps(id),
 payment_link_id text not null,
 session_id text not null,
 received_at timestamptz not null default now(),
 processed_at timestamptz
);
create index camp_payment_events_pending on public.camp_payment_events(payment_link_id,received_at) where processed_at is null;
create table public.camp_processing_lease (
 id boolean primary key default true check(id),
 token uuid not null,
 expires_at timestamptz not null
);
do $$ declare t text; begin
 foreach t in array array['camp_review_snapshots','camp_payment_events','camp_processing_lease'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create function public.camp_claim_processing(owner uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into camp_processing_lease(id,token,expires_at) values(true,owner,now()+interval '10 minutes')
 on conflict(id) do update set token=excluded.token,expires_at=excluded.expires_at
 where camp_processing_lease.expires_at<now() or camp_processing_lease.token=owner;
 return found;
end $$;
-- Fenced, atomic snapshots: failed or overlapping fetches cannot erase the last complete list.
create function public.camp_store_review(owner uuid, source jsonb, rows jsonb, started timestamptz, failure text default null) returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from camp_processing_lease where token=owner and expires_at>now() for update;
 if not found then raise exception 'Camp processing lease expired'; end if;
 if not exists(select 1 from camps where id=(source->>'camp_id')::uuid and payment_mode='live') then raise exception 'Live Camp required'; end if;
 if not exists(select 1 from camp_stripe_sources where camp_id=(source->>'camp_id')::uuid and payment_link_id=source->>'payment_link_id')
 and not exists(select 1 from camp_offers where camp_id=(source->>'camp_id')::uuid and stripe_payment_link_id=source->>'payment_link_id') then raise exception 'Unknown Camp source'; end if;
 insert into camp_review_snapshots(payment_link_id,camp_id,records,checked_at,attempted_at,error)
 values(source->>'payment_link_id',(source->>'camp_id')::uuid,case when failure is null then rows else '[]'::jsonb end,case when failure is null then now() end,started,failure)
 on conflict(payment_link_id) do update set
 records=case when failure is null then excluded.records else camp_review_snapshots.records end,
 checked_at=case when failure is null then excluded.checked_at else camp_review_snapshots.checked_at end,
 attempted_at=excluded.attempted_at,error=excluded.error
 where camp_review_snapshots.camp_id=excluded.camp_id and (camp_review_snapshots.attempted_at is null or camp_review_snapshots.attempted_at<=excluded.attempted_at);
 if not found then raise exception 'Source belongs to another Camp'; end if;
 if failure is null then
 update camp_payment_events set processed_at=now() where payment_link_id=source->>'payment_link_id' and camp_id=(source->>'camp_id')::uuid and received_at<=started and processed_at is null;
 end if;
end $$;
revoke all on function public.camp_claim_processing(uuid),public.camp_store_review(uuid,jsonb,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function public.camp_claim_processing(uuid),public.camp_store_review(uuid,jsonb,jsonb,timestamptz,text) to service_role;
-- The existing importer remains the final authority; family creation rolls back if it fails.
create function public.camp_import_review_booking(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare pid uuid; kid uuid; rid uuid; result uuid; email text; customer text:=nullif(input->>'customer_id',''); prior camp_bookings;
begin
 if not exists(select 1 from profiles where id=(input->>'actor_id')::uuid and role='admin') then raise exception 'Admin required'; end if;
 if input->'new_parent' is null or input->'new_parent'='null'::jsonb then return camp_import_paid_booking(input); end if;
 if nullif(input->>'parent_id','') is not null or nullif(input->>'player_id','') is not null then raise exception 'Choose existing or new family'; end if;
 email:=lower(btrim(input->'new_parent'->>'email'));
 if coalesce(email,'') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' or coalesce(btrim(input->'new_parent'->>'name'),'')='' then raise exception 'Parent details missing'; end if;
 -- Use the same lock order as the existing importer (Camp, payment), then family.
 perform 1 from camps where id=(input->>'camp_id')::uuid for update;
 perform pg_advisory_xact_lock(hashtext('camp-import:'||(input->>'payment_id')));
 select * into prior from camp_bookings where stripe_payment_id=input->>'payment_id';
 if found then
  if prior.camp_id<>(input->>'camp_id')::uuid or prior.booking_origin<>'stripe_import' or lower(prior.parent_data->>'email')<>email or prior.child_data<>input->'child' then raise exception 'Payment already assigned differently'; end if;
  return prior.id;
 end if;
 perform pg_advisory_xact_lock(hashtext('camp-family:'||email));
 if exists(select 1 from parents where lower(btrim(contact_email))=email) then raise exception 'Existing contact: select family instead'; end if;
 if customer is not null then
  perform pg_advisory_xact_lock(hashtext('camp-customer:'||customer));
  if exists(select 1 from parent_stripe_customers where stripe_customer_id=customer) or exists(select 1 from parents where stripe_customer_id=customer) then raise exception 'Stripe customer already assigned'; end if;
 end if;
 insert into parents(full_name,contact_email,notifications_held) values(btrim(input->'new_parent'->>'name'),email,true) returning id into pid;
 insert into camp_owned_rows values('parents',pid);
 insert into players(first_name,last_name,birth_year,camp_birth_date,camp_gender,camp_clothing_size) values(input->'child'->>'first_name',input->'child'->>'last_name',extract(year from (input->'child'->>'birth_date')::date)::int,(input->'child'->>'birth_date')::date,input->'child'->>'gender',input->'child'->>'clothing_size') returning id into kid;
 insert into camp_owned_rows values('players',kid);
 insert into parent_players(parent_id,player_id) values(pid,kid) returning id into rid;
 insert into camp_owned_rows values('parent_players',rid);
 result:=camp_import_paid_booking(input || jsonb_build_object('parent_id',pid,'player_id',kid,'parent',jsonb_build_object('name',btrim(input->'new_parent'->>'name'),'email',email,'phone',input->'new_parent'->>'phone'),'customer_group','new','benefit_percent',0));
 if customer is not null then
  insert into parent_stripe_customers(parent_id,stripe_customer_id) values(pid,customer) returning id into rid;
  insert into camp_owned_rows values('parent_stripe_customers',rid);
 end if;
 return result;
end $$;
revoke all on function public.camp_import_review_booking(jsonb) from public,anon,authenticated;
grant execute on function public.camp_import_review_booking(jsonb) to service_role;
do $reset_upgrade$
declare definition text;
begin
 select pg_get_functiondef('public.camp_reset_v0()'::regprocedure) into definition;
 definition:=replace(definition,'drop function if exists public.camp_import_paid_booking(jsonb);',
 'drop function if exists public.camp_import_review_booking(jsonb);
 drop function if exists public.camp_store_review(uuid,jsonb,jsonb,timestamptz,text);
 drop function if exists public.camp_claim_processing(uuid);
 drop table if exists public.camp_payment_events;
 drop table if exists public.camp_review_snapshots;
 drop table if exists public.camp_processing_lease;
 drop function if exists public.camp_import_paid_booking(jsonb);');
 execute definition;
end $reset_upgrade$;
commit;
