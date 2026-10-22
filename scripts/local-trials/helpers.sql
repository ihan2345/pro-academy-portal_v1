-- Local Docker fixture only. Never part of a release migration.
update system_settings set value='{"enabled":true}' where key='trial_training_release';
create or replace function public.local_trial_clock(request uuid,stage text) returns void language plpgsql security definer set search_path=public as $$
declare r trial_requests; coach uuid; f trial_families; cid text; sid text; price text; item jsonb;
begin
 select * into r from trial_requests where id=request for update;
 if r.id is null then raise exception 'Anfrage fehlt'; end if;
 if r.event_id is null then raise exception 'Zuerst einen Termin zuordnen'; end if;
 if stage='subscribe' then
  select * into f from trial_families where id=r.family_id;
  cid:='cus_localtrial_'||replace(f.id::text,'-','');sid:='sub_localtrial_'||replace(r.id::text,'-','');
  select stripe_price_id into price from plans where active and generation='current' and is_camp is not true order by included_units limit 1;
  if price is null then raise exception 'Lokaler aktiver Tarif fehlt'; end if;
  insert into stripe_customer_registry(id,name,email) values(cid,'LOKAL · '||f.parent_name,f.email) on conflict(id) do update set email=excluded.email;
  item:=jsonb_build_object('id','si_localtrial_'||replace(r.id::text,'-',''),'price_id',price,'quantity',1,'starts_at',now()-interval '1 minute','ends_at',now()+interval '30 days');
  perform apply_stripe_package_sync(jsonb_build_object('stripe_subscription_id',sid,'stripe_customer_id',cid,'status','active','subscription_created_at',now()-interval '2 minutes','billing_cycle_anchor',now()-interval '1 minute','retrieved_at',now(),'items',jsonb_build_array(item)));
  insert into stripe_webhook_events(stripe_event_id,type,payload,stripe_created,status,processed_at)
  values('evt_localtrial_'||replace(r.id::text,'-',''),'customer.subscription.created',jsonb_build_object('data',jsonb_build_object('object',jsonb_build_object('id',sid,'customer',cid,'status','active'))),extract(epoch from now())::bigint,'processed',now()) on conflict(stripe_event_id) do nothing;
 elsif stage='attend' then
  select trainer_id into coach from training_events where id=r.event_id;
  perform set_config('request.jwt.claim.sub',coach::text,true);
  update training_events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=r.event_id;
  perform set_attendance(r.participant_id,'attended_manual','Lokale Testsimulation',false);
 elsif stage in ('day7','day14') then
  if r.feedback_at is null then raise exception 'Zuerst Coachfeedback freigeben'; end if;
  update trial_requests set feedback_at=now()-case stage when 'day7' then interval '8 days' else interval '15 days' end where id=request;
  -- Move already captured deliveries as well; production still enforces a real 48h minimum.
  alter table notification_jobs disable trigger touch_updated;
  update notification_jobs set updated_at=now()-interval '3 days' where payload->>'family_id'=r.family_id::text and status='sent' and kind in ('trial_feedback','trial_day7');
  alter table notification_jobs enable trigger touch_updated;
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
