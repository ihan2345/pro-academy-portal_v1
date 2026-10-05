-- Apply ONLY after deploying a runner supporting training_removed/training_reminder.
-- Reuses the existing outbox, leases, SMTP and audit trail. Does not release historical held mail.
begin;
alter table public.event_participants add column mail_joined_at timestamptz;
insert into public.system_settings(key,value) values('training_reminder_release',jsonb_build_object('starts_after',now()));

-- Explicit approvals are scoped to one current family link and mail type.
create table public.training_mail_approvals (
 event_id uuid not null references public.training_events(id) on delete cascade,
 player_id uuid not null references public.players(id) on delete cascade,
 parent_id uuid not null references public.parents(id) on delete cascade,
 recipient text not null,
 kind text not null check(kind in ('training_reminder','attendance')),
 approved_by uuid not null references public.profiles(id),
 approved_at timestamptz not null default now(),
 primary key(event_id,player_id,parent_id,recipient,kind)
);
alter table public.training_mail_approvals enable row level security;
revoke all on public.training_mail_approvals from anon,authenticated;

create function public.training_notice_details(event uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('title',e.title,'event_type',e.event_type,'starts_at',e.starts_at,'ends_at',e.ends_at,
  'location_name',l.name,'address',l.address,'trainer_name',s.display_name,'location_id',e.location_id,'trainer_id',e.trainer_id)
 from training_events e join locations l on l.id=e.location_id join staff_profiles s on s.id=e.trainer_id where e.id=event
$$;

create function public.training_parent_activated(parent uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from parents p join profiles f on f.id=p.auth_user_id join auth.users u on u.id=f.id
  where p.id=parent and f.role='parent' and u.email_confirmed_at is not null and lower(btrim(u.email))=lower(btrim(p.contact_email)))
$$;

create function public.queue_training_notice(event uuid, player uuid, removed boolean default false, manual boolean default false, selected_parent uuid default null) returns integer
language plpgsql security definer set search_path=public as $$
declare e training_events; ep event_participants; p record; previous notification_jobs; pending_job uuid; body jsonb; mail_kind text; details jsonb; unresolved boolean; informed boolean; queued integer:=0;
begin
 select * into e from training_events where id=event for update;
 select * into ep from event_participants where event_id=event and player_id=player;
 if ep.id is null then return 0; end if;
 details:=training_notice_details(event);
 for p in select pa.* from parents pa join parent_players pp on pp.parent_id=pa.id where pp.player_id=player and pa.archived_at is null and (selected_parent is null or pa.id=selected_parent) loop
  if manual and training_parent_activated(p.id) then continue; end if;
  select * into previous from notification_jobs n where n.kind in ('planning','change','training_removed') and n.status='sent' and exists(select 1 from notification_deliveries d where d.job_id=n.id and d.status='sent' and d.provider='proton' and lower(btrim(d.recipient))=lower(btrim(n.recipient)))
   and n.payload->>'event_id'=event::text and n.payload->>'player_id'=player::text and lower(btrim(n.recipient))=lower(btrim(p.contact_email))
   order by (n.payload->>'event_revision')::int desc nulls last,(n.payload->>'participant_revision')::int desc nulls last,n.updated_at desc,n.id desc limit 1;
  select exists(select 1 from notification_jobs n where n.kind='planning' and n.status='sent' and exists(select 1 from notification_deliveries d where d.job_id=n.id and d.status='sent' and d.provider='proton' and lower(btrim(d.recipient))=lower(btrim(n.recipient))) and n.payload->>'event_id'=event::text and n.payload->>'player_id'=player::text and lower(btrim(n.recipient))=lower(btrim(p.contact_email))) into informed;
  select exists(select 1 from notification_jobs n where n.kind in ('planning','change','training_removed') and n.status in ('processing','uncertain')
   and n.payload->>'event_id'=event::text and n.payload->>'player_id'=player::text and lower(btrim(n.recipient))=lower(btrim(p.contact_email))) into unresolved;
  -- Keep one unclaimed notice; superseded jobs remain visible, but can never be resent.
  select id into pending_job from notification_jobs n where n.payload->>'training_notice'='true' and n.kind in ('planning','change','training_removed')
   and n.status in ('pending','held','failed') and coalesce(n.payload->>'training_notice_discarded','false')<>'true'
   and n.payload->>'event_id'=event::text and n.payload->>'player_id'=player::text and lower(btrim(n.recipient))=lower(btrim(p.contact_email))
   order by n.created_at,n.id limit 1 for update;
  update notification_jobs n set status='held',payload=payload||'{"training_notice_discarded":true}',last_error='Durch aktuellen Trainingsstand ersetzt'
   where n.kind in ('planning','change','training_removed') and n.status in ('pending','held','failed') and n.id is distinct from pending_job
   and n.payload->>'event_id'=event::text and n.payload->>'player_id'=player::text and lower(btrim(n.recipient))=lower(btrim(p.contact_email));
  if (not e.notify_parents and not manual) or (removed and not informed and not unresolved)
   or (not unresolved and previous.payload->'notice_details'=details and (previous.kind='training_removed')=removed) then
   update notification_jobs set status='held',payload=payload||'{"training_notice_discarded":true}',last_error='Keine neue Elternbenachrichtigung erforderlich' where id=pending_job;
   continue;
  end if;
  mail_kind:=case when removed then 'training_removed' when not informed and not unresolved then 'planning' else 'change' end;
  body:=jsonb_build_object('training_notice',true,'manual_training_notice',manual,'parent_id',p.id,'event_id',event,'player_id',player,'participant_id',ep.id,
   'period_id',ep.period_id,'event_revision',e.revision,'participant_revision',ep.revision,'starts_at',e.starts_at,'ends_at',e.ends_at,'notice_details',details,'removed',removed);
  if pending_job is not null then
   if manual and exists(select 1 from notification_jobs where id=pending_job and status='pending' and payload=body) then continue; end if;
   update notification_jobs set kind=mail_kind,payload=body,status='pending',available_at=now(),last_error=null where id=pending_job;
  else
   insert into notification_jobs(idempotency_key,kind,recipient,payload)
    values('training-notice:'||event||':'||player||':'||p.id||':'||e.revision||':'||ep.revision||':'||md5(lower(btrim(p.contact_email))),mail_kind,p.contact_email,body)
    on conflict(idempotency_key) do nothing;
  end if;
  if found then queued:=queued+1; end if;
 end loop;
 return queued;
end $$;

-- Keep attendance and correction behavior; route membership changes through one notice planner.
create or replace function public.participant_notify() returns trigger language plpgsql security definer set search_path=public as $$
declare kind_value text; e training_events; r record;
begin
 select * into e from training_events where id=new.event_id;
 if TG_OP='INSERT' and new.status='planned' then
  perform queue_training_notice(new.event_id,new.player_id,false); return new;
 elsif TG_OP='UPDATE' and new.removed_from_event is distinct from old.removed_from_event then
  if new.removed_from_event then delete from training_mail_approvals where event_id=new.event_id and player_id=new.player_id; end if;
  perform queue_training_notice(new.event_id,new.player_id,new.removed_from_event); return new;
 elsif TG_OP='UPDATE' and new.status is distinct from old.status and new.status in ('attended_auto','attended_manual') and old.status not in ('attended_auto','attended_manual') then kind_value:='attendance';
 elsif TG_OP='UPDATE' and new.status is distinct from old.status and current_setting('app.correction_mail',true)='true' then kind_value:='correction';
 else return new; end if;
 for r in select p.id,p.contact_email from parents p join parent_players pp on pp.parent_id=p.id where pp.player_id=new.player_id and p.archived_at is null loop
  if kind_value='attendance' and exists(select 1 from notification_jobs n where n.kind='attendance'
   and n.payload->>'event_id'=new.event_id::text and n.payload->>'player_id'=new.player_id::text
   and lower(btrim(n.recipient))=lower(btrim(r.contact_email))) then continue; end if;
  insert into notification_jobs(idempotency_key,kind,recipient,payload) values(kind_value||':'||new.id||':'||new.revision||':'||r.id,kind_value,r.contact_email,
   jsonb_build_object('participant_id',new.id,'player_id',new.player_id,'parent_id',r.id,'event_id',new.event_id,'period_id',new.period_id,'status',new.status,'starts_at',e.starts_at,'ends_at',e.ends_at,'title',e.title,'event_type',e.event_type,'location_id',e.location_id,'trainer_id',e.trainer_id)) on conflict(idempotency_key) do nothing;
 end loop;
 return new;
end $$;

-- Patch only the old unconditional change-mail block, preserving all training validations.
do $patch$
declare original text; changed text; old_block text;
begin
 select pg_get_functiondef('public.save_training(jsonb)'::regprocedure) into original;
 old_block:=$old$ if old_event.id is not null and coalesce((input->>'notify_parents')::boolean,true) then
 for r in select ep.id,p.contact_email,p.id parent_id,ep.player_id,ep.period_id from public.event_participants ep join public.parent_players pp on pp.player_id=ep.player_id join public.parents p on p.id=pp.parent_id where ep.event_id=eid loop
 insert into public.notification_jobs(idempotency_key,kind,recipient,payload) values('change:'||eid||':'||(old_event.revision+1)||':'||r.parent_id||':'||r.player_id,'change',r.contact_email,jsonb_build_object('event_id',eid,'player_id',r.player_id,'participant_id',r.id,'period_id',r.period_id,'starts_at',event_start,'ends_at',event_end)) on conflict do nothing;
 end loop; end if;$old$;
 changed:=replace(original,old_block,$new$ if old_event.id is not null and (
  (old_event.title,old_event.starts_at,old_event.ends_at,old_event.location_id,old_event.trainer_id,old_event.event_type)
  is distinct from (input->>'title',event_start,event_end,(input->>'location_id')::uuid,(input->>'trainer_id')::uuid,input->>'event_type')
  or old_event.notify_parents is distinct from coalesce((input->>'notify_parents')::boolean,true)) then
  for r in select player_id from public.event_participants where event_id=eid and not removed_from_event loop
   perform public.queue_training_notice(eid,r.player_id,false);
  end loop;
 end if;$new$);
 if changed=original then raise exception 'Unexpected save_training definition; no changes applied'; end if;
 original:=changed;
 changed:=replace(original,'do update set period_id=excluded.period_id,removed_from_event=false,','do update set mail_joined_at=case when event_participants.removed_from_event then now() else event_participants.mail_joined_at end,period_id=excluded.period_id,removed_from_event=false,');
 if changed=original then raise exception 'Unexpected participant upsert; no changes applied'; end if;
 execute changed;
end $patch$;

-- Preserve all existing invitation/Camp/report rules through the original function.
do $copy$
declare definition text;
begin
 select pg_get_functiondef('public.parent_delivery_allowed(text,text,jsonb)'::regprocedure) into definition;
 execute replace(definition,'FUNCTION public.parent_delivery_allowed(', 'FUNCTION public.parent_delivery_allowed_before_training(');
end $copy$;
create or replace function public.parent_delivery_allowed(recipient text, kind text, payload jsonb) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare settings jsonb;
begin
 if payload->>'training_notice_discarded'='true' then return false; end if;
 if kind not in ('planning','change','training_removed','training_reminder','attendance') then
  return parent_delivery_allowed_before_training(recipient,kind,payload);
 end if;
 select value into settings from system_settings where key='portal_delivery_release';
 if coalesce((settings->>'enabled')::boolean,false) is not true or not coalesce(settings->'recipients','[]'::jsonb) ? lower(btrim(recipient)) then return false; end if;
 if not exists(select 1 from parents p join parent_players pp on pp.parent_id=p.id
  where pp.player_id::text=payload->>'player_id' and lower(btrim(p.contact_email))=lower(btrim(recipient)) and p.archived_at is null
   and (payload->>'parent_id' is null or p.id::text=payload->>'parent_id')) then return false; end if;
 -- Explicit approvals bypass onboarding only, never the global/recipient gates above.
 if kind in ('planning','change') and payload->>'manual_training_notice'='true'
  and exists(select 1 from parents p where p.id::text=payload->>'parent_id' and not training_parent_activated(p.id)) then return true; end if;
 if kind in ('training_reminder','attendance') and exists(select 1 from training_mail_approvals a
  join parents p on p.id=a.parent_id where a.event_id::text=payload->>'event_id'
  and a.player_id::text=payload->>'player_id' and (payload->>'parent_id' is null or a.parent_id::text=payload->>'parent_id')
  and a.recipient=lower(btrim(parent_delivery_allowed.recipient)) and a.kind=parent_delivery_allowed.kind
  and not training_parent_activated(p.id)) then return true; end if;
 return parent_delivery_allowed_before_training(recipient,
  case when kind in ('training_removed','training_reminder') then 'planning' else kind end,payload);
end $$;

-- Preserve only explicitly requested manual planning notices across onboarding holds.
create or replace function public.hold_existing_family_notifications() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.notifications_held then
  update notification_jobs n set status='held' where n.status='pending'
   and lower(btrim(n.recipient))=lower(btrim(new.contact_email))
   and not (n.kind in ('planning','change','training_reminder','attendance') and parent_delivery_allowed(n.recipient,n.kind,n.payload));
 end if;
 return new;
end $$;

create function public.plan_training_reminders() returns integer language plpgsql security definer set search_path=public as $$
declare r record; total integer:=0; inserted integer; activation timestamptz;
begin
 select (value->>'starts_after')::timestamptz into activation from system_settings where key='training_reminder_release';
 for r in select e.id event_id,e.starts_at,e.ends_at,ep.id participant_id,ep.player_id,ep.period_id,p.id parent_id,p.contact_email
  from training_events e join event_participants ep on ep.event_id=e.id join parent_players pp on pp.player_id=ep.player_id join parents p on p.id=pp.parent_id
  where e.status='scheduled' and (e.notify_parents or exists(select 1 from training_mail_approvals a where a.event_id=e.id and a.player_id=ep.player_id and a.parent_id=p.id and a.recipient=lower(btrim(p.contact_email)) and a.kind='training_reminder')) and ep.status='planned' and not ep.removed_from_event and p.archived_at is null
   and e.starts_at>now() and e.starts_at-interval '24 hours'<=now() and e.starts_at-interval '24 hours'>=activation
   and coalesce(ep.mail_joined_at,ep.created_at)<=e.starts_at-interval '24 hours'
 loop
  -- Per event/child/recipient, even if the event is subsequently rescheduled.
  insert into notification_jobs(idempotency_key,kind,recipient,payload)
   values('training-reminder:'||r.event_id||':'||r.player_id||':'||r.parent_id||':'||md5(lower(btrim(r.contact_email))),'training_reminder',r.contact_email,
    jsonb_build_object('training_notice',true,'parent_id',r.parent_id,'event_id',r.event_id,'player_id',r.player_id,'participant_id',r.participant_id,'period_id',r.period_id,'starts_at',r.starts_at,'ends_at',r.ends_at,'notice_details',training_notice_details(r.event_id)))
   on conflict(idempotency_key) do update set available_at=now(),payload=excluded.payload
    where notification_jobs.status='pending' and notification_jobs.available_at>now();
  get diagnostics inserted=row_count; total:=total+inserted;
 end loop;
 return total;
end $$;

-- One in-flight notice per event/child/recipient, including legacy jobs. Uncertain SMTP results block follow-ups.
create or replace function public.claim_notifications(batch_size int default 20) returns setof public.notification_jobs
language plpgsql security definer set search_path=public as $$
begin
 update notification_jobs set status='uncertain',last_error='Versandleasing abgelaufen; SMTP-Ergebnis manuell prüfen' where status='processing' and locked_at<now()-interval '10 minutes';
 return query update notification_jobs j set status='processing',locked_at=now(),lease_token=gen_random_uuid(),attempts=attempts+1
 where j.id in(select n.id from notification_jobs n where n.status='pending' and n.available_at<=now() and parent_delivery_allowed(n.recipient,n.kind,n.payload)
  and (n.payload->>'training_notice' is distinct from 'true' or not exists(
   select 1 from notification_jobs prior where prior.id<>n.id and prior.kind in ('planning','change','training_removed','training_reminder')
    and prior.payload->>'event_id'=n.payload->>'event_id' and prior.payload->>'player_id'=n.payload->>'player_id' and lower(btrim(prior.recipient))=lower(btrim(n.recipient))
    and (prior.status in ('processing','uncertain') or (prior.status='pending' and prior.available_at<=now() and (prior.created_at,prior.id)<(n.created_at,n.id)))))
  order by n.created_at,n.id for update of n skip locked limit least(batch_size,100)) returning j.*;
end $$;

-- Last eligibility check immediately before SMTP, including live membership and stale snapshots.
create function public.prepare_training_notification(job_id uuid, lease uuid, expected_details jsonb default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j notification_jobs; e training_events; ep event_participants; valid boolean; body jsonb; informed boolean;
begin
 select * into j from notification_jobs where id=job_id and lease_token=lease and status='processing' for update;
 if not found then return null; end if;
 select * into e from training_events where id::text=j.payload->>'event_id';
 select * into ep from event_participants where event_id=e.id and player_id::text=j.payload->>'player_id';
 valid:=e.id is not null and ep.id is not null and parent_delivery_allowed(j.recipient,j.kind,j.payload);
 if j.kind='attendance' then
  valid:=valid and e.status='scheduled' and e.ends_at<=now() and not ep.removed_from_event and ep.status in ('attended_auto','attended_manual');
 else
  valid:=valid and e.status='scheduled' and (e.notify_parents or (j.kind in ('planning','change') and j.payload->>'manual_training_notice'='true') or (j.kind='training_reminder' and exists(select 1 from training_mail_approvals a where a.event_id=e.id and a.player_id=ep.player_id and a.parent_id::text=j.payload->>'parent_id' and a.recipient=lower(btrim(j.recipient)) and a.kind=j.kind))) and e.starts_at>now();
  if j.kind='training_removed' then valid:=valid and ep.removed_from_event;
  else valid:=valid and not ep.removed_from_event and ep.status='planned'; end if;
 end if;
 select exists(select 1 from notification_jobs n where n.status='sent' and exists(select 1 from notification_deliveries d where d.job_id=n.id and d.status='sent' and d.provider='proton' and lower(btrim(d.recipient))=lower(btrim(n.recipient))) and n.kind='planning' and n.payload->>'event_id'=e.id::text and n.payload->>'player_id'=ep.player_id::text and lower(btrim(n.recipient))=lower(btrim(j.recipient))) into informed;
 if j.kind='training_removed' and not informed then valid:=false; end if;
 if j.kind='training_reminder' and valid then
  -- Delay an unclaimed reminder after rescheduling; do not replay a previously sent one.
  if e.starts_at-interval '24 hours'>now() then
   update notification_jobs set status='pending',available_at=e.starts_at-interval '24 hours',locked_at=null where id=j.id;
   return null;
  end if;
  valid:=coalesce(ep.mail_joined_at,ep.created_at)<=e.starts_at-interval '24 hours';
 elsif j.kind<>'attendance' and j.payload->>'training_notice'='true' and j.payload->'notice_details' is distinct from training_notice_details(e.id) then
  valid:=false;
 end if;
 if expected_details is not null and j.kind='training_reminder' and expected_details is distinct from training_notice_details(e.id) then
  update notification_jobs set status='pending',available_at=now(),locked_at=null where id=j.id;
  return null;
 end if;
 if not coalesce(valid,false) then
  update notification_jobs set status='held',payload=payload||'{"training_notice_discarded":true}',last_error='Trainingsbenachrichtigung nicht mehr aktuell oder freigegeben',locked_at=null where id=j.id;
  return null;
 end if;
 if j.kind in ('planning','change') then j.kind:=case when not informed then 'planning' else 'change' end; end if;
 body:=j.payload||jsonb_build_object('starts_at',e.starts_at,'ends_at',e.ends_at,'notice_details',training_notice_details(e.id));
 update notification_jobs set kind=j.kind,payload=body where id=j.id;
 return to_jsonb(j)||jsonb_build_object('payload',body);
end $$;

revoke all on function public.training_parent_activated(uuid),public.training_notice_details(uuid),public.queue_training_notice(uuid,uuid,boolean,boolean,uuid),public.parent_delivery_allowed_before_training(text,text,jsonb),public.plan_training_reminders(),public.prepare_training_notification(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.plan_training_reminders(),public.prepare_training_notification(uuid,uuid,jsonb) to service_role;
-- The preview is authoritative: UI state is never used to authorize delivery.
create function public.training_notification_options(event uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e training_events; r record; k text; state text; reason text; j notification_jobs; rows jsonb:='[]'; active boolean; allowed boolean; approved boolean;
begin
 if not public.is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into e from training_events where id=event;
 if not found then raise exception 'Termin nicht gefunden'; end if;
 for r in select ep.*,p.id parent_id,p.full_name,p.contact_email,pl.first_name||' '||pl.last_name player_name
  from event_participants ep join players pl on pl.id=ep.player_id
  join parent_players pp on pp.player_id=ep.player_id join parents p on p.id=pp.parent_id
  where ep.event_id=event and not ep.removed_from_event and p.archived_at is null order by pl.first_name,p.full_name
 loop
  active:=training_parent_activated(r.parent_id);
  foreach k in array case when e.ends_at<=now() then array['attendance'] else array['planning','training_reminder','attendance'] end loop
   state:='ready'; reason:='Auswählbar';
   allowed:=parent_delivery_allowed(r.contact_email,'planning',jsonb_build_object('parent_id',r.parent_id,'player_id',r.player_id,'manual_training_notice',true));
   select exists(select 1 from training_mail_approvals a where a.event_id=event and a.player_id=r.player_id
    and a.parent_id=r.parent_id and a.recipient=lower(btrim(r.contact_email)) and a.kind=k) into approved;
   select * into j from notification_jobs n where n.payload->>'event_id'=event::text and n.payload->>'player_id'=r.player_id::text
    and lower(btrim(n.recipient))=lower(btrim(r.contact_email)) and coalesce(n.payload->>'training_notice_discarded','false')<>'true'
    and ((k='planning' and n.kind in ('planning','change','training_removed')) or n.kind=k)
    and (n.status in ('processing','uncertain') or (n.status='sent' and exists(select 1 from notification_deliveries d where d.job_id=n.id and d.status='sent' and d.provider='proton' and lower(btrim(d.recipient))=lower(btrim(n.recipient)))) or n.status='pending')
    order by case when n.status in ('processing','uncertain') then 0 else 1 end,
     (n.payload->>'event_revision')::int desc nulls last,(n.payload->>'participant_revision')::int desc nulls last,n.updated_at desc,n.id desc limit 1;
   if e.status<>'scheduled' then state:='blocked'; reason:='Termin abgesagt';
   elsif active then
    state:='automatic'; reason:='Portal aktiviert – automatischer Versand';
    if not parent_delivery_allowed_before_training(r.contact_email,case when k='training_reminder' then 'planning' else k end,jsonb_build_object('player_id',r.player_id))
     or (k<>'attendance' and not e.notify_parents) then reason:='Portal aktiviert – automatischer Versand derzeit gesperrt'; end if;
   elsif not allowed then state:='blocked'; reason:='Versandfreigabe gesperrt';
   elsif j.status in ('processing','uncertain') then state:='blocked'; reason:=case when j.status='uncertain' then 'Versandergebnis unklar – zuerst prüfen' else 'Versand läuft bereits' end;
   elsif k<>'planning' and j.status='sent' then state:='sent'; reason:='Bereits versendet';
   elsif k='planning' and j.kind<>'training_removed' and j.payload->'notice_details'=training_notice_details(event) and j.status in ('sent','pending') then
    state:=case when j.status='sent' then 'sent' else 'queued' end; reason:=case when j.status='sent' then 'Aktueller Stand bereits versendet' else 'Aktueller Stand bereits eingeplant' end;
   elsif k<>'planning' and j.status='pending' then state:='queued'; reason:='Bereits eingeplant';
   elsif approved and (k<>'attendance' or e.ends_at>now()) then state:='approved'; reason:='Bereits freigegeben';
   elsif k='planning' and (e.starts_at<=now() or r.status<>'planned') then state:='blocked'; reason:='Planung nur vor Trainingsbeginn';
   elsif k<>'planning' and e.ends_at>now() and e.starts_at-interval '24 hours'<=now() then state:='blocked'; reason:='Neue Freigaben ab 24 Stunden vor Beginn gesperrt';
   elsif k='attendance' and e.ends_at<=now() and r.status='planned' then state:='unconfirmed'; reason:='Teilnahme zuerst bestätigen';
   elsif r.status not in ('planned','attended_auto','attended_manual') then state:='blocked'; reason:='Keine bestätigbare Teilnahme';
   end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('parent_id',r.parent_id,'player_id',r.player_id,'parent_name',r.full_name,'player_name',r.player_name,
    'kind',k,'state',state,'reason',reason,'enabled',state='ready','activated',active));
  end loop;
 end loop;
 return jsonb_build_object('rows',rows,'ended',e.ends_at<=now(),'buffer_active',e.ends_at<=now() and e.auto_attendance_at>now(),
  'unconfirmed',coalesce((select jsonb_agg(jsonb_build_object('id',ep.id,'name',p.first_name||' '||p.last_name)) from event_participants ep join players p on p.id=ep.player_id
   where ep.event_id=event and not ep.removed_from_event and ep.status='planned'),'[]'::jsonb));
end $$;

create function public.submit_training_notifications(event uuid, selections jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e training_events; options jsonb; choice jsonb; item jsonb; p parents; ep event_participants; j notification_jobs; body jsonb; queued integer:=0; approved integer:=0; blocked integer:=0;
begin
 if not public.is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 if jsonb_typeof(selections)<>'array' or jsonb_array_length(selections)>1000 then raise exception 'Ungültige Auswahl'; end if;
 select * into e from training_events where id=event for update;
 if not found or e.status<>'scheduled' then raise exception 'Termin nicht verfügbar'; end if;
 -- Locks also serialize with the automatic/manual attendance update.
 perform 1 from event_participants where event_id=event order by id for update;
 options:=training_notification_options(event);
 for choice in select distinct value from jsonb_array_elements(selections) loop
  select value into item from jsonb_array_elements(options->'rows') where value->>'parent_id'=choice->>'parent_id'
   and value->>'player_id'=choice->>'player_id' and value->>'kind'=choice->>'kind';
  if item is null then raise exception 'Auswahl gehört nicht zum Termin'; end if;
  if item->>'state' in ('queued','sent','approved') then continue; end if;
  if item->>'enabled'<>'true' then blocked:=blocked+1; continue; end if;
  select * into p from parents where id=(choice->>'parent_id')::uuid;
  select * into ep from event_participants where event_id=event and player_id=(choice->>'player_id')::uuid;
  if choice->>'kind'='planning' then
   queued:=queued+queue_training_notice(event,ep.player_id,false,true,p.id);
  else
   insert into training_mail_approvals(event_id,player_id,parent_id,recipient,kind,approved_by)
    values(event,ep.player_id,p.id,lower(btrim(p.contact_email)),choice->>'kind',auth.uid()) on conflict do nothing;
   if found then approved:=approved+1; end if;
   if choice->>'kind'='attendance' and ep.status in ('attended_auto','attended_manual') and e.ends_at<=now() then
    select * into j from notification_jobs n where n.kind='attendance' and n.payload->>'event_id'=event::text
     and n.payload->>'player_id'=ep.player_id::text and lower(btrim(n.recipient))=lower(btrim(p.contact_email))
     order by n.created_at desc,n.id desc limit 1 for update;
    body:=jsonb_build_object('participant_id',ep.id,'player_id',ep.player_id,'parent_id',p.id,'event_id',event,'period_id',ep.period_id,
     'status',ep.status,'starts_at',e.starts_at,'ends_at',e.ends_at,'title',e.title,'event_type',e.event_type,'location_id',e.location_id,'trainer_id',e.trainer_id);
    if j.id is null then
     insert into notification_jobs(idempotency_key,kind,recipient,payload)
      values('attendance:'||ep.id||':'||ep.revision||':'||p.id,'attendance',p.contact_email,body) on conflict do nothing;
    elsif j.status in ('held','failed') then
     update notification_jobs set status='pending',available_at=now(),payload=body,last_error=null where id=j.id;
    end if;
    if found then queued:=queued+1; end if;
   end if;
  end if;
 end loop;
 if queued+approved>0 then
  insert into audit_log(actor_id,actor_type,action,table_name,record_id,new_value)
   values(auth.uid(),'user','MANUAL_TRAINING_NOTICE','training_events',event,jsonb_build_object('queued',queued,'approved',approved,'selections',selections));
 end if;
 return jsonb_build_object('queued',queued,'approved',approved,'blocked',blocked);
end $$;

create function public.confirm_planned_training_attendance(event uuid, confirmed boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e training_events; r record; total integer:=0;
begin
 if not public.is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 if confirmed is not true then raise exception 'Ausdrückliche Bestätigung erforderlich'; end if;
 select * into e from training_events where id=event for update;
 if not found or e.status<>'scheduled' or e.ends_at>now() then raise exception 'Nur beendete, nicht abgesagte Trainings können bestätigt werden'; end if;
 for r in select id from event_participants where event_id=event and status='planned' and not removed_from_event order by id for update loop
  perform set_attendance(r.id,'attended_manual','Alle geplanten Teilnahmen manuell bestätigt',false);
  total:=total+1;
 end loop;
 return jsonb_build_object('confirmed',total,'participants',(select jsonb_agg(to_jsonb(ep)) from event_participants ep where ep.event_id=event));
end $$;
revoke all on function public.training_notification_options(uuid),public.submit_training_notifications(uuid,jsonb),public.confirm_planned_training_attendance(uuid,boolean) from public,anon;
grant execute on function public.training_notification_options(uuid),public.submit_training_notifications(uuid,jsonb),public.confirm_planned_training_attendance(uuid,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
