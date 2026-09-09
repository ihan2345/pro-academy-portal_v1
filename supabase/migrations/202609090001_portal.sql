-- ProAcademy standalone schema. No tables or auth features from the marketing site.
create type public.app_role as enum ('parent','staff','admin');
create type public.attendance_status as enum ('planned','attended_auto','attended_manual','absent','excused','cancelled');
create table public.profiles (id uuid primary key references auth.users(id) on delete restrict, full_name text not null default '', role public.app_role not null default 'parent', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.parents (id uuid primary key default gen_random_uuid(), auth_user_id uuid unique references public.profiles(id), full_name text not null, contact_email text not null, billing_email text, stripe_customer_id text unique, archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.players (id uuid primary key default gen_random_uuid(), first_name text not null, last_name text not null, birth_year int not null check(birth_year between 1990 and 2100), team text not null default '', archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.parent_players (id uuid primary key default gen_random_uuid(), parent_id uuid not null references public.parents(id), player_id uuid not null references public.players(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(parent_id,player_id));
create table public.staff_profiles (id uuid primary key references public.profiles(id), display_name text not null, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.plans (id uuid primary key default gen_random_uuid(), name text not null check(name in ('FirstTouch','GameChanger','Pro-Player')), stripe_price_id text unique, included_units int not null, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check((name='FirstTouch' and included_units=4) or (name in ('GameChanger','Pro-Player') and included_units=8)));
create table public.subscriptions (id uuid primary key default gen_random_uuid(), parent_id uuid references public.parents(id), stripe_customer_id text not null, stripe_subscription_id text not null unique, status text not null, billing_cycle_anchor timestamptz, stripe_data jsonb not null default '{}', needs_review boolean not null default false, synced_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.subscription_players (id uuid primary key default gen_random_uuid(), subscription_id uuid not null references public.subscriptions(id), stripe_item_id text not null, player_id uuid not null references public.players(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(subscription_id,stripe_item_id));
create table public.entitlement_periods (id uuid primary key default gen_random_uuid(), player_id uuid not null references public.players(id), subscription_id uuid not null references public.subscriptions(id), stripe_customer_id text not null, stripe_item_id text not null, stripe_price_id text not null, product_name text not null, starts_at timestamptz not null, ends_at timestamptz not null, included_units int not null check(included_units>0), status text not null default 'active', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(ends_at>starts_at), unique(subscription_id,stripe_item_id,player_id,starts_at));
create table public.locations (id uuid primary key default gen_random_uuid(), name text not null, address text not null, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.training_events (id uuid primary key default gen_random_uuid(), title text not null, starts_at timestamptz not null, ends_at timestamptz not null, location_id uuid not null references public.locations(id), trainer_id uuid not null references public.staff_profiles(id), event_type text not null default 'Gruppentraining', status text not null default 'scheduled' check(status in ('scheduled','cancelled')), auto_attendance_at timestamptz not null, notify_parents boolean not null default true, revision int not null default 1, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(ends_at>starts_at), check(ends_at<=starts_at+interval '12 hours'));
create table public.event_private_notes (id uuid primary key references public.training_events(id), note text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.event_participants (id uuid primary key default gen_random_uuid(), event_id uuid not null references public.training_events(id), player_id uuid not null references public.players(id), period_id uuid not null references public.entitlement_periods(id), status public.attendance_status not null default 'planned', reason text, revision int not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(event_id,player_id));
create table public.parent_invitations (id uuid primary key default gen_random_uuid(), parent_id uuid not null references public.parents(id), email text not null, token_hash text not null unique, expires_at timestamptz not null, consumed_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.notification_jobs (id uuid primary key default gen_random_uuid(), idempotency_key text not null unique, kind text not null, recipient text not null, payload jsonb not null, status text not null default 'pending' check(status in ('pending','processing','sent','failed','uncertain')), attempts int not null default 0, available_at timestamptz not null default now(), locked_at timestamptz, lease_token uuid, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.notification_deliveries (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.notification_jobs(id), attempt int not null, recipient text not null, provider text not null, status text not null, message_id text, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(job_id,attempt));
create table public.report_snapshots (id uuid primary key default gen_random_uuid(), period_id uuid not null references public.entitlement_periods(id), player_id uuid not null references public.players(id), version int not null default 1 check(version>0), snapshot jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(period_id,version));
create table public.report_files (id uuid primary key default gen_random_uuid(), snapshot_id uuid not null unique references public.report_snapshots(id), storage_path text not null unique, sha256 text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.report_deliveries (id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.report_snapshots(id), parent_id uuid not null references public.parents(id), job_id uuid not null unique references public.notification_jobs(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id), actor_type text not null default 'user', action text not null, table_name text not null, record_id uuid not null, old_value jsonb, new_value jsonb, reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.stripe_webhook_events (id uuid primary key default gen_random_uuid(), stripe_event_id text not null unique, type text not null, payload jsonb not null, stripe_created bigint not null, status text not null default 'pending', attempts int not null default 0, locked_at timestamptz, lease_token uuid, available_at timestamptz not null default now(), processed_at timestamptz, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.system_settings (id uuid primary key default gen_random_uuid(), key text not null unique, value jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.job_runs (id uuid primary key default gen_random_uuid(), status text not null, result jsonb, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index participants_player on public.event_participants(player_id);
create index participants_period on public.event_participants(period_id,status);
create index participants_due on public.event_participants(event_id) where status='planned';
create index parents_auth on public.parents(auth_user_id);
create index parent_players_player on public.parent_players(player_id);
create index periods_player on public.entitlement_periods(player_id,starts_at,ends_at);
create index events_due on public.training_events(auto_attendance_at) where status='scheduled';
create index events_start on public.training_events(starts_at);
create index notification_due on public.notification_jobs(status,available_at);
create index stripe_due on public.stripe_webhook_events(status,available_at);
create index invitation_expiry on public.parent_invitations(expires_at) where consumed_at is null;
create index report_player on public.report_snapshots(player_id);

create function public.current_role() returns public.app_role language sql stable security definer set search_path=public as $$ select role from public.profiles where id=auth.uid() $$;
create function public.is_team() returns boolean language sql stable security definer set search_path=public as $$ select coalesce(public.current_role() in ('staff','admin'),false) $$;
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select coalesce(public.current_role()='admin',false) $$;
create function public.owns_player(pid uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.parent_players pp join public.parents p on p.id=pp.parent_id where pp.player_id=pid and p.auth_user_id=auth.uid()) $$;
create function public.owns_event(eid uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.event_participants ep where ep.event_id=eid and public.owns_player(ep.player_id)) $$;
create function public.touch_updated() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create function public.audit_change() returns trigger language plpgsql security definer set search_path=public as $$ begin
 insert into public.audit_log(actor_id,actor_type,action,table_name,record_id,old_value,new_value,reason) values(auth.uid(),case when auth.uid() is null then 'systemjob' else 'user' end,TG_OP,TG_TABLE_NAME,coalesce(new.id,old.id),case when TG_OP<>'INSERT' then to_jsonb(old) end,case when TG_OP<>'DELETE' then to_jsonb(new) end,current_setting('app.audit_reason',true)); return coalesce(new,old); end $$;
DO $$ declare t text; begin
 foreach t in array array['profiles','parents','players','parent_players','staff_profiles','plans','subscriptions','subscription_players','entitlement_periods','locations','training_events','event_private_notes','event_participants','parent_invitations','notification_jobs','notification_deliveries','report_snapshots','report_files','report_deliveries','audit_log','stripe_webhook_events','system_settings','job_runs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create trigger touch_updated before update on public.%I for each row execute function public.touch_updated()',t);
 execute format('create policy admin_read on public.%I for select to authenticated using (public.is_admin())',t);
 end loop;
 foreach t in array array['parents','players','parent_players','staff_profiles','plans','locations','system_settings'] loop
 execute format('create policy admin_insert on public.%I for insert to authenticated with check (public.is_admin())',t);
 execute format('create policy admin_update on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())',t);
 end loop;
 foreach t in array array['profiles','parents','players','parent_players','staff_profiles','plans','subscriptions','subscription_players','entitlement_periods','locations','training_events','event_participants','report_snapshots','report_files','report_deliveries','system_settings'] loop
 execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function public.audit_change()',t);
 end loop;
end $$;
create policy own_profile on public.profiles for select to authenticated using (id=auth.uid());
create policy own_parent on public.parents for select to authenticated using(auth_user_id=auth.uid() and archived_at is null);
create policy own_player on public.players for select to authenticated using(public.owns_player(id) or public.is_team());
create policy own_links on public.parent_players for select to authenticated using(parent_id in(select id from public.parents where auth_user_id=auth.uid()));
create policy read_trainers on public.staff_profiles for select to authenticated using(true);
create policy read_locations on public.locations for select to authenticated using(true);
create policy read_plans on public.plans for select to authenticated using(true);
create policy own_subscription on public.subscriptions for select to authenticated using(parent_id in(select id from public.parents where auth_user_id=auth.uid()));
create policy own_period on public.entitlement_periods for select to authenticated using(public.owns_player(player_id) or public.is_team());
create policy own_event on public.training_events for select to authenticated using(public.owns_event(id) or public.is_team());
create policy own_participant on public.event_participants for select to authenticated using(public.owns_player(player_id) or public.is_team());
create policy team_notes on public.event_private_notes for select to authenticated using(public.is_team());
create policy own_report on public.report_snapshots for select to authenticated using(public.owns_player(player_id));
create policy own_file on public.report_files for select to authenticated using(exists(select 1 from public.report_snapshots s where s.id=snapshot_id and public.owns_player(s.player_id)));

-- All table writes go through RLS or restricted transactional procedures.
grant usage on schema public to authenticated,service_role;
grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
revoke update,delete on public.audit_log,public.report_snapshots,public.report_files,public.notification_deliveries from authenticated,service_role;

-- Defend historical entitlement snapshots even from accidental privileged updates.
create function public.freeze_period() returns trigger language plpgsql as $$ begin if (to_jsonb(new)-'updated_at'-'status') is distinct from (to_jsonb(old)-'updated_at'-'status') then raise exception 'Historical entitlement periods are immutable'; end if; return new; end $$;
create trigger immutable_period before update on public.entitlement_periods for each row execute function public.freeze_period();
create function public.calculate_auto_at(event_end timestamptz, zone text default 'Europe/Berlin') returns timestamptz language plpgsql immutable as $$
declare cursor_at timestamptz:=event_end; local_at timestamp; next_midnight timestamptz; remaining interval:=interval '12 hours'; available interval;
begin loop
 local_at:=cursor_at at time zone zone;
 if local_at::time < time '06:00' then cursor_at:=(local_at::date+time '06:00') at time zone zone; end if;
 next_midnight:=(((cursor_at at time zone zone)::date+1)::timestamp) at time zone zone;
 available:=next_midnight-cursor_at;
 if remaining<available then return cursor_at+remaining; end if;
 remaining:=remaining-available;
 cursor_at:=(((next_midnight at time zone zone)::date)+time '06:00') at time zone zone;
 if remaining=interval '0' then return cursor_at; end if;
 end loop;
end $$;
create function public.event_deadline() returns trigger language plpgsql as $$ begin new.auto_attendance_at=public.calculate_auto_at(new.ends_at); return new; end $$;
create trigger event_deadline before insert or update of ends_at on public.training_events for each row execute function public.event_deadline();

create function public.participant_validate() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.entitlement_periods p join public.training_events e on e.id=new.event_id where p.id=new.period_id and p.player_id=new.player_id and (new.status='cancelled' or (e.starts_at>=p.starts_at and e.starts_at<p.ends_at))) then raise exception 'Kein passender Leistungszeitraum'; end if;
 if new.status<>'cancelled' and exists(select 1 from public.training_events where id=new.event_id and status='cancelled') then raise exception 'Stornierte Termine können nicht erneut belegt werden'; end if;
 if new.status in ('attended_auto','attended_manual') and exists(select 1 from public.training_events where id=new.event_id and (status='cancelled' or ends_at>now())) then raise exception 'Zukünftige oder stornierte Termine können nicht bestätigt werden'; end if;
 return new;
end $$;
create trigger participant_validate before insert or update on public.event_participants for each row execute function public.participant_validate();
create function public.participant_notify() returns trigger language plpgsql security definer set search_path=public as $$
declare kind_value text; e public.training_events; r record;
begin
 select * into e from public.training_events where id=new.event_id;
 if TG_OP='INSERT' and new.status='planned' and e.notify_parents then kind_value:='planning';
 elsif TG_OP='UPDATE' and new.status is distinct from old.status and new.status in ('attended_auto','attended_manual') and old.status not in ('attended_auto','attended_manual') then kind_value:='attendance';
 elsif TG_OP='UPDATE' and new.status is distinct from old.status and current_setting('app.correction_mail',true)='true' then kind_value:='correction';
 else return new; end if;
 for r in select p.id,p.contact_email from public.parents p join public.parent_players pp on pp.parent_id=p.id where pp.player_id=new.player_id and p.archived_at is null loop
 insert into public.notification_jobs(idempotency_key,kind,recipient,payload) values(kind_value||':'||new.id||':'||new.revision||':'||r.id,kind_value,r.contact_email,jsonb_build_object('participant_id',new.id,'player_id',new.player_id,'event_id',new.event_id,'period_id',new.period_id,'status',new.status,'starts_at',e.starts_at,'ends_at',e.ends_at,'title',e.title,'location_id',e.location_id,'trainer_id',e.trainer_id)) on conflict(idempotency_key) do nothing;
 end loop; return new;
end $$;
create trigger participant_notify after insert or update on public.event_participants for each row execute function public.participant_notify();

create function public.save_training(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
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
 if exists(select 1 from public.event_participants where event_id=eid and status in ('attended_auto','attended_manual')) and (event_start<>old_event.starts_at or event_end<>old_event.ends_at) then raise exception 'Zuerst bestätigte Teilnahmen korrigieren, dann Terminzeit ändern'; end if;
 update public.training_events set title=input->>'title',starts_at=event_start,ends_at=event_end,location_id=(input->>'location_id')::uuid,trainer_id=(input->>'trainer_id')::uuid,event_type=input->>'event_type',notify_parents=coalesce((input->>'notify_parents')::boolean,true),revision=revision+1 where id=eid;
 else
 insert into public.training_events(title,starts_at,ends_at,location_id,trainer_id,event_type,auto_attendance_at,notify_parents,created_by) values(input->>'title',event_start,event_end,(input->>'location_id')::uuid,(input->>'trainer_id')::uuid,input->>'event_type',public.calculate_auto_at(event_end),coalesce((input->>'notify_parents')::boolean,true),auth.uid()) returning id into eid;
 end if;
 insert into public.event_private_notes(id,note) values(eid,coalesce(input->>'note','')) on conflict(id) do update set note=excluded.note;
 update public.event_participants set status='cancelled',reason='Aus Termin entfernt',revision=revision+1 where event_id=eid and not(player_id=any(children)) and status<>'cancelled';
 foreach child in array children loop
 select id into selected_period from public.entitlement_periods where player_id=child and event_start>=starts_at and event_start<ends_at and status in ('active','trialing') order by starts_at desc limit 1;
 if selected_period is null then raise exception 'Kein aktiver Leistungszeitraum für Kind %',child; end if;
 insert into public.event_participants(event_id,player_id,period_id) values(eid,child,selected_period) on conflict(event_id,player_id) do update set period_id=excluded.period_id,status=case when event_participants.status='cancelled' then 'planned'::public.attendance_status else event_participants.status end,revision=event_participants.revision+1;
 end loop;
 if old_event.id is not null and coalesce((input->>'notify_parents')::boolean,true) then
 for r in select ep.id,p.contact_email,p.id parent_id,ep.player_id,ep.period_id from public.event_participants ep join public.parent_players pp on pp.player_id=ep.player_id join public.parents p on p.id=pp.parent_id where ep.event_id=eid loop
 insert into public.notification_jobs(idempotency_key,kind,recipient,payload) values('change:'||eid||':'||(old_event.revision+1)||':'||r.parent_id||':'||r.player_id,'change',r.contact_email,jsonb_build_object('event_id',eid,'player_id',r.player_id,'participant_id',r.id,'period_id',r.period_id,'starts_at',event_start,'ends_at',event_end)) on conflict do nothing;
 end loop; end if;
 return eid;
end $$;
create function public.set_attendance(participant uuid, new_status public.attendance_status, correction_reason text, send_correction boolean default false) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 if new_status='attended_auto' then raise exception 'Systemstatus nicht manuell setzen'; end if;
 if length(trim(coalesce(correction_reason,'')))<3 then raise exception 'Begründung erforderlich'; end if;
 perform set_config('app.audit_reason',correction_reason,true); perform set_config('app.correction_mail',send_correction::text,true);
 update public.event_participants set status=new_status,reason=correction_reason,revision=revision+1 where id=participant and status<>new_status;
end $$;
create function public.cancel_training(event uuid, cancellation_reason text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 if length(trim(coalesce(cancellation_reason,'')))<3 then raise exception 'Begründung erforderlich'; end if;
 perform set_config('app.audit_reason',cancellation_reason,true); perform set_config('app.correction_mail','true',true);
 update public.training_events set status='cancelled',revision=revision+1 where id=event and status<>'cancelled';
 update public.event_participants set status='cancelled',reason=cancellation_reason,revision=revision+1 where event_id=event and status<>'cancelled';
end $$;
create function public.auto_attendance(as_of timestamptz default now()) returns int language plpgsql security definer set search_path=public as $$
declare count_updated int;
begin
 perform set_config('app.audit_reason','Automatische Teilnahme nach zwölf aktiven Pufferstunden',true);
 update public.event_participants p set status='attended_auto',revision=p.revision+1 from public.training_events e where p.event_id=e.id and p.status='planned' and e.status='scheduled' and e.auto_attendance_at<=least(as_of,now());
 get diagnostics count_updated=row_count; return count_updated;
end $$;
create function public.accept_invitation(invitation_hash text) returns uuid language plpgsql security definer set search_path=public as $$
declare inv public.parent_invitations; parent_record public.parents; verified text;
begin
 select lower(email) into verified from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if verified is null then raise exception 'Bestätigte Anmeldung erforderlich'; end if;
 select * into inv from public.parent_invitations where token_hash=invitation_hash and consumed_at is null and expires_at>now() for update;
 if not found or lower(inv.email)<>verified then raise exception 'Einladung ungültig oder abgelaufen'; end if;
 select * into parent_record from public.parents where id=inv.parent_id for update;
 if parent_record.archived_at is not null then raise exception 'Elternkonto archiviert'; end if;
 if parent_record.auth_user_id is not null and parent_record.auth_user_id<>auth.uid() then raise exception 'Elternkonto bereits verbunden'; end if;
 if parent_record.stripe_customer_id is null then raise exception 'Stripe-Zuordnung fehlt'; end if;
 insert into public.profiles(id,full_name) values(auth.uid(),parent_record.full_name) on conflict(id) do nothing;
 update public.parents set auth_user_id=auth.uid() where id=inv.parent_id;
 update public.parent_invitations set consumed_at=now() where id=inv.id;
 return inv.parent_id;
end $$;
create function public.claim_notifications(batch_size int default 20) returns setof public.notification_jobs language plpgsql security definer set search_path=public as $$ begin
 -- SMTP leases are not automatically retried: delivery may already have happened.
 update public.notification_jobs set status='uncertain',last_error='Versandleasing abgelaufen; SMTP-Ergebnis manuell prüfen' where status='processing' and locked_at<now()-interval '10 minutes';
 return query update public.notification_jobs j set status='processing',locked_at=now(),lease_token=gen_random_uuid(),attempts=attempts+1 where j.id in(select id from public.notification_jobs where status='pending' and available_at<=now() order by created_at for update skip locked limit least(batch_size,100)) returning j.*;
end $$;
create function public.claim_stripe(batch_size int default 20) returns setof public.stripe_webhook_events language plpgsql security definer set search_path=public as $$ begin
 return query update public.stripe_webhook_events j set status='processing',locked_at=now(),lease_token=gen_random_uuid(),attempts=attempts+1 where j.id in(select id from public.stripe_webhook_events where (status='pending' and available_at<=now()) or (status='processing' and locked_at<now()-interval '10 minutes') order by stripe_created for update skip locked limit least(batch_size,100)) returning j.*;
end $$;
create function public.change_role(target uuid, new_role public.app_role) returns void language plpgsql security definer set search_path=public as $$ begin
 if not public.is_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 if target=auth.uid() then raise exception 'Eigene Rolle nicht ändern'; end if;
 update public.profiles set role=new_role where id=target;
end $$;
-- Lock down EXECUTE (Postgres grants PUBLIC execution by default).
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.current_role(),public.is_admin(),public.is_team(),public.owns_player(uuid),public.owns_event(uuid) to authenticated;
grant execute on function public.save_training(jsonb),public.set_attendance(uuid,public.attendance_status,text,boolean),public.cancel_training(uuid,text),public.accept_invitation(text),public.change_role(uuid,public.app_role) to authenticated;
grant execute on all functions in schema public to service_role;

-- Private bucket, no client uploads or object-listing policy.
insert into storage.buckets(id,name,public) values('reports','reports',false) on conflict(id) do nothing;
create policy report_object_read on storage.objects for select to authenticated using(bucket_id='reports' and exists(select 1 from public.report_files f join public.report_snapshots s on s.id=f.snapshot_id where f.storage_path=name and (public.is_admin() or public.owns_player(s.player_id))));
