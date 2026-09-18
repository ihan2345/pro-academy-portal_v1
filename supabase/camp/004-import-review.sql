-- Explicit administrator import of verified existing payments. No payment creation or messaging.
begin;
alter table public.camp_bookings alter column offer_id drop not null;
alter table public.camp_bookings add column booking_origin text not null default 'checkout' check(booking_origin in ('checkout','stripe_import'));
alter table public.camp_bookings add constraint camp_booking_origin_shape check(
 (booking_origin='checkout' and offer_id is not null) or
 (booking_origin='stripe_import' and offer_id is null and stripe_payment_id is not null and stripe_session_id like 'cs_live_%'));
create table public.camp_stripe_sources (
 payment_link_id text primary key, camp_id uuid not null references public.camps(id),
 price_id text not null, product_id text not null
);
insert into public.camp_stripe_sources
 select 'plink_1UDqBARoswKHkM76Y0jzuMP7',id,'price_1UDq7IRoswKHkM76K2s5oUdr','prod_VEIiR7IlxJNrl9' from public.camps where id='872b70ea-83e2-4d3b-94cf-eda4163de393';
create table public.camp_review_drafts (
 payment_id text primary key, camp_id uuid not null references public.camps(id),
 data jsonb not null default '{}', updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
do $$ declare t text; begin
 foreach t in array array['camp_stripe_sources','camp_review_drafts'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create function public.camp_import_paid_booking(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare c public.camps; kid public.players; pid uuid:=(input->>'parent_id')::uuid;
 player uuid:=(input->>'player_id')::uuid; result uuid; born date; age_years int; camp_start date; seats int;
begin
 if not exists(select 1 from public.profiles where id=(input->>'actor_id')::uuid and role='admin') then raise exception 'Admin required'; end if;
 select * into c from public.camps where id=(input->>'camp_id')::uuid for update;
 if not found then raise exception 'Camp missing'; end if;
 if not exists(select 1 from public.camp_stripe_sources s where s.camp_id=c.id and s.payment_link_id=input->>'payment_link_id' and s.price_id=input->>'price_id' and s.product_id=input->>'product_id') then raise exception 'Unknown source'; end if;
 if (input->>'livemode')::boolean is distinct from true or input->>'payment_status' is distinct from 'paid' or
 (input->>'refunded')::boolean is distinct from false or (input->>'disputed')::boolean is distinct from false or
 (input->>'quantity')::int is distinct from 1 or input->>'currency' is distinct from 'eur' or
 coalesce((input->>'amount')::int,0)<=0 or coalesce(input->>'session_id','') not like 'cs_live_%' or
 coalesce(input->>'payment_id','') not like 'pi_%' then raise exception 'Invalid verified payment'; end if;
 perform pg_advisory_xact_lock(hashtext('camp-import:'||(input->>'payment_id')));
 select id into result from public.camp_bookings where stripe_payment_id=input->>'payment_id';
 if result is not null then
  if not exists(select 1 from public.camp_bookings where id=result and camp_id=c.id and player_id=player and parent_id=pid and booking_origin='stripe_import') then raise exception 'Payment already assigned differently'; end if;
  return result;
 end if;
 if not exists(select 1 from public.parent_players pp join public.parents p on p.id=pp.parent_id where pp.player_id=player and pp.parent_id=pid and p.archived_at is null) then raise exception 'Family link missing'; end if;
 select * into kid from public.players where id=player and archived_at is null for update;
 if not found then raise exception 'Child missing'; end if;
 born:=nullif(input->'child'->>'birth_date','')::date;
 if born is null then raise exception 'Birth date required'; end if;
 select min((value->>'starts_at')::timestamptz at time zone 'Europe/Berlin')::date into camp_start from jsonb_array_elements(c.days);
 age_years:=extract(year from age(camp_start,born));
 if born>current_date or age_years<c.min_age or age_years>c.max_age then raise exception 'Birth date outside Camp age range'; end if;
 if coalesce(btrim(input->'child'->>'first_name'),'')='' or coalesce(btrim(input->'child'->>'last_name'),'')='' or coalesce(btrim(input->'child'->>'clothing_size'),'')='' then raise exception 'Child details missing'; end if;
 if exists(select 1 from public.camp_bookings where camp_id=c.id and player_id=player and status='paid') then raise exception 'Child already booked'; end if;
 select count(*) into seats from public.camp_bookings where camp_id=c.id and status='paid';
 if seats>=c.capacity+floor(c.capacity*c.buffer_percent/100.0)::int then raise exception 'Capacity reached'; end if;
 insert into public.camp_bookings(id,camp_id,offer_id,booking_origin,parent_id,player_id,browser_token_hash,parent_data,child_data,customer_group,benefit_percent,expected_amount,currency,stripe_price_id,stripe_payment_link_id,status,stripe_session_id,stripe_payment_id,stripe_customer_id,paid_amount,paid_at,payment_details)
 values(gen_random_uuid(),c.id,null,'stripe_import',pid,player,'admin-import:'||(input->>'payment_id'),input->'parent',input->'child',input->>'customer_group',(input->>'benefit_percent')::int,(input->>'subtotal')::int,'eur',input->>'price_id',input->>'payment_link_id','paid',input->>'session_id',input->>'payment_id',nullif(input->>'customer_id',''),(input->>'amount')::int,(input->>'paid_at')::timestamptz,
 jsonb_build_object('source','stripe_import','livemode',true,'verified_at',now(),'actor_id',input->>'actor_id','stripe',input->'evidence','player_before',to_jsonb(kid))) returning id into result;
 update public.players set camp_birth_date=born,camp_gender=input->'child'->>'gender',camp_clothing_size=input->'child'->>'clothing_size' where id=player;
 if seats+1>=c.capacity+floor(c.capacity*c.buffer_percent/100.0)::int then update public.camps set status='closed' where id=c.id; end if;
 return result;
end $$;
revoke all on function public.camp_import_paid_booking(jsonb) from public,anon,authenticated;
grant execute on function public.camp_import_paid_booking(jsonb) to service_role;
create or replace function public.camp_reset_v0() returns void language plpgsql security definer set search_path=public as $camp_reset$
begin
lock table public.camps,public.camp_bookings in access exclusive mode;
do $$ begin
 if exists(select 1 from public.camp_bookings where booking_origin='stripe_import') or exists(select 1 from public.camps where payment_mode='live') or exists(select 1 from public.camp_installation where live_payments_enabled) then raise exception 'Live Camp data exists; disable feature instead of reset=v0'; end if;
 if exists(select 1 from public.parents p join public.camp_owned_rows r on r.table_name='parents' and r.record_id=p.id where p.auth_user_id is not null) then
 raise exception 'Camp family has an activated portal account; review before reset'; end if;
end $$;
drop function if exists public.camp_import_paid_booking(jsonb);
drop table public.camp_review_drafts;
drop table public.camp_stripe_sources;
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
