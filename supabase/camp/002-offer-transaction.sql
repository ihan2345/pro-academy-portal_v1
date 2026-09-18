begin;
create function public.camp_save_offer(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid:=(input->>'camp_id')::uuid; pid uuid; oid uuid; cname text;
begin
 select title into cname from public.camps where id=cid for update;
 if not found then raise exception 'Camp not found'; end if;
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
