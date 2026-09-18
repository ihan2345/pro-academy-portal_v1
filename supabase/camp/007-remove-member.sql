-- Remove only the Camp participation. Preserve payment references and family records.
begin;
create or replace function public.camp_occupied_seats(camp_id uuid, exclude_payment_id text default null) returns int language sql stable security definer set search_path=public as $$
 with snapshots as (
 select r from camp_review_snapshots s cross join lateral jsonb_array_elements(s.records) r where s.camp_id=$1
 ), payments as (
 select b.stripe_payment_id id from camp_bookings b where b.camp_id=$1 and b.status in ('paid','review') and b.stripe_payment_id is not null
 and not exists(select 1 from snapshots where r->>'payment_id'=b.stripe_payment_id and r->>'status'='refunded')
 union
 select r->>'payment_id' from snapshots where r->>'status' in ('paid','review') and coalesce(r->>'payment_id','')<>''
 and not exists(select 1 from camp_bookings b where b.camp_id=$1 and b.stripe_payment_id=r->>'payment_id' and b.status in ('cancelled','refunded'))
 ) select count(*)::int from payments where $2 is null or id<>$2
$$;
create function public.camp_remove_member(booking_id uuid, actor_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.camp_bookings;
begin
 if not exists(select 1 from profiles p where p.id=$2 and p.role='admin') then raise exception 'Admin required'; end if;
 select * into b from camp_bookings where id=$1 for update;
 if not found then raise exception 'Unknown booking'; end if;
 if b.status='cancelled' then return jsonb_build_object('ok',true); end if;
 if b.status not in ('paid','review','refunded') then raise exception 'Only completed bookings can be removed'; end if;
 perform 1 from camps where id=b.camp_id for update;
 update camp_bookings set status='cancelled', payment_details=coalesce(payment_details,'{}'::jsonb)||jsonb_build_object('removal',jsonb_build_object('actor_id',$2,'removed_at',now(),'previous_status',b.status)) where id=b.id;
 insert into audit_log(actor_id,actor_type,action,table_name,record_id,old_value,new_value,reason)
 values($2,'user','CAMP_MEMBER_REMOVED','camp_bookings',b.id,jsonb_build_object('status',b.status),jsonb_build_object('status','cancelled'),'Camp-Teilnahme durch Admin entfernt; keine Erstattung ausgelöst');
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.camp_remove_member(uuid,uuid) from public,anon,authenticated;
grant execute on function public.camp_remove_member(uuid,uuid) to service_role;
-- Keep the optional reset routine complete without changing its existing live-data protections.
do $$ declare definition text; begin
 select pg_get_functiondef('public.camp_reset_v0()'::regprocedure) into definition;
 definition:=replace(definition,'drop function public.camp_confirm_payment(jsonb);','drop function if exists public.camp_remove_member(uuid,uuid);
 drop function public.camp_confirm_payment(jsonb);');
 execute definition;
end $$;
commit;
