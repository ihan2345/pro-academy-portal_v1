-- Local Docker fixture only. Never part of a release migration.
update system_settings set value='{"enabled":true}' where key='trial_training_release';
create or replace function public.local_trial_clock(request uuid,stage text) returns void language plpgsql security definer set search_path=public as $$
declare r trial_requests; coach uuid;
begin
 select * into r from trial_requests where id=request for update;
 if r.id is null then raise exception 'Anfrage fehlt'; end if;
 if r.event_id is null then raise exception 'Zuerst einen Termin zuordnen'; end if;
 if stage='attend' then
  select trainer_id into coach from training_events where id=r.event_id;
  perform set_config('request.jwt.claim.sub',coach::text,true);
  update training_events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=r.event_id;
  perform set_attendance(r.participant_id,'attended_manual','Lokale Testsimulation',false);
 elsif stage in ('day1','day7','day14') then
  if r.confirmed_at is null then raise exception 'Zuerst Teilnahme bestätigen'; end if;
  update trial_requests set confirmed_at=now()-case stage when 'day1' then interval '25 hours' when 'day7' then interval '8 days' else interval '16 days' end where id=request;
  -- Keep the same logical confirmation for the test clock: do not create duplicate stages.
  update notification_jobs set payload=jsonb_set(payload,'{confirmed_at}',to_jsonb((select confirmed_at from trial_requests where id=request))) where payload->>'request_id'=request::text and kind in ('trial_feedback','trial_day7','trial_day14');
  update notification_jobs set idempotency_key=kind||':'||request||':'||r.event_id||':'||(select confirmed_at::text from trial_requests where id=request) where payload->>'request_id'=request::text and kind in ('trial_feedback','trial_day7','trial_day14');
  if stage in ('day7','day14') then
   alter table notification_jobs disable trigger touch_updated;
   update notification_jobs set updated_at=now()-interval '8 days' where payload->>'request_id'=request::text and status='sent' and kind in ('trial_feedback','trial_day7');
   alter table notification_jobs enable trigger touch_updated;
  end if;
 else raise exception 'Unbekannter Testschritt'; end if;
end $$;
revoke all on function public.local_trial_clock(uuid,text) from public,anon,authenticated;
grant execute on function public.local_trial_clock(uuid,text) to service_role;
-- Clearly labeled future slots, only when no such fixture exists.
insert into training_events(title,starts_at,ends_at,location_id,trainer_id)
select 'LOKAL · Probetraining Testtermin',date_trunc('day',now())+interval '3 days 15 hours',date_trunc('day',now())+interval '3 days 16 hours',l.id,s.id
from (select id from locations limit 1) l cross join (select id from staff_profiles limit 1) s
where not exists(select 1 from training_events where title='LOKAL · Probetraining Testtermin' and starts_at>now());
notify pgrst,'reload schema';
insert into camps(title,location,capacity,status,description,days)
select 'LOKAL · Feriencamp Vorschau','Lokaler Testplatz',30,'open','Lokales Beispiel zur Camp-Anzeige. Keine echte Buchung oder Zahlung.',jsonb_build_array(jsonb_build_object('starts_at',now()+interval '30 days','ends_at',now()+interval '30 days 4 hours'))
where not exists(select 1 from camps where title='LOKAL · Feriencamp Vorschau');
