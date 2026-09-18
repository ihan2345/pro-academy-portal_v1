-- reset=v0 database rollback. Restrictive FKs deliberately stop unsafe deletion.
begin;
lock table public.camps,public.camp_bookings in access exclusive mode;
do $$ declare imported boolean; begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='camp_bookings' and column_name='booking_origin') then
 execute 'select exists(select 1 from public.camp_bookings where booking_origin=''stripe_import'')' into imported;
 if imported then raise exception 'Live imports exist; disable feature instead of reset=v0'; end if; end if;
 if exists(select 1 from public.camps c where to_jsonb(c)->>'payment_mode'='live') or exists(select 1 from public.camp_installation i where to_jsonb(i)->>'live_payments_enabled'='true') then raise exception 'Live Camp data exists; disable feature instead of reset=v0'; end if;
 if exists(select 1 from public.parents p join public.camp_owned_rows r on r.table_name='parents' and r.record_id=p.id where p.auth_user_id is not null) then
 raise exception 'Camp family has an activated portal account; review before reset'; end if;
end $$;
drop function if exists public.camp_import_review_booking(jsonb);
drop function if exists public.camp_store_review(uuid,jsonb,jsonb,timestamptz,text);
drop function if exists public.camp_claim_processing(uuid);
drop table if exists public.camp_payment_events;
drop table if exists public.camp_review_snapshots;
drop table if exists public.camp_processing_lease;
drop function if exists public.camp_import_paid_booking(jsonb);
drop table if exists public.camp_review_drafts;
drop table if exists public.camp_stripe_sources;
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
commit;
