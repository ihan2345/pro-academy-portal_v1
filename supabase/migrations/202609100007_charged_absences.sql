-- Charged cancellations/no-shows consume one unit; only attended time is summed.
-- Existing immutable report snapshots and queued mail snapshots are not rewritten.
-- Apply together with the matching application release; no outbound mail is triggered.
alter table public.event_participants add column removed_from_event boolean not null default false;
-- Historical editor removals were represented as cancellations; they are not chargeable appointments.
update public.event_participants set removed_from_event=true
where status='cancelled' and reason='Aus Termin entfernt';

create or replace function public.save_training(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare eid uuid; child uuid; selected_period uuid; old_event public.training_events; children uuid[]; event_start timestamptz; event_end timestamptz; r record;
begin
 if not public.is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 perform set_config('app.audit_reason',coalesce(input->>'reason','Terminplanung'),true);
 event_start:=(input->>'starts_at')::timestamptz; event_end:=(input->>'ends_at')::timestamptz;
 children:=array(select distinct jsonb_array_elements_text(input->'player_ids')::uuid);
 if cardinality(children)<1 then raise exception 'Mindestens ein Kind auswählen'; end if;
 if nullif(input->>'id','') is not null then
 eid:=(input->>'id')::uuid; select * into old_event from public.training_events where id=eid for update;
 if not found then raise exception 'Termin nicht gefunden'; end if;
 if old_event.revision<>coalesce((input->>'revision')::int,0) then raise exception 'Termin wurde zwischenzeitlich geändert'; end if;
 if exists(select 1 from public.event_participants where event_id=eid and status in ('attended_auto','attended_manual','cancelled','absent') and not removed_from_event) and (event_start<>old_event.starts_at or event_end<>old_event.ends_at or input->>'event_type'<>old_event.event_type) then raise exception 'Zuerst bestätigte Teilnahmen korrigieren, dann Terminzeit oder Trainingsart ändern'; end if;
 update public.training_events set title=input->>'title',starts_at=event_start,ends_at=event_end,location_id=(input->>'location_id')::uuid,trainer_id=(input->>'trainer_id')::uuid,event_type=input->>'event_type',notify_parents=coalesce((input->>'notify_parents')::boolean,true),revision=revision+1 where id=eid;
 else
 insert into public.training_events(title,starts_at,ends_at,location_id,trainer_id,event_type,auto_attendance_at,notify_parents,created_by) values(input->>'title',event_start,event_end,(input->>'location_id')::uuid,(input->>'trainer_id')::uuid,input->>'event_type',public.calculate_auto_at(event_end),coalesce((input->>'notify_parents')::boolean,true),auth.uid()) returning id into eid;
 end if;
 insert into public.event_private_notes(id,note) values(eid,coalesce(input->>'note','')) on conflict(id) do update set note=excluded.note;
 update public.event_participants set status='cancelled',removed_from_event=true,reason='Aus Termin entfernt',revision=revision+1 where event_id=eid and not(player_id=any(children)) and not removed_from_event;
 foreach child in array children loop
 select id into selected_period from public.entitlement_periods where player_id=child and event_start>=starts_at and event_start<ends_at and status in ('active','trialing') and (case when input->>'event_type'='Athletiktraining' then athletics_units>0 else included_units-athletics_units>0 end) order by starts_at desc limit 1;
 if selected_period is null then raise exception 'Kein aktiver Leistungszeitraum für Kind %',child; end if;
 insert into public.event_participants(event_id,player_id,period_id) values(eid,child,selected_period) on conflict(event_id,player_id) do update set period_id=excluded.period_id,removed_from_event=false,status=case when event_participants.removed_from_event then 'planned'::public.attendance_status else event_participants.status end,revision=event_participants.revision+1;
 end loop;
 if old_event.id is not null and coalesce((input->>'notify_parents')::boolean,true) then
 for r in select ep.id,p.contact_email,p.id parent_id,ep.player_id,ep.period_id from public.event_participants ep join public.parent_players pp on pp.player_id=ep.player_id join public.parents p on p.id=pp.parent_id where ep.event_id=eid loop
 insert into public.notification_jobs(idempotency_key,kind,recipient,payload) values('change:'||eid||':'||(old_event.revision+1)||':'||r.parent_id||':'||r.player_id,'change',r.contact_email,jsonb_build_object('event_id',eid,'player_id',r.player_id,'participant_id',r.id,'period_id',r.period_id,'starts_at',event_start,'ends_at',event_end)) on conflict do nothing;
 end loop; end if;
 return eid;
end $$;

create or replace function public.participant_validate() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.removed_from_event then
 if not exists(select 1 from public.entitlement_periods where id=new.period_id and player_id=new.player_id) then raise exception 'Kein passender Leistungszeitraum'; end if;
 return new;
 end if;
 if not exists(select 1 from public.entitlement_periods p join public.training_events e on e.id=new.event_id where p.id=new.period_id and p.player_id=new.player_id and ((e.starts_at>=p.starts_at and e.starts_at<p.ends_at and (case when e.event_type='Athletiktraining' then p.athletics_units>0 else p.included_units-p.athletics_units>0 end)))) then raise exception 'Kein passender Leistungszeitraum'; end if;
 if new.status not in ('cancelled','excused') and exists(select 1 from public.training_events where id=new.event_id and status='cancelled') then raise exception 'Stornierte Termine können nicht erneut belegt werden'; end if;
 if new.status in ('attended_auto','attended_manual') and exists(select 1 from public.training_events where id=new.event_id and (status='cancelled' or ends_at>now())) then raise exception 'Zukünftige oder stornierte Termine können nicht bestätigt werden'; end if;
 return new;
end $$;

create or replace function public.set_attendance(participant uuid, new_status public.attendance_status, correction_reason text, send_correction boolean default false) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 if exists(select 1 from public.event_participants where id=participant and removed_from_event) then raise exception 'Kind wurde aus dem Termin entfernt'; end if;
 if new_status='attended_auto' then raise exception 'Systemstatus nicht manuell setzen'; end if;
 if length(trim(coalesce(correction_reason,'')))<3 then raise exception 'Begründung erforderlich'; end if;
 perform set_config('app.audit_reason',correction_reason,true); perform set_config('app.correction_mail',send_correction::text,true);
 update public.event_participants set status=new_status,reason=correction_reason,revision=revision+1 where id=participant and status<>new_status;
end $$;

create or replace function public.cancel_training(event uuid, cancellation_reason text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 if length(trim(coalesce(cancellation_reason,'')))<3 then raise exception 'Begründung erforderlich'; end if;
 perform set_config('app.audit_reason',cancellation_reason,true); perform set_config('app.correction_mail','true',true);
 update public.training_events set status='cancelled',revision=revision+1 where id=event and status<>'cancelled';
 update public.event_participants set status='cancelled',reason=cancellation_reason,revision=revision+1 where event_id=event and status not in ('cancelled','excused') and not removed_from_event;
end $$;

create or replace function public.capture_report(period uuid, force_version boolean default false, contact_number text default '') returns uuid language plpgsql security definer set search_path=public as $$
declare ent public.entitlement_periods; player public.players; report uuid; version_num int; events jsonb; completed int; minutes int;
begin
 select * into ent from public.entitlement_periods where id=period for update;
 if not found or ent.ends_at>now() then raise exception 'Leistungszeitraum noch nicht abgeschlossen'; end if;
 select id into report from public.report_snapshots where period_id=period order by version desc limit 1;
 if found and not force_version then return report; end if;
 select coalesce(max(version),0)+1 into version_num from public.report_snapshots where period_id=period;
 select * into player from public.players where id=ent.player_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'event_type',e.event_type,'starts_at',e.starts_at,'ends_at',e.ends_at,'status',ep.status,'location_name',l.name,'trainer_name',s.display_name) order by e.starts_at),'[]'), count(*) filter(where ep.status in ('attended_auto','attended_manual','cancelled','absent')),coalesce(sum(extract(epoch from(e.ends_at-e.starts_at))/60) filter(where ep.status in ('attended_auto','attended_manual')),0)::int into events,completed,minutes from public.event_participants ep join public.training_events e on e.id=ep.event_id left join public.locations l on l.id=e.location_id left join public.staff_profiles s on s.id=e.trainer_id where ep.period_id=period and not ep.removed_from_event;
 insert into public.report_snapshots(period_id,player_id,version,snapshot) values(period,ent.player_id,version_num,jsonb_build_object('player_name',player.first_name||' '||player.last_name,'product_name',ent.product_name,'starts_at',ent.starts_at,'ends_at',ent.ends_at,'included_units',ent.included_units,'athletics_units',ent.athletics_units,'tariff_generation',ent.tariff_generation,'completed',completed,'minutes',minutes,'created_at',now(),'version',version_num,'attendance_policy','charged_absences_v1','whatsapp',contact_number,'events',events)) returning id into report;
 return report;
end $$;
