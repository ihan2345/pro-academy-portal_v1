-- Extend the existing queue; activate only after deploying the matching mail template.
begin;
update system_settings set value=value||jsonb_build_object('booking_confirmation_enabled',false,'booking_confirmation_from',now()) where key='camp_mail_release';
do $migration$
declare original text; changed text; signature text;
begin
 foreach signature in array array['public.parent_delivery_allowed(text,text,jsonb)','public.camp_plan_notifications()'] loop
  select pg_get_functiondef(signature::regprocedure) into original;
  changed:=replace(original,'''camp_reminder_7d'',''camp_reminder_24h'',''camp_completion''','''camp_booking_confirmation'',''camp_reminder_7d'',''camp_reminder_24h'',''camp_completion''');
  if changed=original then raise exception 'Unexpected notification definition: %',signature; end if;
  execute changed;
 end loop;
 select pg_get_functiondef('public.camp_notification_allowed(text,text,jsonb)'::regprocedure) into original;
 changed:=replace(original,'if kind=''camp_reminder_7d'' then',
 'if kind=''camp_booking_confirmation'' then
  return coalesce((release->>''booking_confirmation_enabled'')::boolean,false)
   and b.paid_at >= (release->>''booking_confirmation_from'')::timestamptz
   and b.paid_amount is not null and b.review_reason is null and now()<first_at;
 elsif kind=''camp_reminder_7d'' then');
 if changed=original then raise exception 'Unexpected Camp eligibility definition'; end if;
 execute changed;
end $migration$;
commit;
