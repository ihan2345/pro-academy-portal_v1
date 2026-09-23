-- Calendar follow-up: apply only as part of an explicitly approved release.

create or replace function public.capture_report(period uuid, force_version boolean default false, contact_number text default '') returns uuid language plpgsql security definer set search_path=public as $$
declare ent public.entitlement_periods; player public.players; report uuid; version_num int; events jsonb; completed int; minutes int;
begin
 select * into ent from public.entitlement_periods where id=period for update;
 if not found or ent.ends_at>now() then raise exception 'Leistungszeitraum noch nicht abgeschlossen'; end if;
 select id into report from public.report_snapshots where period_id=period order by version desc limit 1;
 if found and not force_version then return report; end if;
 select coalesce(max(version),0)+1 into version_num from public.report_snapshots where period_id=period;
 select * into player from public.players where id=ent.player_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'event_type',e.event_type,'starts_at',e.starts_at,'ends_at',e.ends_at,'status',ep.status,'event_cancelled',e.status='cancelled','location_name',l.name,'trainer_name',s.display_name) order by e.starts_at),'[]'), count(*) filter(where e.status<>'cancelled' and ep.status in ('attended_auto','attended_manual','cancelled','absent')),coalesce(sum(extract(epoch from(e.ends_at-e.starts_at))/60) filter(where e.status<>'cancelled' and ep.status in ('attended_auto','attended_manual')),0)::int into events,completed,minutes from public.event_participants ep join public.training_events e on e.id=ep.event_id left join public.locations l on l.id=e.location_id left join public.staff_profiles s on s.id=e.trainer_id where ep.period_id=period and not ep.removed_from_event;
 events:=events || public.backfill_report_events(period);
 select completed+count(*), minutes+coalesce(sum(duration_minutes),0)::int into completed,minutes from public.training_backfills where period_id=period;
 insert into public.report_snapshots(period_id,player_id,version,snapshot) values(period,ent.player_id,version_num,jsonb_build_object('player_name',player.first_name||' '||player.last_name,'product_name',ent.product_name,'starts_at',ent.starts_at,'ends_at',ent.ends_at,'included_units',ent.included_units,'athletics_units',ent.athletics_units,'tariff_generation',ent.tariff_generation,'completed',completed,'minutes',minutes,'created_at',now(),'version',version_num,'attendance_policy','team_cancellations_free_v2','suppress_delivery',coalesce(current_setting('app.backfill_report',true),'false')='true','whatsapp',contact_number,'events',events)) returning id into report;
 return report;
end $$;

create or replace function public.save_training_backfill(input jsonb, contact_number text default '') returns uuid
language plpgsql security definer set search_path=public as $$
declare ent public.entitlement_periods; existing public.training_backfills; saved uuid; units int; used int; recipient record; report uuid;
begin
 if not public.is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 if (input->>'request_id')::uuid is null then raise exception 'Anfrage-ID erforderlich'; end if;
 -- Serialize requests before checking idempotency, including concurrent retries.
 perform pg_advisory_xact_lock(hashtextextended(input->>'request_id',0));
 select * into existing from public.training_backfills where request_id=(input->>'request_id')::uuid;
 if found then
   if existing.created_by<>auth.uid() or existing.period_id<>(input->>'period_id')::uuid then raise exception 'Anfrage gehört zu einer anderen Nachtragung'; end if;
   if existing.event_type is distinct from input->>'event_type'
      or existing.duration_minutes is distinct from (input->>'duration_minutes')::int
      or existing.parent_note is distinct from trim(input->>'parent_note')
      or existing.occurred_on is distinct from nullif(input->>'occurred_on','')::date
      or existing.title is distinct from coalesce(nullif(trim(input->>'title'),''),'Nachgetragen')
      or existing.location_id is distinct from nullif(input->>'location_id','')::uuid
      or existing.trainer_id is distinct from nullif(input->>'trainer_id','')::uuid
      or existing.notify_parents is distinct from coalesce((input->>'notify_parents')::boolean,false)
      or (select note from public.training_backfill_private_notes where id=existing.id) is distinct from coalesce(input->>'internal_note','')
   then raise exception 'Diese Anfrage wurde bereits mit anderen Angaben gespeichert. Stempelkarte aktualisieren.'; end if;
   return existing.id;
 end if;
 select * into ent from public.entitlement_periods where id=(input->>'period_id')::uuid for update;
 if not found or ent.status='void' or ent.starts_at>now() then raise exception 'Kein gültiger vergangener Leistungszeitraum'; end if;
 if not exists(select 1 from public.players where id=ent.player_id and archived_at is null) then raise exception 'Kind nicht verfügbar'; end if;
 if nullif(input->>'occurred_on','') is not null and (
   (input->>'occurred_on')::date>(now() at time zone 'Europe/Berlin')::date or
   (input->>'occurred_on')::date<(ent.starts_at at time zone 'Europe/Berlin')::date or
   (input->>'occurred_on')::date>((ent.ends_at-interval '1 microsecond') at time zone 'Europe/Berlin')::date
 ) then raise exception 'Trainingsdatum muss in der Vergangenheit und im gewählten Zeitraum liegen'; end if;
 units:=case when input->>'event_type'='Athletiktraining' then ent.athletics_units else ent.included_units-ent.athletics_units end;
 select count(*) into used from public.event_participants ep join public.training_events e on e.id=ep.event_id
 where ep.period_id=ent.id and e.status<>'cancelled' and not ep.removed_from_event and ep.status<>'excused'
 and (e.event_type='Athletiktraining')=(input->>'event_type'='Athletiktraining');
 select used+count(*) into used from public.training_backfills where period_id=ent.id
 and (event_type='Athletiktraining')=(input->>'event_type'='Athletiktraining');
 if used>=units then raise exception 'Kein offener Stempel mehr vorhanden. Bitte Stempelkarte aktualisieren.'; end if;
 perform set_config('app.audit_reason','Training nachgetragen',true);
 insert into public.training_backfills(request_id,period_id,player_id,event_type,title,occurred_on,duration_minutes,parent_note,location_id,trainer_id,notify_parents,created_by)
 values((input->>'request_id')::uuid,ent.id,ent.player_id,input->>'event_type',coalesce(nullif(trim(input->>'title'),''),'Nachgetragen'),
 nullif(input->>'occurred_on','')::date,(input->>'duration_minutes')::int,trim(input->>'parent_note'),
 nullif(input->>'location_id','')::uuid,nullif(input->>'trainer_id','')::uuid,coalesce((input->>'notify_parents')::boolean,false),auth.uid()) returning id into saved;
 insert into public.training_backfill_private_notes(id,note) values(saved,coalesce(input->>'internal_note',''));
 if ent.ends_at<=now() then
   perform set_config('app.backfill_report','true',true);
   report:=public.capture_report(ent.id,true,contact_number);
   perform set_config('app.backfill_report','false',true);
 end if;
 if coalesce((input->>'notify_parents')::boolean,false) then
   for recipient in select p.id,p.contact_email from public.parents p join public.parent_players pp on pp.parent_id=p.id
     where pp.player_id=ent.player_id and p.archived_at is null loop
     insert into public.notification_jobs(idempotency_key,kind,recipient,payload)
     values('backfill:'||saved||':'||recipient.id,'training_backfill',recipient.contact_email,
       jsonb_build_object('backfill_id',saved,'parent_id',recipient.id,'player_id',ent.player_id,'period_id',ent.id,
         'player_name',(select first_name||' '||last_name from public.players where id=ent.player_id),
         'parent_note',trim(input->>'parent_note'),'duration_minutes',(input->>'duration_minutes')::int,
         'occurred_on',nullif(input->>'occurred_on',''),'period_starts_at',ent.starts_at,'period_ends_at',ent.ends_at,'snapshot_id',report));
   end loop;
 end if;
 return saved;
