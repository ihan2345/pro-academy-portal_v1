-- A bearer link with admin-only management; never store it in shared system_settings or audit payloads.
create table public.training_api_share (
 singleton boolean primary key default true check(singleton),
 token text not null check(token ~ '^[0-9a-f]{64}$'),
 updated_at timestamptz not null default now()
);
alter table public.training_api_share enable row level security;
revoke all on public.training_api_share from public,anon,authenticated;
grant select on public.training_api_share to authenticated;
create policy training_api_admin_read on public.training_api_share for select to authenticated using(public.is_admin());

create function public.manage_training_api_share(candidate text, rotate boolean default false)
returns text language plpgsql security definer set search_path=public as $$
declare result text;
begin
 if not public.is_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 if candidate is null or candidate !~ '^[0-9a-f]{64}$' then raise exception 'Invalid share token'; end if;
 insert into public.training_api_share(singleton,token) values(true,candidate) on conflict(singleton) do nothing;
 if rotate then
  update public.training_api_share set token=candidate,updated_at=now() where singleton;
 end if;
 select token into result from public.training_api_share where singleton;
 return result;
end $$;
revoke all on function public.manage_training_api_share(text,boolean) from public,anon;
grant execute on function public.manage_training_api_share(text,boolean) to authenticated;

create function public.read_shared_trainings(share_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if share_token is null or not exists(select 1 from public.training_api_share where singleton and token=share_token) then
  return null;
 end if;
 select jsonb_build_object('version',1,'generated_at',now(),'timezone','Europe/Berlin',
  'trainings',coalesce(jsonb_agg(jsonb_build_object(
   'id',e.id,'title',e.title,'event_type',e.event_type,
   'date',to_char(e.starts_at at time zone 'Europe/Berlin','YYYY-MM-DD'),
   'start_time',to_char(e.starts_at at time zone 'Europe/Berlin','HH24:MI'),
   'end_date',to_char(e.ends_at at time zone 'Europe/Berlin','YYYY-MM-DD'),
   'end_time',to_char(e.ends_at at time zone 'Europe/Berlin','HH24:MI'),
   'starts_at',e.starts_at,'ends_at',e.ends_at,
   'status',case when e.status='cancelled' then 'cancelled' when e.ends_at<=now() then 'completed' when e.starts_at<=now() then 'in_progress' else 'planned' end,
   'player_count',coalesce(p.n,0),
   'location',jsonb_build_object('name',l.name,'address',l.address)
  ) order by e.starts_at,e.id),'[]'::jsonb)) into result
 from public.training_events e
 join public.locations l on l.id=e.location_id
 left join (select event_id,count(*) n from public.event_participants where not removed_from_event group by event_id) p on p.event_id=e.id;
 return result;
end $$;
revoke all on function public.read_shared_trainings(text) from public,anon,authenticated;
grant execute on function public.read_shared_trainings(text) to service_role;
