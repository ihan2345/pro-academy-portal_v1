-- Paid Stripe records occupy seats even while child details await admin review.
begin;
create function public.camp_occupied_seats(camp_id uuid, exclude_payment_id text default null) returns int language sql stable security definer set search_path=public as $$
 with snapshots as (
 select r from camp_review_snapshots s cross join lateral jsonb_array_elements(s.records) r where s.camp_id=$1
 ), payments as (
 select coalesce(b.stripe_payment_id,b.id::text) id from camp_bookings b where b.camp_id=$1 and b.status in ('paid','review') and b.stripe_payment_id is not null
 and not exists(select 1 from snapshots where r->>'payment_id'=b.stripe_payment_id and r->>'status'='refunded')
 union
 select r->>'payment_id' from snapshots where r->>'status' in ('paid','review') and coalesce(r->>'payment_id','')<>''
 ) select count(*)::int from payments where $2 is null or id<>$2
$$;
revoke all on function public.camp_occupied_seats(uuid,text) from public,anon,authenticated;
grant execute on function public.camp_occupied_seats(uuid,text) to service_role;
-- Reuse proven confirmation/import transactions and their Camp row locks.
do $$ declare name text; definition text; begin
 foreach name in array array['camp_confirm_payment','camp_import_paid_booking'] loop
 select pg_get_functiondef(('public.'||name||'(jsonb)')::regprocedure) into definition;
 definition:=replace(definition,'select count(*) into seats from public.camp_bookings where camp_id=c.id and status=''paid'';', 'seats:=public.camp_occupied_seats(c.id,input->>''payment_id'');');
 execute definition;
 end loop;
end $$;
create function public.camp_close_when_full() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform 1 from camps where id=new.camp_id for update;
 update camps set status='closed' where id=new.camp_id and status='open' and camp_occupied_seats(id)>=capacity+floor(capacity*buffer_percent/100.0)::int;
 return new;
end $$;
create trigger camp_snapshot_capacity after insert or update on public.camp_review_snapshots for each row execute function public.camp_close_when_full();
revoke all on function public.camp_close_when_full() from public,anon,authenticated;
do $$ declare definition text; begin
 select pg_get_functiondef('public.camp_reset_v0()'::regprocedure) into definition;
 definition:=replace(definition,'drop table if exists public.camp_review_snapshots;', 'drop trigger if exists camp_snapshot_capacity on public.camp_review_snapshots;
 drop function if exists public.camp_close_when_full();
 drop function if exists public.camp_occupied_seats(uuid,text);
 drop table if exists public.camp_review_snapshots;');
 execute definition;
end $$;
commit;
