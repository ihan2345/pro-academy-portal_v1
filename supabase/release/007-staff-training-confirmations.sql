-- Apply after 006; deploy the runner with training_staff_attendance support BEFORE this release.
-- Team copies are explicit only; existing parent delivery gates are unchanged.
begin;
create function public.training_staff_recipient(recipient text) returns uuid
language sql stable security definer set search_path=public as $$
 select u.id from auth.users u join profiles p on p.id=u.id
 where lower(btrim(u.email))=lower(btrim(recipient)) and u.email_confirmed_at is not null
 and (p.role='admin' or (p.role='staff' and exists(select 1 from staff_profiles s where s.id=p.id and s.active)))
$$;
create function public.validate_training_staff_recipients(emails text[]) returns text[]
language plpgsql stable security definer set search_path=public as $$
declare email text; result text[]:='{}';
begin
 if not is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 if coalesce(cardinality(emails),0)=0 then raise exception 'Mindestens eine Team-Adresse hinzufügen.' using errcode='22023'; end if;
 for email in select distinct lower(btrim(value)) from unnest(emails) value loop
  if email is null or training_staff_recipient(email) is null then
   raise exception 'Nur bestätigte aktive Coach-/Admin-Konten sind erlaubt: %',coalesce(email,'(leer)') using errcode='22023';
  end if;
  result:=array_append(result,email);
 end loop;
 return result;