end $$;

-- A whole-event cancellation is always a team action. Keep participant history,
-- but exclude the cancelled event when counting units or training minutes.
create or replace function public.cancel_training(event uuid, cancellation_reason text) returns void
language plpgsql security definer set search_path=public as $$
declare event_status text; affected record; report_contact text;
begin
 if not public.is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 if length(trim(coalesce(cancellation_reason,'')))<3 then raise exception 'Begründung erforderlich'; end if;
 select status into event_status from public.training_events where id=event for update;
 if not found then raise exception 'Termin nicht gefunden'; end if;
 if event_status='cancelled' then return; end if;
 perform set_config('app.audit_reason',cancellation_reason,true);
 perform set_config('app.correction_mail','true',true);
 update public.training_events set status='cancelled',revision=revision+1 where id=event;
 update public.event_participants set status='cancelled',reason=cancellation_reason,revision=revision+1
 where event_id=event and status not in ('cancelled','excused') and not removed_from_event;
 -- Refresh closed periods without sending an additional report email.
 -- The existing cancellation notification and recipient safeguards stay intact.
 perform set_config('app.backfill_report','true',true);
 for affected in select distinct p.id from public.entitlement_periods p
   join public.event_participants ep on ep.period_id=p.id
   where ep.event_id=event and not ep.removed_from_event and p.ends_at<=now()
   order by p.id loop
   select snapshot->>'whatsapp' into report_contact from public.report_snapshots
     where period_id=affected.id order by version desc limit 1;
   perform public.capture_report(affected.id,true,coalesce(report_contact,''));
 end loop;
 perform set_config('app.backfill_report','false',true);
end $$;

-- Existing reports are immutable. Add one corrected version only where the
-- latest report still includes a team-cancelled event without the new marker.
-- No participant updates, invitations or outgoing notification jobs here.
do $$
declare affected record;
begin
 perform set_config('app.backfill_report','true',true);
 for affected in
   select r.period_id,r.snapshot->>'whatsapp' as contact
   from public.entitlement_periods p
   cross join lateral (select period_id,snapshot from public.report_snapshots
     where period_id=p.id order by version desc limit 1) r
   where p.ends_at<=now() and exists(
     select 1 from jsonb_array_elements(r.snapshot->'events') row
     join public.training_events e on e.id::text=row->>'id'
     where e.status='cancelled' and not coalesce((row->>'event_cancelled')::boolean,false))
   order by r.period_id
 loop
   perform public.capture_report(affected.period_id,true,coalesce(affected.contact,''));
 end loop;
 perform set_config('app.backfill_report','false',true);
end $$;
