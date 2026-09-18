-- Optional Camp extension. Apply explicitly; never through an automatic deployment.
begin;
create table public.camp_installation (
 id boolean primary key default true check(id), version text not null default 'v1',
 original_allowances text not null, installed_at timestamptz not null default now()
);
insert into public.camp_installation(id,original_allowances)
 select true,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.plans'::regclass and conname='plan_allowances';
do $$ begin if not exists(select 1 from public.camp_installation) then raise exception 'Expected plans baseline missing'; end if; end $$;
create table public.camps (
 id uuid primary key default gen_random_uuid(), title text not null, location text not null,
 description text not null default '', capacity int not null check(capacity between 1 and 1000),
 buffer_percent int not null default 10 check(buffer_percent between 0 and 20),
 min_age int not null default 5, max_age int not null default 18 check(max_age>=min_age),
 status text not null default 'draft' check(status in ('draft','open','closed','archived')),
 days jsonb not null check(jsonb_typeof(days)='array' and jsonb_array_length(days)>0),
 early_bird_until timestamptz, created_at timestamptz not null default now()
);
alter table public.plans add column camp_benefit_percent int check(camp_benefit_percent in (10,15,20));
alter table public.plans add column is_camp boolean default null;
alter table public.plans add column camp_id uuid references public.camps(id);
alter table public.plans add constraint camp_plan_shape check(
 (is_camp is true and camp_id is not null and included_units=0 and athletics_units=0 and not is_public)
 or (is_camp is not true and camp_id is null));
alter table public.plans drop constraint plan_allowances;
do $$ declare original text; begin
 select original_allowances into original from public.camp_installation;
 execute 'alter table public.plans add constraint plan_allowances CHECK ((is_camp IS TRUE) OR (' || substring(original from 8 for length(original)-8) || '))';
