-- Reuses the existing notification queue and twelve-active-hour attendance deadline.
-- Enable camp_mail_release only after the updated runner has been deployed.
begin;
alter table public.camp_bookings add column attendance_status text not null default 'planned' check(attendance_status in ('planned','attended','absent','excused'));
alter table public.camp_bookings add column attendance_confirmed_at timestamptz;
insert into system_settings(key,value) values('camp_mail_release',jsonb_build_object('enabled',false,'starts_after',now())) on conflict(key) do nothing;

create function public.camp_notification_allowed(recipient text, kind text, payload jsonb) returns boolean language plpgsql stable security definer set search_path=public as $$
declare b camp_bookings; c camps; first_at timestamptz; last_at timestamptz; due_at timestamptz; release jsonb;
begin
 select value into release from system_settings where key='camp_mail_release';
 if coalesce((release->>'enabled')::boolean,false) is not true then return false; end if;
 select * into b from camp_bookings where id::text=payload->>'booking_id';
 if not found or b.status<>'paid' or b.attendance_status in ('absent','excused') then return false; end if;
 select * into c from camps where id=b.camp_id;
 if c.payment_mode<>'live' or c.status not in ('open','closed') then return false; end if;
 select min((d->>'starts_at')::timestamptz),max((d->>'ends_at')::timestamptz) into first_at,last_at from jsonb_array_elements(c.days) d;
 if first_at<(release->>'starts_after')::timestamptz or first_at is distinct from (payload->>'starts_at')::timestamptz or last_at is distinct from (payload->>'ends_at')::timestamptz then return false; end if;
 if not exists(select 1 from parents p join parent_players pp on pp.parent_id=p.id join players k on k.id=pp.player_id where p.id=b.parent_id and k.id=b.player_id and p.archived_at is null and k.archived_at is null and lower(btrim(p.contact_email))=lower(btrim(recipient))) then return false; end if;
 if kind='camp_reminder_7d' then
  due_at:=((first_at at time zone 'Europe/Berlin')-interval '7 days') at time zone 'Europe/Berlin';
  return b.paid_at<=due_at and now()>=due_at and now()<first_at-interval '24 hours';
 elsif kind='camp_reminder_24h' then
  due_at:=first_at-interval '24 hours';
  return b.paid_at<=due_at and now()>=due_at and now()<first_at;
 elsif kind='camp_completion' then
  return b.attendance_status='attended' and now()>=calculate_auto_at(last_at);
 end if;
 return false;
