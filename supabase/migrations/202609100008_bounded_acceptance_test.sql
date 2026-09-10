-- Separate, service-only entry point. The normal batch job is unchanged.
create function public.confirm_acceptance_attendance(
  participant uuid, player uuid, parent uuid, recipient text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.event_participants; e public.training_events; changed int:=0; job uuid;
begin
 select te.* into e from public.training_events te
 join public.event_participants ep on ep.event_id=te.id where ep.id=participant
 for update of te;
 if not found then raise exception 'Testtermin fehlt'; end if;
 select * into p from public.event_participants where id=participant for update;
 if p.player_id<>player or p.removed_from_event or e.notify_parents
    or not exists(select 1 from public.event_private_notes where id=e.id and note like 'LIVE-TEST-BOUNDED:%')
    or (select count(*) from public.event_participants where event_id=e.id)<>1
 then raise exception 'Kein isolierter Testtermin'; end if;
 if (select count(*) from public.parent_players where player_id=player)<>1
    or not exists(select 1 from public.parent_players pp join public.parents pa on pa.id=pp.parent_id
      where pp.player_id=player and pa.id=parent and lower(pa.contact_email)=lower(recipient) and pa.archived_at is null)
 then raise exception 'Testempfänger stimmt nicht überein'; end if;
 perform set_config('app.audit_reason','Begrenzter Livetest: automatische Teilnahme nach regulärer Pufferzeit',true);
 -- Same deadline/status predicates as auto_attendance(), restricted to one row.
 update public.event_participants set status='attended_auto',revision=revision+1
 where id=participant and status='planned' and e.status='scheduled' and e.auto_attendance_at<=now();
 get diagnostics changed=row_count;
 select * into p from public.event_participants where id=participant;
 if p.status='attended_auto' then
   select id into job from public.notification_jobs
   where idempotency_key='attendance:'||p.id||':'||p.revision||':'||parent
     and kind='attendance' and lower(notification_jobs.recipient)=lower(confirm_acceptance_attendance.recipient);
 end if;
 return jsonb_build_object('confirmed',changed,'job_id',job);
end $$;
revoke execute on function public.confirm_acceptance_attendance(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_acceptance_attendance(uuid,uuid,uuid,text) to service_role;
