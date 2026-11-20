-- Teilnehmer-Kreise in der Trainingsplanung: grüner Ring = Kind hat ein aktives
-- Elternprofil (Konto, E-Mail bestätigt, nicht archiviert, nicht
-- zurückgehalten); ganz grün = Teilnahme bestätigt und Teilnahmemail versendet.
-- Nur lesend, nur für Team/Admin. Erzeugt oder ändert keine Mails.
-- Apply after 057 (unabhängig davon lauffähig).
begin;
create function public.team_participant_mail_state()
returns table(kind text, player_id uuid, event_id uuid)
language plpgsql stable security definer set search_path=public as $$
begin
 if not is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 return query
  select distinct 'active_parent'::text, pp.player_id, null::uuid
  from parent_players pp join parents p on p.id=pp.parent_id
  where p.archived_at is null and not p.notifications_held and training_parent_activated(p.id)
 union all
  select distinct 'attendance_sent'::text, (n.payload->>'player_id')::uuid, (n.payload->>'event_id')::uuid
  from notification_jobs n
  where n.kind='attendance' and n.status='sent'
   and n.payload->>'player_id' ~ '^[0-9a-f-]{36}$' and n.payload->>'event_id' ~ '^[0-9a-f-]{36}$'
   and n.created_at>now()-interval '120 days';
end $$;
revoke all on function public.team_participant_mail_state() from public,anon;
grant execute on function public.team_participant_mail_state() to authenticated;
notify pgrst,'reload schema';
commit;
