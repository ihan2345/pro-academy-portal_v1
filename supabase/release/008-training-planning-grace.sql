-- LOCAL preparation only. Apply after release/007 with the matching application.
-- Training starts may use the existing entitlement until the end of the following
-- Berlin calendar day, but only after an explicit, appointment-specific confirmation.
-- No entitlement dates, subscription state, mail approvals or existing bookings change.
begin;

alter table public.event_participants add column planning_grace_confirmation jsonb;

create function public.training_planning_end(period_end timestamptz) returns timestamptz
language sql immutable strict set search_path=public as $$
 select (((period_end at time zone 'Europe/Berlin')::date + 2)::timestamp at time zone 'Europe/Berlin')
$$;
revoke all on function public.training_planning_end(timestamptz) from public,anon;
grant execute on function public.training_planning_end(timestamptz) to authenticated,service_role;

-- Patch the released function in place so mail approval/removal handling stays intact.
do $patch$
declare original text; changed text; old_query text; new_query text;
begin
 select pg_get_functiondef('public.save_training(jsonb)'::regprocedure) into original;
 changed:=replace(original,'selected_period uuid;', 'selected_period uuid; selected_end timestamptz; grace_confirmation jsonb;');
 if changed=original then raise exception 'Unexpected save_training variables'; end if;
 original:=changed;
 old_query:=$old$select id into selected_period from public.entitlement_periods where player_id=child and event_start>=starts_at and event_start<ends_at and status in ('active','trialing') and (case when input->>'event_type'='Athletiktraining' then athletics_units>0 else included_units-athletics_units>0 end) order by starts_at desc limit 1;$old$;
 new_query:=$new$select id,ends_at into selected_period,selected_end from public.entitlement_periods
 where player_id=child and event_start>=starts_at and event_start<public.training_planning_end(ends_at)
 and status in ('active','trialing')
 and (case when input->>'event_type'='Athletiktraining' then athletics_units>0 else included_units-athletics_units>0 end)
 order by (event_start<ends_at) desc, starts_at desc limit 1;
 grace_confirmation:=null;
 if selected_period is not null and event_start>=selected_end then
  if not exists(
   select 1 from jsonb_array_elements(coalesce(input->'grace_confirmations','[]'::jsonb)) c
   where c->>'player_id'=child::text and c->>'period_id'=selected_period::text
    and (c->>'starts_at')::timestamptz=event_start
    and (c->>'period_ends_at')::timestamptz=selected_end
    and c->>'event_type'=input->>'event_type'
  ) then raise exception 'Die Einheit liegt außerhalb des Abozeitraums, bitte prüfen. Bestätigung für Kind % erforderlich.',child; end if;
  grace_confirmation:=jsonb_build_object('player_id',child,'period_id',selected_period,
   'starts_at',event_start,'event_type',input->>'event_type','period_ends_at',selected_end,
   'confirmed_by',auth.uid(),'confirmed_at',now());
 end if;$new$;
 changed:=replace(original,old_query,new_query);
 if changed=original then raise exception 'Unexpected training entitlement selection'; end if;
 original:=changed;
 changed:=replace(original,'event_participants(event_id,player_id,period_id) values(eid,child,selected_period)',
  'event_participants(event_id,player_id,period_id,planning_grace_confirmation) values(eid,child,selected_period,grace_confirmation)');
 if changed=original then raise exception 'Unexpected participant insert'; end if;
 original:=changed;
 changed:=replace(original,'period_id=excluded.period_id,removed_from_event=false,',
  'period_id=excluded.period_id,planning_grace_confirmation=excluded.planning_grace_confirmation,removed_from_event=false,');
 if changed=original then raise exception 'Unexpected participant update'; end if;
 execute changed;
end $patch$;

-- Keep stored confirmation valid for attendance, cancellation and automatic jobs.
-- Missing/stale confirmation cannot bypass the date boundary via participant writes.
do $patch$
declare original text; changed text;
begin
 select pg_get_functiondef('public.participant_validate()'::regprocedure) into original;
 changed:=replace(original,'e.starts_at<p.ends_at', $new$(e.starts_at<p.ends_at or (
  e.starts_at<public.training_planning_end(p.ends_at)
  and new.planning_grace_confirmation->>'player_id'=new.player_id::text
  and new.planning_grace_confirmation->>'period_id'=p.id::text
  and (new.planning_grace_confirmation->>'period_ends_at')::timestamptz=p.ends_at
  and (new.planning_grace_confirmation->>'starts_at')::timestamptz=e.starts_at
  and new.planning_grace_confirmation->>'event_type'=e.event_type
  and new.planning_grace_confirmation->>'confirmed_by' is not null
  and new.planning_grace_confirmation->>'confirmed_at' is not null
 ))$new$);
 if changed=original then raise exception 'Unexpected participant validation'; end if;
 execute changed;
end $patch$;
commit;
