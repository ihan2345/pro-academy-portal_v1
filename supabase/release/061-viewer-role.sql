-- Release 061: Lese-Rolle „Einsicht“ für Mitarbeiter und Außenberater.
--
-- Die Rolle sieht (fast) alles wie ein Admin, kann aber nichts ändern.
-- Kinder und Eltern erscheinen nur als Initialen + Jahrgang + Kennung,
-- außer der Admin schaltet für diese Person „Klarnamen sehen“ frei.
--
-- Sicherheit:
--   * Die Rolle bekommt in der Datenbank KEINE Lese- oder Schreibrechte
--     (is_team()/is_admin() bleiben false). Ein direkter Zugriff mit dem
--     eigenen Anmelde-Token liefert also nur das eigene Profil.
--   * Das Portal liest die Daten serverseitig und kürzt die Namen, bevor sie
--     den Browser erreichen. Jede Änderung lehnt der Server ab.
--
-- Ohne diese Release funktioniert das Portal unverändert weiter; die
-- Verwaltung der Lese-Rolle unter /admin/mitarbeiter meldet dann nur, dass
-- die Release fehlt.

-- Muss vor dem Block stehen: neue Enum-Werte lassen sich in derselben
-- Transaktion nicht benutzen. Alle Funktionen unten vergleichen deshalb als Text.
alter type public.app_role add value if not exists 'viewer';

begin;

create table if not exists public.viewer_access (
  id uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null default '',
  clear_names boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.viewer_access enable row level security;
drop policy if exists admin_read on public.viewer_access;
create policy admin_read on public.viewer_access for select to authenticated using (public.is_admin());
drop policy if exists own_viewer_access on public.viewer_access;
create policy own_viewer_access on public.viewer_access for select to authenticated using (id = auth.uid());
revoke insert, update, delete on public.viewer_access from authenticated;
grant select on public.viewer_access to authenticated;
grant all on public.viewer_access to service_role;
drop trigger if exists touch_updated on public.viewer_access;
create trigger touch_updated before update on public.viewer_access for each row execute function public.touch_updated();
drop trigger if exists audit_change on public.viewer_access;
create trigger audit_change after insert or update or delete on public.viewer_access for each row execute function public.audit_change();

-- Inaktive Lese-Konten verlieren den Zugang sofort (wie inaktive Coaches).
create or replace function public.current_role() returns public.app_role language sql stable security definer set search_path=public as $$
 select case
  when p.role::text='staff' and not exists(select 1 from public.staff_profiles s where s.id=p.id and s.active) then null
  when p.role::text='viewer' and not exists(select 1 from public.viewer_access v where v.id=p.id and v.active) then null
  else p.role end
 from public.profiles p where p.id=auth.uid()
$$;

-- Admin legt ein Lese-Konto an oder ändert es (per E-Mail des Kontos).
create or replace function public.set_viewer_access(target_email text, name text, clear_names boolean, active boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare target uuid; old_role text;
begin
 if not public.is_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 select u.id into target from auth.users u where lower(u.email)=lower(btrim(target_email)) limit 1;
 if target is null then raise exception 'Zu dieser E-Mail gibt es noch kein Konto.'; end if;
 if target=auth.uid() then raise exception 'Eigene Rolle nicht ändern'; end if;
 select role::text into old_role from public.profiles where id=target;
 if old_role in ('staff','admin') then
  raise exception 'Dieses Konto ist schon Coach oder Admin. Bitte eine eigene E-Mail für den Lesezugriff nutzen.';
 end if;
 if exists(select 1 from public.parents p where p.auth_user_id=target) then
  raise exception 'Dieses Konto gehört zu einem Elternprofil. Bitte eine eigene E-Mail für den Lesezugriff nutzen.';
 end if;
 insert into public.profiles(id,role,full_name) values(target,'viewer',coalesce(nullif(btrim(name),''),''))
  on conflict(id) do update set role='viewer', full_name=coalesce(nullif(btrim(excluded.full_name),''),public.profiles.full_name);
 insert into public.viewer_access(id,display_name,clear_names,active,created_by)
  values(target,coalesce(btrim(name),''),coalesce(set_viewer_access.clear_names,false),coalesce(set_viewer_access.active,true),auth.uid())
  on conflict(id) do update set display_name=excluded.display_name, clear_names=excluded.clear_names, active=excluded.active;
 return target;
end $$;

-- Liste für /admin/mitarbeiter (mit Login-E-Mail, nur für Admins).
create or replace function public.list_viewer_access()
returns table(id uuid, email text, display_name text, clear_names boolean, active boolean, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 return query select v.id, u.email::text, v.display_name, v.clear_names, v.active, v.created_at, u.last_sign_in_at
  from public.viewer_access v join auth.users u on u.id=v.id order by v.display_name, u.email;
end $$;

revoke all on function public.set_viewer_access(text,text,boolean,boolean), public.list_viewer_access() from public, anon;
grant execute on function public.set_viewer_access(text,text,boolean,boolean), public.list_viewer_access() to authenticated, service_role;

commit;
