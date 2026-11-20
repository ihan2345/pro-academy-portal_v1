-- Mailversand an aktive Eltern: neuer globaler Schalter „parent_auto_mail“
-- (nur Super-Admins, /admin/einstellungen). Startet AUS, ändert also nichts,
-- bis der Schalter bewusst umgelegt wird.
--   AUS: wie bisher, Familienmails nur an Adressen in
--        portal_delivery_release.recipients.
--   AN:  zusätzlich an jede aktive Familie (Portal-Konto, E-Mail bestätigt,
--        nicht archiviert, nicht zurückgehalten).
-- Unverändert: Hauptschalter portal_delivery_release.enabled, Einladungen
-- (invitation_recipients + manuelle Freigabe), automatic_invitations,
-- persönliche E-Mail-Abmeldung, Camp- und Probetraining-Regeln.
-- Bereits zurückgehaltene Mails bleiben zurückgehalten (keine Nachhol-Welle).
-- Apply after 056. Patches every installed parent_delivery_allowed* function
-- so live drift fails loudly.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
insert into public.platform_features(key,enabled) values('parent_auto_mail',false) on conflict(key) do nothing;

create function public.parent_auto_mail_allowed(recipient text) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce((select enabled from platform_features where key='parent_auto_mail'),false)
 and exists(select 1 from parents p join profiles f on f.id=p.auth_user_id join auth.users u on u.id=f.id
  where lower(btrim(p.contact_email))=lower(btrim(recipient)) and lower(btrim(u.email))=lower(btrim(recipient))
   and u.email_confirmed_at is not null and f.role='parent' and p.archived_at is null and not p.notifications_held)
$$;
revoke all on function public.parent_auto_mail_allowed(text) from public,anon,authenticated;
grant execute on function public.parent_auto_mail_allowed(text) to service_role;

do $patch$
declare fn record; d text; changed text; patched integer:=0;
begin
 for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'parent_delivery_allowed%' loop
  d:=pg_get_functiondef(fn.oid);
  if position('parent_auto_mail_allowed' in d)>0 then raise exception 'parent_auto_mail already applied'; end if;
  changed:=regexp_replace(d,
   $r$coalesce\(settings->'recipients','\[\]'::jsonb\) \? (recipient_email|lower\(btrim\(recipient\)\))$r$,
   $s$(coalesce(settings->'recipients','[]'::jsonb) ? \1 or parent_auto_mail_allowed(\1))$s$,'g');
  if changed<>d then execute changed; patched:=patched+1; end if;
 end loop;
 -- Base gate (001/Camp) and training gate (005/006) must both be covered.
 if patched<2 then raise exception 'Unexpected recipient allowlist gates (% patched); no changes applied',patched; end if;
end $patch$;
notify pgrst,'reload schema';
commit;
