-- Probetraining rückwirkend eintragen: Ein Probetraining-Kind kann nachträglich
-- einer bereits stattgefundenen Einheit (letzte 90 Tage) zugeordnet werden. Die
-- Teilnahme wird dabei direkt manuell bestätigt. Danach läuft der normale Ablauf:
-- Academy-Feedback freigeben -> Feedbackmail -> Tag-7- / Tag-14-Folge.
-- Planungs- und Erinnerungsmails entstehen nicht, weil die Einheit vorbei ist.
-- Apply after 019. Patches the installed manage_trial so live drift fails loudly.
begin;
do $patch$ declare d text; changed text; begin
 d:=pg_get_functiondef('public.manage_trial(jsonb)'::regprocedure);
 -- 1. Same lock order (event before request) as the regular assignment.
 changed:=replace(d,$s$if input->>'action'='assign' then select * into e from training_events where id=(input->>'event_id')::uuid for update; end if;$s$,
  $s$if input->>'action' in ('assign','assign_past') then select * into e from training_events where id=(input->>'event_id')::uuid for update; end if;$s$);
 if changed=d then raise exception 'Unexpected manage_trial event lock baseline';end if;
 d:=changed;
 -- 2. New action: assign to a past unit and confirm attendance in one step.
 changed:=replace(d,$s$ elsif input->>'action'='owner' then$s$,$s$ elsif input->>'action'='assign_past' then
  if f.stopped_at is not null then raise exception 'Anfrage wurde beendet'; end if;
  if r.confirmed_at is not null or r.status='closed' then raise exception 'Teilnahme ist bereits bestätigt oder die Anfrage ist beendet'; end if;
  if e.id is null or e.status<>'scheduled' or e.ends_at>now() or e.starts_at<now()-interval '90 days' then raise exception 'Bitte eine bereits stattgefundene Einheit der letzten 90 Tage wählen'; end if;
  perform set_config('app.audit_reason','Probetraining rückwirkend eingetragen',true);
  if r.event_id is distinct from e.id or not exists(select 1 from event_participants where id=r.participant_id and not removed_from_event) then
   if r.participant_id is not null then update event_participants set removed_from_event=true,status='cancelled',revision=revision+1 where id=r.participant_id and not removed_from_event; end if;
   update trial_requests set event_id=e.id,participant_id=null,feedback_at=null,status='planned',scheduled_at=now(),assigned_to=coalesce(assigned_to,e.trainer_id) where id=r.id;
   insert into event_participants(event_id,trial_player_id,period_id,trial_request_id) values(e.id,r.player_id,null,r.id)
   on conflict(event_id,trial_player_id) where trial_player_id is not null do update set trial_request_id=excluded.trial_request_id,period_id=null,removed_from_event=false,status='planned',revision=event_participants.revision+1
   returning id into r.participant_id;
   update trial_requests set participant_id=r.participant_id where id=r.id;
  end if;
  perform set_attendance(r.participant_id,'attended_manual','Probetraining rückwirkend eingetragen',false);
 elsif input->>'action'='owner' then$s$);
 if changed=d then raise exception 'Unexpected manage_trial action baseline';end if;
 execute changed;
end $patch$;
notify pgrst,'reload schema';
commit;