end $$;
revoke all on function public.camp_notification_allowed(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.camp_notification_allowed(text,text,jsonb) to service_role;

create or replace function public.parent_delivery_allowed(recipient text, kind text, payload jsonb) returns boolean language plpgsql stable security definer set search_path=public as $$
declare settings jsonb; recipient_email text:=lower(btrim(recipient));
begin
 select value into settings from system_settings where key='portal_delivery_release';
 if coalesce((settings->>'enabled')::boolean,false) is not true or not coalesce(settings->'recipients','[]'::jsonb) ? recipient_email then return false; end if;
 if kind='invitation' then
  return coalesce((payload->>'manual_release')::boolean,false) and coalesce(settings->'invitation_recipients','[]'::jsonb) ? recipient_email
   and exists(select 1 from parent_invitations i join parents p on p.id=i.parent_id where i.id::text=payload->>'invitation_id' and lower(btrim(i.email))=recipient_email and lower(btrim(p.contact_email))=recipient_email and i.consumed_at is null and i.expires_at>now() and p.archived_at is null);
 end if;
 if kind in ('camp_reminder_7d','camp_reminder_24h','camp_completion') then
  if not camp_notification_allowed(recipient,kind,payload) then return false; end if;
 elsif kind not in ('planning','attendance','correction','change','report','stamp_card') then return false; end if;
 return exists(select 1 from parents p join profiles f on f.id=p.auth_user_id join auth.users u on u.id=f.id
  where lower(btrim(p.contact_email))=recipient_email and lower(btrim(u.email))=recipient_email and u.email_confirmed_at is not null and f.role='parent' and p.archived_at is null and not p.notifications_held);
end $$;
revoke all on function public.parent_delivery_allowed(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.parent_delivery_allowed(text,text,jsonb) to service_role;
create function public.camp_plan_notifications() returns int language plpgsql security definer set search_path=public as $$
declare row record; kind_value text; body jsonb; inserted int; total int:=0; release jsonb;
begin
 select value into release from system_settings where key='camp_mail_release';
 if coalesce((release->>'enabled')::boolean,false) is not true then return 0; end if;
 for row in select b.id,b.attendance_status,p.contact_email,c.days from camp_bookings b join camps c on c.id=b.camp_id join parents p on p.id=b.parent_id where b.status='paid' and c.payment_mode='live' and c.status in ('open','closed') for update of b loop
  select jsonb_build_object('booking_id',row.id,'starts_at',min((d->>'starts_at')::timestamptz),'ends_at',max((d->>'ends_at')::timestamptz)) into body from jsonb_array_elements(row.days) d;
  if (body->>'starts_at')::timestamptz<(release->>'starts_after')::timestamptz then continue; end if;
  if row.attendance_status='planned' and calculate_auto_at((body->>'ends_at')::timestamptz)<=now() then
   update camp_bookings set attendance_status='attended',attendance_confirmed_at=now() where id=row.id and attendance_status='planned';
  end if;
  foreach kind_value in array array['camp_reminder_7d','camp_reminder_24h','camp_completion'] loop
   if parent_delivery_allowed(row.contact_email,kind_value,body) then
    insert into notification_jobs(idempotency_key,kind,recipient,payload) values(kind_value||':'||row.id,kind_value,row.contact_email,body) on conflict(idempotency_key) do update set payload=excluded.payload,recipient=excluded.recipient,status='pending',available_at=now() where notification_jobs.status in ('pending','held') and (notification_jobs.payload is distinct from excluded.payload or notification_jobs.recipient is distinct from excluded.recipient);
    get diagnostics inserted=row_count; total:=total+inserted;
   end if;
  end loop;
 end loop;
 return total;
end $$;
create function public.camp_set_attendance(booking_id uuid, actor_id uuid, new_status text) returns void language plpgsql security definer set search_path=public as $$
declare b camp_bookings; c camps; last_at timestamptz;
begin
 if not exists(select 1 from profiles p where p.id=$2 and (p.role='admin' or (p.role='staff' and exists(select 1 from staff_profiles s where s.id=p.id and s.active)))) then raise exception 'Team required'; end if;
 if $3 not in ('planned','attended','absent','excused') then raise exception 'Invalid attendance'; end if;
 select * into b from camp_bookings where id=$1 for update;
 if not found or b.status<>'paid' then raise exception 'Confirmed booking required'; end if;
 select * into c from camps where id=b.camp_id;
 select max((d->>'ends_at')::timestamptz) into last_at from jsonb_array_elements(c.days) d;
 if $3='attended' and now()<last_at then raise exception 'Camp has not ended'; end if;
 if b.attendance_status=$3 then return; end if;
 update camp_bookings set attendance_status=$3,attendance_confirmed_at=case when $3='attended' then now() end where id=b.id;
 insert into audit_log(actor_id,actor_type,action,table_name,record_id,old_value,new_value) values($2,'user','CAMP_ATTENDANCE','camp_bookings',b.id,jsonb_build_object('attendance_status',b.attendance_status),jsonb_build_object('attendance_status',$3));
end $$;
revoke all on function public.camp_plan_notifications(),public.camp_set_attendance(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.camp_plan_notifications(),public.camp_set_attendance(uuid,uuid,text) to service_role;
do $$ declare definition text; begin
 select pg_get_functiondef('public.camp_reset_v0()'::regprocedure) into definition;
 definition:=replace(definition,'drop function public.camp_confirm_payment(jsonb);','drop function if exists public.camp_plan_notifications();
 drop function if exists public.camp_set_attendance(uuid,uuid,text);
 drop function if exists public.camp_notification_allowed(text,text,jsonb);
 drop function public.camp_confirm_payment(jsonb);');
 execute definition;
end $$;
-- Do not emit notifications or start processing from a migration.
commit;
