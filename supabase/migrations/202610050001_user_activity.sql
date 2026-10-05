-- Presence is deliberately separate from profiles and their audit triggers.
create table public.user_activity (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 last_seen_at timestamptz not null default now()
);
alter table public.user_activity enable row level security;
revoke all on public.user_activity from public,anon,authenticated;
grant select on public.user_activity to authenticated;
create policy activity_admin_read on public.user_activity for select to authenticated using(public.is_admin());

create function public.touch_user_activity() returns void
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or public.current_role() is null then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 insert into public.user_activity(user_id,last_seen_at) values(auth.uid(),now())
 on conflict(user_id) do update set last_seen_at=excluded.last_seen_at
 where user_activity.last_seen_at <= now()-interval '50 seconds';
end $$;
revoke all on function public.touch_user_activity() from public,anon;
grant execute on function public.touch_user_activity() to authenticated;
