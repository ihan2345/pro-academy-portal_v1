-- Explicit release preparation only. Does not enable live payments, email, jobs or webhooks.
begin;
alter table public.camps add column payment_mode text not null default 'test' check(payment_mode in ('test','live'));
alter table public.camp_installation add column live_payments_enabled boolean not null default false;
update public.camp_installation set version='v2';
create index camp_bookings_browser on public.camp_bookings(browser_token_hash, created_at desc);
create index camp_bookings_camp_status on public.camp_bookings(camp_id,status);
create index camp_bookings_parent on public.camp_bookings(parent_id);
create or replace function public.camp_confirm_payment(input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.camp_bookings; c public.camps; pid uuid; kid uuid; rid uuid; reason text; seats int; cap int;
begin
 select * into b from public.camp_bookings where id=(input->>'booking_id')::uuid for update;
 if not found then raise exception 'Unknown booking'; end if;
 select * into c from public.camps where id=b.camp_id for update;
 if (input->>'livemode')::boolean is distinct from (c.payment_mode='live') then raise exception 'Wrong payment mode'; end if;
 if c.payment_mode='live' and not exists(select 1 from public.camp_installation where live_payments_enabled) then raise exception 'Live payments not released'; end if;
 if b.stripe_session_id is not null then
  if b.stripe_session_id<>input->>'session_id' then raise exception 'Booking already has another payment; manual review required'; end if;
  return jsonb_build_object('status',b.status,'booking_id',b.id);
 end if;
 if b.status<>'draft' then raise exception 'Booking cannot be confirmed'; end if;
 if input->>'payment_status' is distinct from 'paid' or
 input->>'price_id' is distinct from b.stripe_price_id or input->>'payment_link_id' is distinct from b.stripe_payment_link_id or
 input->>'currency' is distinct from b.currency or (input->>'quantity')::int is distinct from 1 or (input->>'subtotal')::int is distinct from b.expected_amount or
 (input->>'total')::int is null or (input->>'total')::int<0 or coalesce(input->>'session_id','') not like (case when c.payment_mode='live' then 'cs_live_%' else 'cs_test_%' end) or coalesce(input->>'payment_id','')='' then raise exception 'Invalid verified payment'; end if;
 select * into c from public.camps where id=b.camp_id for update;
 perform pg_advisory_xact_lock(hashtext('camp-family:'||lower(b.parent_data->>'email')));
 if coalesce((input->>'refunded')::boolean,false) then
  update public.camp_bookings set status='refunded', stripe_session_id=input->>'session_id',stripe_payment_id=input->>'payment_id',paid_amount=(input->>'total')::int,payment_details=input,paid_at=now(),review_reason='Vollständige Erstattung in Stripe bestätigt' where id=b.id;
  return jsonb_build_object('status','refunded','booking_id',b.id);
 end if;
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

create or replace function public.camp_save_offer(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid:=(input->>'camp_id')::uuid; pid uuid; oid uuid; cname text;
begin
 select title into cname from public.camps where id=cid for update;
 if not found then raise exception 'Camp not found'; end if;
 if not exists(select 1 from public.camps where id=cid and (input->>'livemode')::boolean is not distinct from (payment_mode='live')) then raise exception 'Wrong offer mode'; end if;
 select id into oid from public.camp_offers where camp_id=cid and kind=input->>'kind';
 if oid is not null then return oid; end if;
 insert into public.plans(name,stripe_price_id,included_units,athletics_units,generation,billing_interval,active,is_public,is_camp,camp_id)
 values(cname||case when input->>'kind'='early' then ' · Frühbucher' else '' end,input->>'stripe_price_id',0,0,'special','month',false,false,true,cid) returning id into pid;
 insert into public.camp_offers(camp_id,plan_id,kind,stripe_price_id,stripe_product_id,stripe_payment_link_id,payment_url,amount,currency,codes)
 values(cid,pid,input->>'kind',input->>'stripe_price_id',input->>'stripe_product_id',input->>'stripe_payment_link_id',input->>'payment_url',(input->>'amount')::int,input->>'currency',input->'codes') returning id into oid;
 return oid;
end $$;
revoke all on function public.camp_save_offer(jsonb) from public,anon,authenticated;
grant execute on function public.camp_save_offer(jsonb) to service_role;
create or replace function public.camp_reset_v0() returns void language plpgsql security definer set search_path=public as $camp_reset$
begin
lock table public.camps,public.camp_bookings in access exclusive mode;
do $$ begin
 if exists(select 1 from public.camps where payment_mode='live') or exists(select 1 from public.camp_installation where live_payments_enabled) then raise exception 'Live Camp data exists; disable feature instead of reset=v0'; end if;
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
