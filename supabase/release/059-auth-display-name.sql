-- Display name in Supabase Auth → Users für alle Konten.
-- Supabase zeigt als „Display name“ raw_user_meta_data.full_name. Bisher setzte
-- nur der Probetraining-Weg (ensureTrialAuth) dieses Feld; Portal-Login,
-- Shop-Login und Gast-Zugangslinks legen Konten nur mit E-Mail an.
--
-- Diese Release schreibt den Namen künftig automatisch ins Auth-Konto, sobald
--   * ein Elternteil mit einem Konto verknüpft wird oder seinen Namen ändert
--     (parents.full_name),
--   * ein Team-Konto seinen Namen ändert (profiles.full_name /
--     staff_profiles.display_name),
-- und trägt einmalig alle bestehenden Konten nach.
--
-- Reihenfolge des Namens: Elterntabelle → profiles.full_name →
-- staff_profiles.display_name. Leere Namen werden nie geschrieben, andere
-- Metadaten (z. B. trial_family_id) bleiben erhalten. Rein kosmetisch: das
-- Portal liest Namen weiterhin aus parents/profiles. Ein Fehler beim Abgleich
-- blockiert nie das Speichern eines Elternteils oder Team-Kontos.
-- Erzeugt oder ändert keine Mails. Apply after 058 (unabhängig davon lauffähig).
-- Darf mehrfach ausgeführt werden (create or replace / drop trigger if exists).
begin;

create or replace function public.auth_display_name_for(uid uuid)
returns text
language sql stable security definer set search_path=public as $$
 select coalesce(
  (select nullif(btrim(p.full_name),'') from parents p where p.auth_user_id=uid limit 1),
  -- Noch nicht verknüpft: eindeutiges, nicht archiviertes Elternteil mit gleicher E-Mail.
  (select nullif(btrim(min(p.full_name)),'') from parents p
    where p.auth_user_id is null and p.archived_at is null
      and lower(btrim(p.contact_email)) = (select lower(btrim(u.email)) from auth.users u where u.id=uid)
    having count(*)=1),
  (select nullif(btrim(pr.full_name),'') from profiles pr where pr.id=uid),
  (select nullif(btrim(s.display_name),'') from staff_profiles s where s.id=uid)
 )
$$;

create or replace function public.sync_auth_display_name(uid uuid)
returns void
language plpgsql security definer set search_path=public as $$
declare n text;
begin
 if uid is null then return; end if;
 n := auth_display_name_for(uid);
 if n is null then return; end if;
 update auth.users u
    set raw_user_meta_data = coalesce(u.raw_user_meta_data,'{}'::jsonb) || jsonb_build_object('full_name', n)
  where u.id = uid
    and coalesce(u.email,'') not like '%@deleted.invalid'
    and (u.raw_user_meta_data->>'full_name') is distinct from n;
exception when others then
 raise warning 'sync_auth_display_name(%) übersprungen: %', uid, sqlerrm;
end $$;

create or replace function public.sync_auth_display_name_trigger()
returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name = 'parents' then
  perform sync_auth_display_name(new.auth_user_id);
 else
  perform sync_auth_display_name(new.id);
 end if;
 return null;
end $$;

revoke all on function public.auth_display_name_for(uuid) from public, anon, authenticated;
revoke all on function public.sync_auth_display_name(uuid) from public, anon, authenticated;
revoke all on function public.sync_auth_display_name_trigger() from public, anon, authenticated;

drop trigger if exists parents_sync_auth_display_name on public.parents;
create trigger parents_sync_auth_display_name
 after insert or update of auth_user_id, full_name on public.parents
 for each row execute function public.sync_auth_display_name_trigger();

drop trigger if exists profiles_sync_auth_display_name on public.profiles;
create trigger profiles_sync_auth_display_name
 after update of full_name on public.profiles
 for each row execute function public.sync_auth_display_name_trigger();

drop trigger if exists staff_profiles_sync_auth_display_name on public.staff_profiles;
create trigger staff_profiles_sync_auth_display_name
 after insert or update of display_name on public.staff_profiles
 for each row execute function public.sync_auth_display_name_trigger();

-- Einmaliger Nachtrag für alle Konten (auch noch nicht verknüpfte Eltern per E-Mail).
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

-- Kontrolle danach (nur lesend): Konten ohne Display name.
-- select u.email, pr.role from auth.users u left join public.profiles pr on pr.id=u.id
--  where coalesce(u.raw_user_meta_data->>'full_name','')='' and u.deleted_at is null
--  order by u.created_at desc;
