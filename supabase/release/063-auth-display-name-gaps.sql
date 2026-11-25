-- Display name: Lücken aus 059 schließen.
-- 059 schreibt den Namen ins Auth-Konto, wenn ein Elternteil verknüpft wird
-- oder Namen ändern. Zwei Wege fehlten:
--   1. Neue Login-Konten, deren Elternteil (noch) nicht verknüpft ist
--      (Shop-Login, Gast-Zugangslink, Login bei ausgeschalteter
--      Selbstaktivierung, Einladung noch nicht angenommen). Diese Konten
--      bekommen den Namen jetzt direkt beim Anlegen aus dem Elternteil mit
--      derselben E-Mail (nur eindeutig, nicht archiviert).
--   2. Neu angelegte Portal-Profile (z. B. Einsicht-Rolle, Team), bisher nur
--      bei Namensänderung.
-- Danach wird einmal für alle Konten nachgetragen (wie 059).
-- Ein Fehler beim Abgleich blockiert nie eine Anmeldung oder Speicherung.
-- Erzeugt oder ändert keine Mails. Darf mehrfach ausgeführt werden.
-- Apply after 062. Setzt 059 voraus.
begin;
set local lock_timeout='5s';

create or replace function public.parent_name_for_email(mail text)
returns text
language sql stable security definer set search_path=public as $$
 select nullif(btrim(min(p.full_name)),'') from parents p
 where p.archived_at is null and lower(btrim(p.contact_email)) = lower(btrim(mail))
 having count(*)=1
$$;
revoke all on function public.parent_name_for_email(text) from public, anon, authenticated;

-- Neue Auth-Konten: Namen vor dem Speichern setzen (kein zweites Update nötig).
create or replace function public.auth_users_default_display_name()
returns trigger
language plpgsql security definer set search_path=public as $$
declare n text;
begin
 if coalesce(new.raw_user_meta_data->>'full_name','') = '' then
  n := parent_name_for_email(new.email);
  if n is not null then
   new.raw_user_meta_data := coalesce(new.raw_user_meta_data,'{}'::jsonb) || jsonb_build_object('full_name', n);
  end if;
 end if;
 return new;
exception when others then
 raise warning 'auth_users_default_display_name übersprungen: %', sqlerrm;
 return new;
end $$;
revoke all on function public.auth_users_default_display_name() from public, anon, authenticated;

-- Nur wenn auth.users die Metadaten-Spalte hat (lokale Testdatenbanken nicht).
do $$
begin
 if exists (select 1 from pg_attribute
            where attrelid = to_regclass('auth.users') and attname='raw_user_meta_data' and not attisdropped) then
  execute 'drop trigger if exists auth_users_default_display_name on auth.users';
  execute 'create trigger auth_users_default_display_name before insert on auth.users
           for each row execute function public.auth_users_default_display_name()';
 end if;
end $$;

-- Neue Portal-Profile mit Namen (nicht nur Namensänderungen).
drop trigger if exists profiles_sync_auth_display_name on public.profiles;
create trigger profiles_sync_auth_display_name
 after insert or update of full_name on public.profiles
 for each row execute function public.sync_auth_display_name_trigger();

-- Nachtrag für alle Konten.
do $$
declare uid uuid; vorher int; nachher int;
begin
 if not exists (select 1 from pg_attribute
                where attrelid = to_regclass('auth.users') and attname='raw_user_meta_data' and not attisdropped) then
  return;
 end if;
 select count(*) into vorher from auth.users where coalesce(raw_user_meta_data->>'full_name','')='';
 for uid in select id from auth.users loop
  perform public.sync_auth_display_name(uid);
 end loop;
 select count(*) into nachher from auth.users where coalesce(raw_user_meta_data->>'full_name','')='';
 raise notice 'Konten ohne Display name: vorher %, nachher %', vorher, nachher;
end $$;

commit;
