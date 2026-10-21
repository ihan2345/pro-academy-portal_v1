-- Apply after 008/009 and deploy together with the calendar and jobs changes.
-- Existing appointments, report snapshots and delivery approvals are untouched.
begin;
create table public.calendar_backfill_requests (
 request_id uuid primary key,
 actor_id uuid not null references public.profiles(id),
 input jsonb not null,
 event_id uuid not null references public.training_events(id)
);
alter table public.calendar_backfill_requests enable row level security;
revoke all on public.calendar_backfill_requests from public,anon,authenticated;

-- Preserve the installed planner (including grace periods and notification rules).
alter function public.save_training(jsonb) rename to save_training_before_calendar_backfills;
revoke all on function public.save_training_before_calendar_backfills(jsonb) from public,anon,authenticated;

-- Suppress ordinary notices only for the players being backfilled in this transaction.
do $$
declare original text; changed text;
begin
 select pg_get_functiondef('public.participant_notify()'::regprocedure) into original;
 changed:=replace(original,'begin', $guard$begin
 if coalesce(nullif(current_setting('app.calendar_backfill_players',true),''),'[]')::jsonb ? new.player_id::text then return new; end if;$guard$);
 if changed=original then raise exception 'Unexpected participant notification definition'; end if;
 execute changed;
 select pg_get_functiondef('public.queue_training_notice(uuid,uuid,boolean,boolean,uuid)'::regprocedure) into original;
 changed:=replace(original,'begin', $guard$begin
 if coalesce(nullif(current_setting('app.calendar_backfill_players',true),''),'[]')::jsonb ? player::text then return 0; end if;$guard$);
 if changed=original then raise exception 'Unexpected training notice definition'; end if;
 execute changed;
end $$;

create function public.save_training(input jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare eid uuid; request uuid; previous public.calendar_backfill_requests; added jsonb; choices jsonb;
 child text; chosen text; row record; period record; report uuid; report_contact text;
begin
 if not public.is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 -- Lock retries before checking the appointment revision or current membership.
 request:=nullif(input->>'request_id','')::uuid;
 if request is not null then
  perform pg_advisory_xact_lock(hashtextextended(request::text,0));
  select * into previous from public.calendar_backfill_requests where request_id=request;
  if found then
   if previous.actor_id<>auth.uid() or previous.input<>input then raise exception 'Diese Nachtragsanfrage wurde bereits mit anderen Angaben gespeichert. Bitte Termin neu laden.'; end if;
   return previous.event_id;
  end if;
 end if;
 if (input->>'ends_at')::timestamptz>now() then return public.save_training_before_calendar_backfills(input); end if;
 eid:=nullif(input->>'id','')::uuid;
 if eid is not null then perform 1 from public.training_events where id=eid for update; end if;
 select coalesce(jsonb_agg(c),'[]') into added from jsonb_array_elements_text(input->'player_ids') c
 where not exists(select 1 from public.event_participants ep where ep.event_id=eid and ep.player_id=c::uuid and not ep.removed_from_event);
 if jsonb_array_length(added)=0 then return public.save_training_before_calendar_backfills(input); end if;
 if request is null then raise exception 'Anfrage-ID für Nachtrag erforderlich'; end if;
 choices:=coalesce(input->'backfill_attendance','[]');
 if jsonb_array_length(choices)<>jsonb_array_length(added) then raise exception 'Teilnahmestatus für jeden nachgetragenen Spieler erforderlich'; end if;
 for child in select jsonb_array_elements_text(added) loop
  if (select count(*) from jsonb_array_elements(choices) c where c->>'player_id'=child)<>1 then raise exception 'Teilnahmestatus fehlt oder ist doppelt'; end if;
  select c->>'status' into chosen from jsonb_array_elements(choices) c where c->>'player_id'=child;
  if chosen is null or chosen not in ('attended_manual','absent','excused','cancelled') then raise exception 'Ungültiger Nachtragsstatus'; end if;
 end loop;
 perform set_config('app.calendar_backfill_players',added::text,true);
 eid:=public.save_training_before_calendar_backfills(input);
 perform set_config('app.audit_reason','Teilnahme nachgetragen',true);
 update public.event_participants ep set status=(c->>'status')::public.attendance_status,revision=ep.revision+1
 from jsonb_array_elements(choices) c where ep.event_id=eid and ep.player_id=(c->>'player_id')::uuid;
 perform set_config('app.calendar_backfill_players','[]',true);
 -- One new snapshot per affected closed period, never an additional report email.
 for period in select distinct p.id from public.entitlement_periods p join public.event_participants ep on ep.period_id=p.id
  where ep.event_id=eid and added ? ep.player_id::text and p.ends_at<=now() order by p.id loop
  select snapshot->>'whatsapp' into report_contact from public.report_snapshots where period_id=period.id order by version desc limit 1;
  perform set_config('app.backfill_report','true',true);
  perform public.capture_report(period.id,true,coalesce(report_contact,''));
  perform set_config('app.backfill_report','false',true);
 end loop;
 if coalesce((input->>'notify_backfill_parents')::boolean,false) then
  for row in select ep.*,p.starts_at period_start,p.ends_at period_end,pl.first_name||' '||pl.last_name player_name,pa.id parent_id,pa.contact_email
   from public.event_participants ep join public.entitlement_periods p on p.id=ep.period_id
   join public.players pl on pl.id=ep.player_id join public.parent_players pp on pp.player_id=ep.player_id
   join public.parents pa on pa.id=pp.parent_id and pa.archived_at is null
   where ep.event_id=eid and added ? ep.player_id::text loop
   report:=null;
   if row.period_end<=now() then select id into report from public.report_snapshots where period_id=row.period_id order by version desc limit 1; end if;
   insert into public.notification_jobs(idempotency_key,kind,recipient,payload)
   values('calendar-backfill:'||request||':'||row.player_id||':'||row.parent_id,'training_backfill',row.contact_email,
    jsonb_build_object('calendar_backfill',true,'backfill_id',request,'event_id',eid,'participant_id',row.id,
     'parent_id',row.parent_id,'player_id',row.player_id,'player_name',row.player_name,'period_id',row.period_id,
     'period_starts_at',row.period_start,'period_ends_at',row.period_end,'snapshot_id',report,
     'occurred_on',((input->>'starts_at')::timestamptz at time zone 'Europe/Berlin')::date,
     'status',row.status,'duration_minutes',case when row.status='attended_manual' then extract(epoch from ((input->>'ends_at')::timestamptz-(input->>'starts_at')::timestamptz))/60 else 0 end));
  end loop;
 end if;
 insert into public.calendar_backfill_requests values(request,auth.uid(),input,eid);
 return eid;
end $$;
revoke all on function public.save_training(jsonb) from public,anon;
grant execute on function public.save_training(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
