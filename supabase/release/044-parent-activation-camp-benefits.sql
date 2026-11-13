begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Existing and new Camps start without membership benefits. Existing paid quotes
-- keep their own price/discount proofs; no queue status is changed here.
alter table public.camps add column member_benefits_enabled boolean not null default false;
insert into system_settings(key,value) values
 ('parent_self_activation_release','{"enabled":true}'),
 ('camp_portal_mail_release',jsonb_build_object('enabled',true,'starts_after',clock_timestamp()))
 on conflict(key) do nothing;
create function public.parent_email_requires_login(input_email text) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from parents where archived_at is null and lower(btrim(contact_email))=lower(btrim(input_email)))
$$;
create function public.parent_self_activation_available(input_email text) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce((select (value->>'enabled')::boolean from system_settings where key='parent_self_activation_release'),false)
 and (select count(*) from parents where archived_at is null and lower(btrim(contact_email))=lower(btrim(input_email)))=1
 and exists(select 1 from parents p where p.archived_at is null and lower(btrim(p.contact_email))=lower(btrim(input_email))
  and exists(select 1 from parent_stripe_customers s where s.parent_id=p.id)
  and (p.auth_user_id is null or exists(select 1 from auth.users u where u.id=p.auth_user_id and lower(btrim(u.email))=lower(btrim(input_email)))))
$$;
revoke all on function public.parent_email_requires_login(text),public.parent_self_activation_available(text) from public,anon,authenticated;
grant execute on function public.parent_email_requires_login(text),public.parent_self_activation_available(text) to service_role;
create function public.activate_verified_parent() returns uuid language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); mail text; p parents; matches integer; held boolean;
begin
 if not coalesce((select (value->>'enabled')::boolean from system_settings where key='parent_self_activation_release'),false) then return null;end if;
 select lower(btrim(email)) into mail from auth.users where id=uid and email_confirmed_at is not null;
 if uid is null or mail is null then raise exception 'Bestätigte Anmeldung erforderlich';end if;
 if exists(select 1 from profiles where id=uid and role<>'parent') then return null;end if;
 perform pg_advisory_xact_lock(hashtext('family:'||mail));
 select count(*) into matches from parents where auth_user_id=uid and archived_at is null;
 if matches>1 then raise exception 'Familienzuordnung benötigt Prüfung';end if;
 if matches=1 then
  select * into p from parents where auth_user_id=uid and archived_at is null;
  if lower(btrim(p.contact_email)) is distinct from mail then raise exception 'Familienadresse benötigt Prüfung';end if;
  return p.id;
 end if;
 select count(*) into matches from parents where archived_at is null and lower(btrim(contact_email))=mail;
 if matches=0 then return null;end if;
 if matches<>1 then raise exception 'Familienzuordnung benötigt Prüfung';end if;
 select * into p from parents where archived_at is null and lower(btrim(contact_email))=mail for update;
 if p.auth_user_id is not null and p.auth_user_id<>uid then raise exception 'Familienzuordnung benötigt Prüfung';end if;
 if not exists(select 1 from parent_stripe_customers where parent_id=p.id) then raise exception 'Familienzuordnung benötigt Prüfung';end if;
 held:=p.notifications_held;
 insert into profiles(id,role,full_name) values(uid,'parent',p.full_name) on conflict(id) do nothing;
 update parents set auth_user_id=uid where id=p.id;
 -- Preserve the general onboarding hold, including existing trial-sync triggers.
 update parents set notifications_held=held where id=p.id;
 insert into audit_log(actor_id,actor_type,action,table_name,record_id,new_value)
 values(uid,'user','PARENT_SELF_ACTIVATED','parents',p.id,jsonb_build_object('method','verified_email'));
 return p.id;
end $$;
revoke all on function public.activate_verified_parent() from public,anon;
grant execute on function public.activate_verified_parent() to authenticated;
-- Include the Camp policy in both shop snapshots and the edit-version token.
do $$ declare d text; changed text;begin
 d:=pg_get_functiondef('public.camp_product_snapshot(jsonb)'::regprocedure);
 changed:=replace(d,$s$'booking_option_version',c.booking_option_version$s$,$s$'booking_option_version',c.booking_option_version,'member_benefits_enabled',c.member_benefits_enabled$s$);
 if changed=d then raise exception 'Unexpected Camp snapshot baseline';end if;execute changed;
 d:=pg_get_functiondef('public.camp_booking_option_version()'::regprocedure);
 changed:=replace(d,'new.booking_option is distinct from old.booking_option','new.booking_option is distinct from old.booking_option or new.member_benefits_enabled is distinct from old.member_benefits_enabled');
 if changed=d then raise exception 'Unexpected Camp policy version baseline';end if;execute changed;
 d:=pg_get_functiondef('public.reserve_product_purchase_before_gifts(jsonb)'::regprocedure);
 changed:=replace(d,'data:=camp_booking_option_snapshot(camp_product_snapshot(p.published),input);',
 $s$data:=camp_booking_option_snapshot(camp_product_snapshot(p.published),input);
 if data->>'kind'='camp' and not coalesce((data->>'member_benefits_enabled')::boolean,false)
  and (coalesce((input->>'benefit_percent')::int,0)>0 or input->'discount'->>'source'='membership')
 then raise exception 'Rabatt für dieses Camp nicht verfügbar';end if;$s$);
 if changed=d then raise exception 'Unexpected reservation baseline';end if;execute changed;
end $$;
create function public.check_direct_camp_benefit() returns trigger language plpgsql set search_path=public as $$
declare enabled boolean;begin
 if new.booking_origin='portal_checkout' and new.benefit_percent>0 then
  select member_benefits_enabled into enabled from camps where id=new.camp_id for update;
  if enabled is not true then raise exception 'Rabatt für dieses Camp nicht verfügbar';end if;
 end if;return new;
end $$;
revoke all on function public.check_direct_camp_benefit() from public,anon,authenticated;
create trigger check_direct_camp_benefit before insert on camp_bookings for each row execute function public.check_direct_camp_benefit();
-- New, verified portal Camp purchases have a separate prospective mail gate.
-- Legacy invitation/training/report permissions and all held jobs are untouched.
alter function public.parent_delivery_allowed(text,text,jsonb) rename to parent_delivery_allowed_before_portal_camp_release;
revoke all on function public.parent_delivery_allowed_before_portal_camp_release(text,text,jsonb) from public,anon,authenticated,service_role;
create function public.parent_delivery_allowed(recipient text,kind text,payload jsonb) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare release jsonb;begin
 if kind in ('camp_booking_confirmation','camp_reminder_7d','camp_reminder_24h','camp_completion') then
  select value into release from system_settings where key='camp_portal_mail_release';
  if coalesce((release->>'enabled')::boolean,false) and email_preference_allows(recipient,kind,payload)
   and exists(select 1 from camp_bookings b join parents p on p.id=b.parent_id join profiles f on f.id=p.auth_user_id join auth.users u on u.id=f.id
    where b.id::text=payload->>'booking_id' and b.booking_origin in ('portal_checkout','api_checkout')
    and b.paid_at>=(release->>'starts_after')::timestamptz and p.archived_at is null and f.role='parent'
    and u.email_confirmed_at is not null and lower(btrim(u.email))=lower(btrim(recipient)) and lower(btrim(p.contact_email))=lower(btrim(recipient)))
   and camp_notification_allowed(recipient,kind,payload)
  then return true;end if;
 end if;
 return parent_delivery_allowed_before_portal_camp_release(recipient,kind,payload);
end $$;
revoke all on function public.parent_delivery_allowed(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.parent_delivery_allowed(text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
