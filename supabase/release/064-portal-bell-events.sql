-- Glocke, Kategorie „Portal“ (nur Admins, Lese-Konto gekürzt).
-- Liest nur, ändert nichts und verschickt nichts. Liefert für die letzten
-- Tage:
--   invite_sent / invite_failed  Einladungsmail verschickt bzw. fehlgeschlagen
--                                (Einzel-Einladung, Welle, Testeinladung)
--   invite_accepted              Einladung angenommen (Konto verbunden)
--   self_activated               Elternkonto per Code selbst aktiviert
--   login                        Anmeldung (neue Sitzung); first = erstes
--                                Mal im Portal (Konto am selben Tag angelegt)
--   online                       in der letzten Stunde im Portal aktiv
-- Datenschutz: keine IP-Adressen, keine Geräte, keine E-Mail-Adressen.
-- Apply after 063.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function public.portal_access_events(days int default 14)
returns table(kind text, at timestamptz, user_id uuid, parent_id uuid, name text,
 role text, wave boolean, test boolean, first boolean)
language plpgsql stable security definer set search_path=public as $$
#variable_conflict use_column
declare since timestamptz:=now()-make_interval(days=>least(greatest(coalesce(days,14),1),31));
begin
 return query
 -- Einladungsmails (abgeschlossener Versand)
 select case when j.status='sent' then 'invite_sent' else 'invite_failed' end,
  j.updated_at, p.auth_user_id, p.id, coalesce(p.full_name,j.payload->>'parent_name'), 'parent',
  coalesce(j.payload->>'invitation_wave','false')='true',
  coalesce(j.payload->>'invitation_wave_test','false')='true', false
 from notification_jobs j
 left join parent_invitations i on i.id::text=j.payload->>'invitation_id'
 left join parents p on p.id=i.parent_id
 where j.kind='invitation' and j.status in ('sent','failed','uncertain') and j.updated_at>=since
 union all
 -- Einladung angenommen
 select 'invite_accepted', i.consumed_at, p.auth_user_id, p.id, p.full_name, 'parent',
  exists(select 1 from notification_jobs j where j.kind='invitation'
   and j.payload->>'invitation_id'=i.id::text and j.payload->>'invitation_wave'='true'),
  false, false
 from parent_invitations i join parents p on p.id=i.parent_id
 where i.consumed_at>=since
 union all
 -- Selbst aktiviert (Code-Anmeldung ohne Einladung)
 select 'self_activated', a.created_at, a.actor_id, p.id, p.full_name, 'parent', false, false, false
 from audit_log a join parents p on p.id=a.record_id
 where a.action='PARENT_SELF_ACTIVATED' and a.created_at>=since
 union all
 -- Anmeldungen: neue Sitzungen, dazu die letzte Anmeldung (auch nach Abmelden)
 select 'login', l.at, l.uid, pa.id, coalesce(pa.full_name,pr.full_name), pr.role::text, false, false,
  l.at=min(l.at) over(partition by l.uid) and l.at<l.created+interval '1 day'
 from (
  select s.user_id uid, s.created_at at, u.created_at created
  from auth.sessions s join auth.users u on u.id=s.user_id where s.created_at>=since
  union
  select u.id, u.last_sign_in_at, u.created_at from auth.users u
  where u.last_sign_in_at>=since and not exists(select 1 from auth.sessions s where s.user_id=u.id
   and s.created_at between u.last_sign_in_at-interval '2 minutes' and u.last_sign_in_at+interval '2 minutes')
 ) l
 join profiles pr on pr.id=l.uid
 left join parents pa on pa.auth_user_id=l.uid and pa.archived_at is null
 union all
 -- Gerade aktiv: Sitzung in der letzten Stunde benutzt bzw. erneuert
 select 'online', max(s.updated_at), s.user_id, pa.id, coalesce(pa.full_name,pr.full_name), pr.role::text,
  false, false, false
 from auth.sessions s join profiles pr on pr.id=s.user_id
 left join parents pa on pa.auth_user_id=s.user_id and pa.archived_at is null
 where s.updated_at>=now()-interval '60 minutes'
 group by s.user_id, pa.id, pa.full_name, pr.full_name, pr.role;
end $$;
revoke all on function public.portal_access_events(int) from public,anon,authenticated;
grant execute on function public.portal_access_events(int) to service_role;
notify pgrst,'reload schema';
commit;
