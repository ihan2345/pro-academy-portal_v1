-- Separate from notification and training-share settings. No link exists by default.
create table public.player_api_share (
 singleton boolean primary key default true check(singleton),
 token text not null check(token ~ '^[0-9a-f]{64}$'),
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.player_api_share enable row level security;
revoke all on public.player_api_share from public, anon, authenticated;
grant select on public.player_api_share to authenticated;
create policy player_api_admin_read on public.player_api_share for select to authenticated using(public.is_admin());

create function public.manage_player_api_share(candidate text, action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.is_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 if action not in ('create','rotate','disable') or action is null then raise exception 'Invalid action'; end if;
 if candidate is null or candidate !~ '^[0-9a-f]{64}$' then raise exception 'Invalid token'; end if;
 -- Serialize mutations, including initial creation and disable-before-create.
 perform pg_advisory_xact_lock(610150002);
 if action='disable' then
  update public.player_api_share set enabled=false,updated_at=now() where singleton;
 else
  insert into public.player_api_share(singleton,token,enabled) values(true,candidate,true)
   on conflict(singleton) do update set
    token=case when action='rotate' or not player_api_share.enabled then excluded.token else player_api_share.token end,
    enabled=true,updated_at=now();
 end if;
 select jsonb_build_object('enabled',enabled,'token',case when enabled then token else null end) into result
 from public.player_api_share where singleton;
 return coalesce(result,jsonb_build_object('enabled',false,'token',null));
end $$;
revoke all on function public.manage_player_api_share(text,text) from public,anon;
grant execute on function public.manage_player_api_share(text,text) to authenticated;

create function public.player_api_token_valid(share_token text)
returns boolean language sql security definer set search_path=public as $$
 select exists(select 1 from public.player_api_share where singleton and enabled and token=share_token)
$$;
revoke all on function public.player_api_token_valid(text) from public,anon,authenticated;
grant execute on function public.player_api_token_valid(text) to service_role;
