-- Online-Zeit je Konto (Super-Admin-Ansicht /admin/online-zeit).
-- Das Portal meldet sich schon heute jede Minute, solange es sichtbar offen
-- ist (touch_user_activity, „Online“-Punkt). Neu wird dabei die Zeit seit dem
-- letzten Lebenszeichen aufsummiert, wenn es höchstens 150 Sekunden her ist.
-- Längere Pausen (Tab zu, Gerät aus) zählen nicht. Mehrere offene Tabs zählen
-- nicht doppelt. Gezählt wird erst ab Ausführung dieser Datei (counted_since),
-- frühere Zeiten sind nicht gespeichert.
-- Datenschutz: nur Summe in Sekunden, keine Seiten, IPs oder Geräte.
-- Lesen nur für Super-Admins (can_manage_features). Apply after 064.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.user_activity
 add column online_seconds bigint not null default 0 check (online_seconds>=0),
 add column counted_since timestamptz not null default now();

do $$
declare original text; changed text;
begin
 select pg_get_functiondef('public.touch_user_activity()'::regprocedure) into original;
 changed:=replace(original,
  'on conflict(user_id) do update set last_seen_at=excluded.last_seen_at',
  $new$on conflict(user_id) do update set
  online_seconds=user_activity.online_seconds+case
   when excluded.last_seen_at-user_activity.last_seen_at<=interval '150 seconds'
   then greatest(0,floor(extract(epoch from excluded.last_seen_at-user_activity.last_seen_at)))::bigint
   else 0 end,
  last_seen_at=excluded.last_seen_at$new$);
 if changed=original then raise exception 'Unexpected touch_user_activity definition'; end if;
 execute changed;
end $$;

create function public.online_time_overview() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if not can_manage_features() then raise exception 'Forbidden' using errcode='42501'; end if;
 return jsonb_build_object(
  'now', now(),
  'counted_since', (select min(counted_since) from user_activity),
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
    'user_id', p.id,
    'name', coalesce(nullif(btrim(pa.full_name),''), nullif(btrim(p.full_name),''), ''),
    'role', p.role::text,
    'parent_id', pa.id,
    'online_seconds', coalesce(a.online_seconds,0),
    'last_seen_at', a.last_seen_at,
    'counted_since', a.counted_since)
   order by coalesce(a.online_seconds,0) desc, a.last_seen_at desc nulls last)
   from profiles p
   left join user_activity a on a.user_id=p.id
   left join lateral (select q.id, q.full_name from parents q
     where q.auth_user_id=p.id and q.archived_at is null order by q.created_at limit 1) pa on true),'[]')
 );
end $$;
revoke all on function public.online_time_overview() from public,anon;
grant execute on function public.online_time_overview() to authenticated;

commit;
