-- Add assigned participants and related family Stripe accounts to the existing bearer feed.
-- Existing share tokens, event fields and access permissions remain unchanged.
create or replace function public.read_shared_trainings(share_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if share_token is null or not exists(select 1 from public.training_api_share where singleton and token=share_token) then
  return null;
 end if;
 with customer_ids as (
  -- Include legacy primary IDs and additional family accounts, without duplicates.
  select id as parent_id, stripe_customer_id from public.parents where stripe_customer_id is not null
  union
  select parent_id, stripe_customer_id from public.parent_stripe_customers
 ), customers as (
  select parent_id, jsonb_agg(stripe_customer_id order by stripe_customer_id) ids
  from customer_ids where stripe_customer_id <> '' group by parent_id
 ), player_parents as (
  select pp.player_id, jsonb_agg(jsonb_build_object(
   'parent_id',p.id,'parent_name',p.full_name,
   'stripe_customer_ids',coalesce(c.ids,'[]'::jsonb)
  ) order by p.full_name,p.id) parents
  from public.parent_players pp join public.parents p on p.id=pp.parent_id
  left join customers c on c.parent_id=p.id group by pp.player_id
 ), participants as (
  select ep.event_id,jsonb_agg(jsonb_build_object(
   'player_id',p.id,'player_name',concat_ws(' ',p.first_name,p.last_name),
   -- Canonical authenticated player route of the published portal.
   'profile_url','https://portal.proacademy-ak.com/admin/spieler/' || p.id::text,
   'parents',coalesce(pp.parents,'[]'::jsonb)
  ) order by p.first_name,p.last_name,p.id) items
  from public.event_participants ep join public.players p on p.id=ep.player_id
  left join player_parents pp on pp.player_id=p.id
  where not ep.removed_from_event group by ep.event_id
 )
 select jsonb_build_object('version',2,'generated_at',now(),'timezone','Europe/Berlin',
  'trainings',coalesce(jsonb_agg(jsonb_build_object(
   'id',e.id,'title',e.title,'event_type',e.event_type,
   'date',to_char(e.starts_at at time zone 'Europe/Berlin','YYYY-MM-DD'),
   'start_time',to_char(e.starts_at at time zone 'Europe/Berlin','HH24:MI'),
   'end_date',to_char(e.ends_at at time zone 'Europe/Berlin','YYYY-MM-DD'),
   'end_time',to_char(e.ends_at at time zone 'Europe/Berlin','HH24:MI'),
   'starts_at',e.starts_at,'ends_at',e.ends_at,
   'status',case when e.status='cancelled' then 'cancelled' when e.ends_at<=now() then 'completed' when e.starts_at<=now() then 'in_progress' else 'planned' end,
   'player_count',coalesce(jsonb_array_length(p.items),0),
   'participants',coalesce(p.items,'[]'::jsonb),
   'location',jsonb_build_object('name',l.name,'address',l.address)
  ) order by e.starts_at,e.id),'[]'::jsonb)) into result
 from public.training_events e
 join public.locations l on l.id=e.location_id
 left join participants p on p.event_id=e.id;
 return result;
end $$;
revoke all on function public.read_shared_trainings(text) from public,anon,authenticated;
grant execute on function public.read_shared_trainings(text) to service_role;