end $$;
alter table public.players add column camp_birth_date date;
alter table public.players add column camp_gender text;
alter table public.players add column camp_clothing_size text;
create table public.camp_offers (
 id uuid primary key default gen_random_uuid(), camp_id uuid not null references public.camps(id),
 plan_id uuid not null unique references public.plans(id), kind text not null check(kind in ('main','early')),
 stripe_price_id text not null, stripe_product_id text not null, stripe_payment_link_id text not null,
 payment_url text not null, amount int not null check(amount>0), currency text not null default 'eur',
 codes jsonb not null default '{}', unique(camp_id,kind), unique(stripe_payment_link_id)
);
create table public.camp_bookings (
 id uuid primary key, camp_id uuid not null references public.camps(id), offer_id uuid not null references public.camp_offers(id),
 parent_id uuid references public.parents(id), player_id uuid references public.players(id),
 browser_token_hash text not null, parent_data jsonb not null, child_data jsonb not null,
 customer_group text not null check(customer_group in ('subscriber','former','new')),
 benefit_percent int not null default 0 check(benefit_percent in (0,10,15,20)),
 expected_amount int not null, currency text not null, stripe_price_id text not null, stripe_payment_link_id text not null,
 status text not null default 'draft' check(status in ('draft','paid','review','cancelled','refunded')),
 stripe_session_id text unique, stripe_payment_id text unique, stripe_customer_id text,
 paid_amount int, payment_details jsonb, paid_at timestamptz, review_reason text,
 invitation_requested_at timestamptz, created_at timestamptz not null default now()
);
create unique index camp_one_paid_child on public.camp_bookings(camp_id,player_id) where status='paid';
create table public.camp_reports (
 id uuid primary key default gen_random_uuid(), booking_id uuid not null unique references public.camp_bookings(id),
 content text not null, visible_to_parent boolean not null default false, updated_at timestamptz not null default now()
);
create table public.camp_owned_rows (table_name text not null,record_id uuid not null,primary key(table_name,record_id));
create table public.camp_stripe_assets (id text primary key,kind text not null,camp_id uuid references public.camps(id), created_at timestamptz not null default now());
-- All Camp access goes through local server routes with explicit session/ownership checks.
-- No new anonymous or authenticated REST grants, no triggers/jobs on existing workflows.
do $$ declare t text; begin
 foreach t in array array['camp_installation','camps','camp_offers','camp_bookings','camp_reports','camp_owned_rows','camp_stripe_assets'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

-- One transaction per verified payment; this function is service-role only.
create function public.camp_confirm_payment(input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.camp_bookings; c public.camps; pid uuid; kid uuid; rid uuid; reason text; seats int; cap int;
begin
 select * into b from public.camp_bookings where id=(input->>'booking_id')::uuid for update;
 if not found then raise exception 'Unknown booking'; end if;
 if b.stripe_session_id is not null then
  if b.stripe_session_id<>input->>'session_id' then raise exception 'Booking already has another payment; manual review required'; end if;
  return jsonb_build_object('status',b.status,'booking_id',b.id);
 end if;
 if b.status<>'draft' then raise exception 'Booking cannot be confirmed'; end if;
 if (input->>'livemode')::boolean is distinct from false or input->>'payment_status'<>'paid' or
 input->>'price_id'<>b.stripe_price_id or input->>'payment_link_id'<>b.stripe_payment_link_id or
 input->>'currency'<>b.currency or (input->>'quantity')::int<>1 or (input->>'subtotal')::int<>b.expected_amount or
 coalesce(input->>'session_id','')='' or coalesce(input->>'payment_id','')='' then raise exception 'Invalid verified payment'; end if;
 select * into c from public.camps where id=b.camp_id for update;
 perform pg_advisory_xact_lock(hashtext('camp-family:'||lower(b.parent_data->>'email')));
 reason:=nullif(input->>'review_reason','');
 select count(*) into seats from public.camp_bookings where camp_id=c.id and status='paid';
 cap:=c.capacity+floor(c.capacity*c.buffer_percent/100.0)::int;
 if seats>=cap then reason:='Kapazität erreicht; bezahlte Buchung manuell klären'; end if;
 if b.player_id is not null and exists(select 1 from public.camp_bookings where camp_id=c.id and player_id=b.player_id and status='paid') then reason:='Kind bereits gebucht; zweite Zahlung prüfen'; end if;
 if b.parent_id is not null and b.player_id is not null and not exists(select 1 from public.parents p join public.parent_players pp on pp.parent_id=p.id join public.players k on k.id=pp.player_id where p.id=b.parent_id and k.id=b.player_id and p.archived_at is null and k.archived_at is null) then reason:='Eltern-Kind-Zuordnung hat sich geändert'; end if;
 if b.parent_id is null and exists(select 1 from public.parents where lower(btrim(contact_email))=lower(btrim(b.parent_data->>'email')) and archived_at is null) then reason:='Bestehender Kontakt: Zuordnung nach Anmeldung oder durch Admin prüfen'; end if;
 pid:=b.parent_id; kid:=b.player_id;
 if reason is null and pid is null then
  -- No email-based merge, no invitation trigger and no auth account creation.
  insert into public.parents(full_name,contact_email,notifications_held) values(b.parent_data->>'name',lower(b.parent_data->>'email'),true) returning id into pid;
  insert into public.camp_owned_rows values('parents',pid);
 end if;
 if reason is null and kid is null then
  if not exists(select 1 from public.camp_owned_rows where table_name='parents' and record_id=pid) then raise exception 'Guest family not owned by Camp'; end if;
  select k.id into kid from public.players k join public.parent_players pp on pp.player_id=k.id where pp.parent_id=pid and k.first_name=b.child_data->>'first_name' and k.last_name=b.child_data->>'last_name' and k.camp_birth_date=(b.child_data->>'birth_date')::date limit 1;
  if kid is not null then
   reason:='Kind bereits vorhanden; Zuordnung und mögliche Doppelbuchung prüfen';
  else
  insert into public.players(first_name,last_name,birth_year,camp_birth_date,camp_gender,camp_clothing_size)
   values(b.child_data->>'first_name',b.child_data->>'last_name',extract(year from (b.child_data->>'birth_date')::date)::int,(b.child_data->>'birth_date')::date,b.child_data->>'gender',b.child_data->>'clothing_size') returning id into kid;
  insert into public.camp_owned_rows values('players',kid);
  insert into public.parent_players(parent_id,player_id) values(pid,kid) returning id into rid;
  insert into public.camp_owned_rows values('parent_players',rid);
  end if;
 end if;
 if reason is null then
  update public.players set camp_birth_date=coalesce(camp_birth_date,(b.child_data->>'birth_date')::date),camp_gender=b.child_data->>'gender',camp_clothing_size=b.child_data->>'clothing_size' where id=kid;
 end if;
 if reason is null and nullif(input->>'customer_id','') is not null and not exists(select 1 from public.parent_stripe_customers where parent_id=pid and stripe_customer_id=input->>'customer_id') then
  if exists(select 1 from public.parent_stripe_customers where parent_id<>pid and stripe_customer_id=input->>'customer_id') then raise exception 'Stripe customer already belongs to another family'; end if;
  insert into public.parent_stripe_customers(parent_id,stripe_customer_id) values(pid,input->>'customer_id') returning id into rid;
  insert into public.camp_owned_rows values('parent_stripe_customers',rid);
 end if;
 update public.camp_bookings set parent_id=pid,player_id=kid,status=case when reason is null then 'paid' else 'review' end,
 stripe_session_id=input->>'session_id',stripe_payment_id=input->>'payment_id',stripe_customer_id=nullif(input->>'customer_id',''),
 paid_amount=(input->>'total')::int,paid_at=now(),payment_details=input,review_reason=reason where id=b.id;
 if reason is null and seats+1>=cap then update public.camps set status='closed' where id=c.id; end if;
 return jsonb_build_object('status',case when reason is null then 'paid' else 'review' end,'booking_id',b.id);
end $$;
revoke all on function public.camp_confirm_payment(jsonb) from public,anon,authenticated;
grant execute on function public.camp_confirm_payment(jsonb) to service_role;

-- Narrow, service-only rollback; no general SQL execution capability.
create function public.camp_reset_v0() returns void language plpgsql security definer set search_path=public as $camp_reset$
begin
lock table public.camps,public.camp_bookings in access exclusive mode;
do $$ begin
 if exists(select 1 from public.parents p join public.camp_owned_rows r on r.table_name='parents' and r.record_id=p.id where p.auth_user_id is not null) then
 raise exception 'Camp family has an activated portal account; review before reset'; end if;
end $$;
drop function if exists public.camp_save_offer(jsonb);
drop function public.camp_confirm_payment(jsonb);
drop table public.camp_reports;
drop table public.camp_bookings;
drop table public.camp_offers;
delete from public.parent_stripe_customers where id in(select record_id from public.camp_owned_rows where table_name='parent_stripe_customers');
delete from public.parent_players where id in(select record_id from public.camp_owned_rows where table_name='parent_players');
delete from public.players where id in(select record_id from public.camp_owned_rows where table_name='players');
delete from public.parents where id in(select record_id from public.camp_owned_rows where table_name='parents');
delete from public.plans where is_camp is true;
alter table public.plans drop constraint plan_allowances;
alter table public.plans drop constraint camp_plan_shape;
alter table public.plans drop column camp_id,drop column is_camp,drop column camp_benefit_percent;
do $$ declare original text; begin
 select original_allowances into original from public.camp_installation;
 execute 'alter table public.plans add constraint plan_allowances '||original;
end $$;
alter table public.players drop column camp_birth_date,drop column camp_gender,drop column camp_clothing_size;
drop table public.camp_stripe_assets;
drop table public.camp_owned_rows;
drop table public.camps;
drop table public.camp_installation;
drop function if exists public.camp_reset_v0();
-- Keep the existing audit history; no unrelated rows, auth users or jobs are removed.

end $camp_reset$;
revoke all on function public.camp_reset_v0() from public,anon,authenticated;
grant execute on function public.camp_reset_v0() to service_role;
commit;