end $$;
create function public.training_staff_attendance_details(event uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select training_notice_details(event)||jsonb_build_object('participants',coalesce(
  (select jsonb_agg(jsonb_build_object('id',p.id,'name',p.first_name||' '||p.last_name) order by p.last_name,p.first_name,p.id)
   from event_participants ep join players p on p.id=ep.player_id where ep.event_id=event
   and not ep.removed_from_event and ep.status in ('attended_auto','attended_manual')),'[]'::jsonb))
$$;

-- The existing claim/hold functions use this same gate for every message.
do $copy$
declare definition text;
begin
 select pg_get_functiondef('public.parent_delivery_allowed(text,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'parent_delivery_allowed.', 'parent_delivery_allowed_before_staff_training.');
 execute replace(definition,'FUNCTION public.parent_delivery_allowed(', 'FUNCTION public.parent_delivery_allowed_before_staff_training(');
end $copy$;
create or replace function public.parent_delivery_allowed(recipient text, kind text, payload jsonb) returns boolean
language plpgsql stable security definer set search_path=public as $$
begin
 if kind<>'training_staff_attendance' then return parent_delivery_allowed_before_staff_training(recipient,kind,payload); end if;
 return coalesce(coalesce((select (value->>'enabled')::boolean from system_settings where key='portal_delivery_release'),false)
  and payload->>'manual_staff_training_notice'='true'
  and coalesce(payload->>'training_notice_discarded','false')<>'true'
  and training_staff_recipient(recipient)::text=payload->>'staff_user_id',false);
end $$;

create function public.submit_training_notifications_with_staff(event uuid, selections jsonb, staff_emails text[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e training_events; emails text[]; email text; staff_id uuid; details jsonb; body jsonb;
 result jsonb; queued integer:=0; skipped integer:=0;
begin
 if not is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 emails:=validate_training_staff_recipients(staff_emails);
 select * into e from training_events where id=event for update;
 if not found or e.status<>'scheduled' or e.ends_at>now() then
  raise exception 'Team-Bestätigungen sind nur für beendete, nicht abgesagte Trainings möglich.' using errcode='22023';
 end if;
 if not coalesce((select (value->>'enabled')::boolean from system_settings where key='portal_delivery_release'),false) then
  raise exception 'Der Mailversand ist global gesperrt.' using errcode='22023';
 end if;
 perform 1 from event_participants where event_id=event order by id for update;
 details:=training_staff_attendance_details(event);
 if jsonb_array_length(details->'participants')=0 then
  raise exception 'Bitte zuerst mindestens eine tatsächliche Teilnahme bestätigen.' using errcode='22023';
 end if;
 foreach email in array emails loop
  staff_id:=training_staff_recipient(email);
  perform 1 from notification_jobs n where n.kind='training_staff_attendance' and n.payload->>'event_id'=event::text
   and lower(btrim(n.recipient))=email order by id for update;
  if exists(select 1 from notification_jobs n where n.kind='training_staff_attendance' and n.payload->>'event_id'=event::text
   and lower(btrim(n.recipient))=email and n.status in ('processing','uncertain')) then
   raise exception 'Versand läuft bereits oder ist unklar. Bitte zuerst den Versandstatus prüfen: %',email using errcode='22023';
  end if;
  -- Coalesce unclaimed older summaries. Identical summaries are never sent twice.
  update notification_jobs n set status='held',payload=payload||'{"training_notice_discarded":true}',last_error='Durch aktuelle Team-Bestätigung ersetzt'
   where n.kind='training_staff_attendance' and n.payload->>'event_id'=event::text and lower(btrim(n.recipient))=email
   and n.status in ('pending','held','failed') and n.payload->'notice_details' is distinct from details;
  if exists(select 1 from notification_jobs n where n.kind='training_staff_attendance' and n.payload->>'event_id'=event::text
   and lower(btrim(n.recipient))=email and n.payload->'notice_details'=details and n.status in ('sent','pending')) then
   skipped:=skipped+1; continue;
  end if;
  body:=jsonb_build_object('training_notice',true,'manual_staff_training_notice',true,'staff_user_id',staff_id,'requested_by',auth.uid(),'event_id',event,'notice_details',details);
  insert into notification_jobs(idempotency_key,kind,recipient,payload)
   values('training-staff-attendance:'||event||':'||staff_id||':'||md5(email||details::text),'training_staff_attendance',email,body)
   on conflict(idempotency_key) do update set status='pending',payload=excluded.payload,available_at=now(),last_error=null,attempts=0
    where notification_jobs.status in ('held','failed');
  if found then queued:=queued+1; end if;
 end loop;
 -- All recipients are validated first; a failed team selection cannot partially send parent mail.
 result:=submit_training_notifications(event,selections);
 if queued>0 then
  insert into audit_log(actor_id,actor_type,action,table_name,record_id,new_value)
   values(auth.uid(),'user','MANUAL_STAFF_TRAINING_NOTICE','training_events',event,jsonb_build_object('recipients',emails,'queued',queued));
 end if;
 return result||jsonb_build_object('staff_queued',queued,'staff_skipped',skipped);
end $$;

create function public.prepare_staff_training_notification(job_id uuid, lease uuid, expected_details jsonb default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j notification_jobs; e training_events; details jsonb;
begin
 select * into j from notification_jobs where id=job_id and lease_token=lease and status='processing' for update;
 if not found or j.kind<>'training_staff_attendance' then return null; end if;
 select * into e from training_events where id::text=j.payload->>'event_id';
 details:=training_staff_attendance_details(e.id);
 if e.id is null or e.status<>'scheduled' or e.ends_at>now() or jsonb_array_length(details->'participants')=0
  or not coalesce(parent_delivery_allowed(j.recipient,j.kind,j.payload),false) then
  update notification_jobs set status='held',locked_at=null,last_error='Team-Empfänger oder bestätigte Teilnahmen nicht mehr freigegeben' where id=j.id;
  return null;
 end if;
 if expected_details is not null and expected_details is distinct from details then
  update notification_jobs set status='pending',locked_at=null,available_at=now() where id=j.id;
  return null;
 end if;
 j.payload:=j.payload||jsonb_build_object('notice_details',details);
 update notification_jobs set payload=j.payload where id=j.id;
 return to_jsonb(j);
end $$;
revoke all on function public.training_staff_recipient(text),public.training_staff_attendance_details(uuid),public.parent_delivery_allowed_before_staff_training(text,text,jsonb),public.prepare_staff_training_notification(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_staff_training_notification(uuid,uuid,jsonb) to service_role;
revoke all on function public.validate_training_staff_recipients(text[]),public.submit_training_notifications_with_staff(uuid,jsonb,text[]) from public,anon;
grant execute on function public.validate_training_staff_recipients(text[]),public.submit_training_notifications_with_staff(uuid,jsonb,text[]) to authenticated;
notify pgrst,'reload schema';
commit;
