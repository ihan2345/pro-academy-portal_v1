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
begin;

create function public.auth_display_name_for(uid uuid)
returns text
language sql stable security definer set search_path=public as $$
 select coalesce(
  (select nullif(btrim(p.full_name),'') from parents p where p.auth_user_id=uid limit 1),
  (select nullif(btrim(pr.full_name),'') from profiles pr where pr.id=uid),
  (select nullif(btrim(s.display_name),'') from staff_profiles s where s.id=uid)
 )
$$;

create function public.sync_auth_display_name(uid uuid)
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

create function public.sync_auth_display_name_trigger()
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

create trigger parents_sync_auth_display_name
 after insert or update of auth_user_id, full_name on public.parents
 for each row execute function public.sync_auth_display_name_trigger();

create trigger profiles_sync_auth_display_name
 after update of full_name on public.profiles
 for each row execute function public.sync_auth_display_name_trigger();

create trigger staff_profiles_sync_auth_display_name
 after insert or update of display_name on public.staff_profiles
 for each row execute function public.sync_auth_display_name_trigger();

-- Einmaliger Nachtrag für alle bestehenden Konten.
do $$
declare uid uuid;
begin
 if not exists (select 1 from information_schema.columns
                where table_schema='auth' and table_name='users' and column_name='raw_user_meta_data') then
  return;
 end if;
 for uid in
  select auth_user_id from parents where auth_user_id is not null
  union select id from profiles
  union select id from staff_profiles
 loop
  perform public.sync_auth_display_name(uid);
 end loop;
end $$;

commit;

-- Kontrolle danach (nur lesend): Konten ohne Display name.
-- select u.email, pr.role from auth.users u left join public.profiles pr on pr.id=u.id
--  where coalesce(u.raw_user_meta_data->>'full_name','')='' and u.deleted_at is null
--  order by u.created_at desc;
