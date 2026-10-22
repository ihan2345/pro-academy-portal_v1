-- Apply explicitly after 016 and the existing Camp / parent-detail schema.
begin;
insert into public.system_settings(key,value) values('trial_training_release','{"enabled":false}') on conflict do nothing;
create function public.trial_enabled() returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select (value->>'enabled')::boolean from system_settings where key='trial_training_release'),false)
$$;
create function public.trial_normalize(value text) returns text language sql immutable as $$
 select regexp_replace(replace(replace(replace(replace(lower(trim(coalesce(value,''))),'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss'),'[^a-z0-9]','','g')
$$;
create function public.trial_phone(value text) returns text language sql immutable as $$
 select regexp_replace(regexp_replace(regexp_replace(coalesce(value,''),'[^0-9]','','g'),'^00',''),'^0','49')
$$;
create table public.trial_families (
 id uuid primary key, parent_id uuid not null references parents(id), request_input jsonb not null,
 parent_name text not null, email text not null, phone text not null,
 preferred_location text not null default '', availability text not null default '',
 operational_consent boolean not null, privacy_acknowledged boolean not null,
 marketing_consent boolean not null default false, consent_version text not null default 'trial-v1',
 consent_at timestamptz not null default now(), email_verified_at timestamptz,
 access_expires_at timestamptz not null default now()+interval '90 days',
 stopped_at timestamptz, created_at timestamptz not null default now()
);
create unique index trial_family_email on trial_families(lower(trim(email)));
create table public.trial_requests (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references trial_families(id),
 player_id uuid not null unique references players(id), first_name text not null,last_name text not null,birth_date date not null,club text not null default '',
 status text not null default 'new' check(status in ('new','contacted','planned','attended','closed')),
 team_note text not null default '',event_id uuid references training_events(id),participant_id uuid unique references event_participants(id),
 confirmed_at timestamptz, scheduled_at timestamptz, created_at timestamptz not null default now()
);
create index trial_requests_family on trial_requests(family_id);
create table public.trial_feedback (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references trial_requests(id),
 event_id uuid not null references training_events(id),player_id uuid not null references players(id),
 author_type text not null check(author_type in ('academy','parent')),rating integer not null check(rating between 1 and 5),
 feedback text not null default '' check(length(feedback)<=2000),ready boolean not null default false,
 created_by uuid references profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(request_id,event_id,author_type)
);
create table public.trial_request_limits (key text primary key, hits integer not null, expires_at timestamptz not null);
alter table public.event_participants alter column period_id drop not null;
alter table public.event_participants add column trial_request_id uuid references trial_requests(id);
create unique index participant_trial_request on event_participants(trial_request_id) where trial_request_id is not null and not removed_from_event;
DO $$ declare t text; begin
 foreach t in array array['trial_families','trial_requests','trial_feedback','trial_request_limits'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['trial_requests','trial_feedback'] loop
  execute format('create trigger trial_audit after insert or update on public.%I for each row execute function public.audit_change()',t);
 end loop;
end $$;

create function public.create_trial_request(input jsonb, rate_key text) returns uuid language plpgsql security definer set search_path=public as $$
declare fid uuid:=(input->>'request_id')::uuid; prior trial_families; parent uuid; player uuid; child jsonb; hit int;
begin
 if not trial_enabled() then raise exception 'Probetraining ist noch nicht freigeschaltet'; end if;
 -- Serialize identity checks across different emails and concurrent family requests.
 perform pg_advisory_xact_lock(hashtextextended('trial-application',0));
 select * into prior from trial_families where id=fid;
 if found then
  if prior.request_input<>input then raise exception 'TRIAL_MATCH'; end if;
  return fid;
 end if;
 delete from trial_request_limits where expires_at<now();
 insert into trial_request_limits values(rate_key,1,now()+interval '1 hour')
 on conflict(key) do update set hits=trial_request_limits.hits+1 returning hits into hit;
 if hit>5 then raise exception 'Zu viele Anfragen. Bitte später erneut versuchen.'; end if;
 if coalesce((input->>'operational_consent')::boolean,false) is not true or coalesce((input->>'privacy_acknowledged')::boolean,false) is not true
 or jsonb_array_length(input->'children') not between 1 and 3 then raise exception 'Pflichtangaben fehlen'; end if;
 if exists(select 1 from parents p where lower(trim(p.contact_email))=lower(trim(input->>'email')) or trial_normalize(p.full_name)=trial_normalize(input->>'parent_name') or (p.phone is not null and trial_phone(p.phone)=trial_phone(input->>'phone')))
 or exists(select 1 from trial_families f where trial_phone(f.phone)=trial_phone(input->>'phone')) then raise exception 'TRIAL_MATCH'; end if;
 if (select count(distinct trial_normalize(c->>'first_name')||':'||trial_normalize(c->>'last_name')||':'||(c->>'birth_date')) from jsonb_array_elements(input->'children') c)<>jsonb_array_length(input->'children') then raise exception 'TRIAL_MATCH'; end if;
 for child in select * from jsonb_array_elements(input->'children') loop
  if (child->>'birth_date')::date>current_date or (child->>'birth_date')::date<'2000-01-01'::date then raise exception 'Geburtsdatum prüfen'; end if;
  if exists(select 1 from players p where trial_normalize(p.first_name)=trial_normalize(child->>'first_name') and trial_normalize(p.last_name)=trial_normalize(child->>'last_name')
   and (p.camp_birth_date=(child->>'birth_date')::date or (p.camp_birth_date is null and (p.birth_year is null or p.birth_year=extract(year from (child->>'birth_date')::date))))) then raise exception 'TRIAL_MATCH'; end if;
 end loop;
 insert into parents(full_name,contact_email,phone,notifications_held) values(trim(input->>'parent_name'),lower(trim(input->>'email')),input->>'phone',true) returning id into parent;
 insert into trial_families(id,parent_id,request_input,parent_name,email,phone,preferred_location,availability,operational_consent,privacy_acknowledged,marketing_consent)
 values(fid,parent,input,trim(input->>'parent_name'),lower(trim(input->>'email')),input->>'phone',coalesce(input->>'preferred_location',''),coalesce(input->>'availability',''),true,true,coalesce((input->>'marketing_consent')::boolean,false));
 for child in select * from jsonb_array_elements(input->'children') loop
  insert into players(first_name,last_name,birth_year,camp_birth_date,club) values(trim(child->>'first_name'),trim(child->>'last_name'),extract(year from (child->>'birth_date')::date),(child->>'birth_date')::date,coalesce(child->>'club','')) returning id into player;
  insert into parent_players(parent_id,player_id) values(parent,player);
  insert into trial_requests(family_id,player_id,first_name,last_name,birth_date,club) values(fid,player,trim(child->>'first_name'),trim(child->>'last_name'),(child->>'birth_date')::date,coalesce(child->>'club',''));
 end loop;
 insert into notification_jobs(idempotency_key,kind,recipient,payload) values('trial-welcome:'||fid,'trial_welcome',lower(trim(input->>'email')),jsonb_build_object('family_id',fid));
 return fid;
end $$;

-- Free trial participants have a real player/event but no paid entitlement or Stripe record.
do $$ declare original text; changed text; begin
 select pg_get_functiondef('public.participant_validate()'::regprocedure) into original;
 changed:=replace(original,'begin',$guard$begin
 if new.trial_request_id is not null then
  if new.period_id is not null or not exists(select 1 from trial_requests r where r.id=new.trial_request_id and r.player_id=new.player_id and r.event_id=new.event_id) then raise exception 'Ungültige Probetraining-Zuordnung'; end if;
  if not new.removed_from_event and exists(select 1 from training_events e where e.id=new.event_id and ((e.status='cancelled' and new.status not in ('cancelled','excused')) or (e.ends_at>now() and new.status in ('attended_auto','attended_manual')))) then raise exception 'Teilnahmestatus für diesen Termin nicht möglich'; end if;
  return new;
 end if;
 if new.period_id is null then raise exception 'Leistungszeitraum erforderlich'; end if;
$guard$);
 if changed=original then raise exception 'Unexpected participant validator'; end if; execute changed;
 select pg_get_functiondef('public.participant_notify()'::regprocedure) into original;
 changed:=replace(original,'begin','begin if new.trial_request_id is not null then return new; end if;');
 if changed=original then raise exception 'Unexpected notification trigger'; end if; execute changed;
 select pg_get_functiondef('public.queue_training_notice(uuid,uuid,boolean,boolean,uuid)'::regprocedure) into original;
 changed:=replace(original,'begin','begin if exists(select 1 from event_participants where event_id=event and player_id=player and trial_request_id is not null) then return 0; end if;');
 if changed=original then raise exception 'Unexpected notice planner'; end if; execute changed;
 select pg_get_functiondef('public.plan_training_reminders()'::regprocedure) into original;
 changed:=replace(original,' and not ep.removed_from_event',' and not ep.removed_from_event and ep.trial_request_id is null');
 if changed=original then raise exception 'Unexpected reminder planner'; end if; execute changed;
 -- Existing trials remain editable in the regular calendar without inventing an allowance.
 select pg_get_functiondef('public.save_training_before_calendar_backfills(jsonb)'::regprocedure) into original;
 changed:=replace(original,'foreach child in array children loop',$guard$foreach child in array children loop
 if exists(select 1 from event_participants where event_id=eid and player_id=child and trial_request_id is not null and not removed_from_event) then continue; end if;
$guard$);
 if changed=original then raise exception 'Unexpected training planner'; end if; execute changed;
end $$;

create function public.sync_trial_attendance() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.trial_request_id is not null then
  update trial_requests set confirmed_at=case when new.status in ('attended_auto','attended_manual') and not new.removed_from_event then coalesce(confirmed_at,now()) else null end,
   status=case when status='closed' then 'closed' when new.removed_from_event or new.status in ('cancelled','absent','excused') then 'contacted' when new.status in ('attended_auto','attended_manual') then 'attended' else 'planned' end
  where id=new.trial_request_id and event_id=new.event_id;
 end if;
 return new;
end $$;
create trigger sync_trial_attendance after insert or update on event_participants for each row execute function sync_trial_attendance();

create function public.trial_has_subscription(player uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from subscription_players sp join subscriptions s on s.id=sp.subscription_id where sp.player_id=player and s.status in ('active','trialing','incomplete','past_due'))
 or exists(select 1 from entitlement_periods p join subscriptions s on s.id=p.subscription_id where p.player_id=player and p.status in ('active','trialing') and p.ends_at>now() and s.status in ('active','trialing','incomplete','past_due'))
 or exists(select 1 from parent_players pp join subscriptions s on s.parent_id=pp.parent_id where pp.player_id=player and s.status in ('active','trialing','incomplete') and not exists(select 1 from subscription_players sp where sp.subscription_id=s.id))
$$;

create function public.manage_trial(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare r trial_requests; f trial_families; e training_events; ep event_participants; pa parents; pl players; fid uuid; feedback_id uuid; report_contact text;
begin
 if not is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 if not trial_enabled() then raise exception 'Probetraining ist noch nicht freigeschaltet'; end if;
 perform set_config('app.audit_reason','Probetraining bearbeiten',true);
 if input->>'action'='mark' then
  perform pg_advisory_xact_lock(hashtextextended('trial-application',0));
  select te.* into e from training_events te join event_participants p on p.event_id=te.id where p.id=(input->>'participant_id')::uuid for update of te;
  select * into ep from event_participants where id=(input->>'participant_id')::uuid for update;
  if ep.id is null or ep.status<>'planned' or ep.removed_from_event or e.status='cancelled' then raise exception 'Nur vor der Teilnahmebestätigung möglich'; end if;
  if ep.trial_request_id is not null then return ep.trial_request_id; end if;
  if exists(select 1 from trial_requests where player_id=ep.player_id) then raise exception 'Für diesen Spieler existiert bereits ein Probetraining'; end if;
  select p.* into strict pa from parents p join parent_players pp on pp.parent_id=p.id where pp.player_id=ep.player_id and p.archived_at is null;
  select * into pl from players where id=ep.player_id;
  if pl.camp_birth_date is null then
   if nullif(input->>'birth_date','') is null or (input->>'birth_date')::date < date '2000-01-01' or (input->>'birth_date')::date>current_date then raise exception 'Bitte das vollständige Geburtsdatum ergänzen'; end if;
   if pl.birth_year is not null and pl.birth_year<>extract(year from (input->>'birth_date')::date) then raise exception 'Geburtsdatum passt nicht zum hinterlegten Geburtsjahr'; end if;
   update players set camp_birth_date=(input->>'birth_date')::date,birth_year=extract(year from (input->>'birth_date')::date) where id=pl.id returning * into pl;
  end if;
  if coalesce((input->>'operational_consent')::boolean,false) is not true then raise exception 'Zustimmung zur Terminorganisation erforderlich'; end if;
  select * into f from trial_families where parent_id=pa.id for update;
  if f.id is null then
   insert into trial_families(id,parent_id,request_input,parent_name,email,phone,operational_consent,privacy_acknowledged,marketing_consent,email_verified_at)
   values(gen_random_uuid(),pa.id,jsonb_build_object('manual_by',auth.uid()),pa.full_name,pa.contact_email,coalesce(pa.phone,''),true,true,coalesce((input->>'marketing_consent')::boolean,false),
    case when exists(select 1 from auth.users u where u.id=pa.auth_user_id and u.email_confirmed_at is not null and lower(u.email)=lower(pa.contact_email)) then now() end) returning * into f;
   insert into notification_jobs(idempotency_key,kind,recipient,payload) values('trial-welcome:'||f.id,'trial_welcome',f.email,jsonb_build_object('family_id',f.id));
  end if;
  if (select count(*) from trial_requests where family_id=f.id)>=3 then raise exception 'Maximal drei Spieler pro Elternteil'; end if;
  insert into trial_requests(family_id,player_id,first_name,last_name,birth_date,club,event_id,participant_id,status,scheduled_at)
  values(f.id,pl.id,pl.first_name,pl.last_name,pl.camp_birth_date,coalesce(pl.club,''),e.id,ep.id,'planned',now()) returning * into r;
  update event_participants set trial_request_id=r.id,period_id=null,revision=revision+1 where id=ep.id;
  if ep.period_id is not null and exists(select 1 from entitlement_periods where id=ep.period_id and ends_at<=now()) then
   select snapshot->>'whatsapp' into report_contact from report_snapshots where period_id=ep.period_id order by version desc limit 1;
   perform set_config('app.backfill_report','true',true);
   perform capture_report(ep.period_id,true,coalesce(report_contact,''));
   perform set_config('app.backfill_report','false',true);
  end if;
  return r.id;
 end if;
 -- Event before request locks matches attendance/background processing lock order.
 if input->>'action'='assign' then select * into e from training_events where id=(input->>'event_id')::uuid for update; end if;
 select * into r from trial_requests where id=(input->>'request_id')::uuid for update;
 if r.id is null then raise exception 'Anfrage nicht gefunden'; end if;
 select * into f from trial_families where id=r.family_id;
 if input->>'action'='assign' then
  if f.email_verified_at is null or f.stopped_at is not null then raise exception 'Eltern müssen zuerst ihre E-Mail bestätigen'; end if;
  if e.id is null or e.status<>'scheduled' or e.ends_at<=now() or r.confirmed_at is not null or r.status='closed' then raise exception 'Bitte einen offenen Termin wählen'; end if;
  if r.event_id=e.id and exists(select 1 from event_participants where id=r.participant_id and not removed_from_event) then return r.id; end if;
  if r.participant_id is not null then update event_participants set removed_from_event=true,status='cancelled',revision=revision+1 where id=r.participant_id; end if;
  update trial_requests set event_id=e.id,participant_id=null,status='planned',scheduled_at=now() where id=r.id;
  insert into event_participants(event_id,player_id,period_id,trial_request_id) values(e.id,r.player_id,null,r.id)
  on conflict(event_id,player_id) do update set trial_request_id=excluded.trial_request_id,period_id=null,removed_from_event=false,status='planned',revision=event_participants.revision+1
  returning id into r.participant_id;
  update trial_requests set participant_id=r.participant_id where id=r.id;
 elsif input->>'action'='note' then
  if input->>'status' not in ('new','contacted','closed') then raise exception 'Ungültiger Status'; end if;
  update trial_requests set team_note=left(coalesce(input->>'note',''),2000),status=case when input->>'status'='closed' then 'closed' when confirmed_at is not null then 'attended' when participant_id is not null then status else input->>'status' end where id=r.id;
 elsif input->>'action'='review' then
  if r.event_id is null or r.event_id<>(input->>'event_id')::uuid then raise exception 'Termin wurde geändert. Bitte neu laden'; end if;
  if length(trim(coalesce(input->>'feedback','')))<3 or length(input->>'feedback')>2000 then raise exception 'Bitte Elternfeedback eintragen'; end if;
  if coalesce((input->>'ready')::boolean,false) and r.confirmed_at is null then raise exception 'Erst Teilnahme bestätigen'; end if;
  insert into trial_feedback(request_id,event_id,player_id,author_type,rating,feedback,ready,created_by)
  values(r.id,r.event_id,r.player_id,'academy',(input->>'rating')::int,trim(input->>'feedback'),coalesce((input->>'ready')::boolean,false),auth.uid())
  on conflict(request_id,event_id,author_type) do update set rating=excluded.rating,feedback=excluded.feedback,ready=excluded.ready,created_by=auth.uid(),updated_at=now();
 else raise exception 'Unbekannte Aktion'; end if;
 return r.id;
end $$;

create function public.trial_parent_action(family uuid,input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare r trial_requests; f trial_families;
begin
 select * into f from trial_families where id=family for update;
 if f.id is null or f.access_expires_at<=now() then raise exception 'Zugang abgelaufen'; end if;
 if input->>'action'='verify' then
  update trial_families set email_verified_at=coalesce(email_verified_at,now()) where id=family; return;
 end if;
 if f.email_verified_at is null then raise exception 'E-Mail zuerst bestätigen'; end if;
 if input->>'action'='unsubscribe' then
  update trial_families set marketing_consent=false where id=family; return;
 end if;
 select * into r from trial_requests where id=(input->>'request_id')::uuid and family_id=family for update;
 if r.id is null or r.confirmed_at is null or r.event_id<>(input->>'event_id')::uuid then raise exception 'Feedback ist für diesen Termin nicht möglich'; end if;
 insert into trial_feedback(request_id,event_id,player_id,author_type,rating,feedback,ready)
 values(r.id,r.event_id,r.player_id,'parent',(input->>'rating')::int,left(coalesce(input->>'feedback',''),2000),true)
 on conflict(request_id,event_id,author_type) do nothing;
end $$;

create view public.trial_team_overview with (security_invoker=true) as
 select r.*,f.parent_name,f.email,f.phone,f.preferred_location,f.availability,f.email_verified_at is not null email_verified,
 e.title event_title,e.starts_at,e.ends_at,e.status event_status,ep.status::text attendance,
 l.name location_name,l.address,s.display_name coach_name,
 a.rating academy_rating,a.feedback academy_feedback,coalesce(a.ready,false) academy_ready,
 p.rating parent_rating,p.feedback parent_feedback,trial_has_subscription(r.player_id) subscribed
 from trial_requests r join trial_families f on f.id=r.family_id
 left join training_events e on e.id=r.event_id left join event_participants ep on ep.id=r.participant_id
 left join locations l on l.id=e.location_id left join staff_profiles s on s.id=e.trainer_id
 left join trial_feedback a on a.request_id=r.id and a.event_id=r.event_id and a.author_type='academy'
 left join trial_feedback p on p.request_id=r.id and p.event_id=r.event_id and p.author_type='parent';
revoke all on trial_team_overview from public,anon,authenticated;
grant select on trial_team_overview to service_role;

-- Final eligibility is checked again at delivery, including subscription changes.
create function public.trial_delivery_allowed(recipient text,kind text,payload jsonb) returns boolean language plpgsql stable security definer set search_path=public as $$
declare f trial_families; r trial_requests; ep event_participants; e training_events;
begin
 if not trial_enabled() then return false; end if;
 select * into f from trial_families where id=(payload->>'family_id')::uuid;
 if f.id is null or lower(trim(f.email))<>lower(trim(recipient)) or not f.operational_consent or f.stopped_at is not null or f.access_expires_at<=now() then return false; end if;
 if not exists(select 1 from parents where id=f.parent_id and archived_at is null and lower(trim(contact_email))=lower(trim(recipient))) then return false; end if;
 if not email_preference_allows(recipient,kind,payload) then return false; end if;
 if kind='trial_welcome' then return true; end if;
 if f.email_verified_at is null then return false; end if;
 select * into r from trial_requests where id=(payload->>'request_id')::uuid and family_id=f.id;
 if r.id is null or r.status='closed' or r.event_id::text is distinct from payload->>'event_id' then return false; end if;
 select * into ep from event_participants where id=r.participant_id;
 select * into e from training_events where id=r.event_id;
 if ep.id is null then return false; end if;
 if kind='trial_cancelled' then return e.status='cancelled' or ep.removed_from_event or ep.status in ('cancelled','excused','absent'); end if;
 if e.status='cancelled' or ep.removed_from_event then return false; end if;
 if kind in ('trial_planning','trial_reminder') then
  return ep.status='planned' and e.starts_at>now() and (payload->>'starts_at')::timestamptz=e.starts_at and (payload->>'revision')::int=e.revision;
 end if;
 if r.confirmed_at is null or ep.status not in ('attended_auto','attended_manual') or (payload->>'confirmed_at')::timestamptz is distinct from r.confirmed_at then return false; end if;
 if not exists(select 1 from trial_feedback where request_id=r.id and event_id=r.event_id and author_type='academy' and ready) then return false; end if;
 if kind='trial_feedback' then return now()>=r.confirmed_at+interval '24 hours'; end if;
 if kind in ('trial_day7','trial_day14') then
  return f.marketing_consent and not trial_has_subscription(r.player_id)
   and not exists(select 1 from trial_feedback where request_id=r.id and author_type='parent' and rating<=2);
 end if;
 return false;
end $$;

do $$ declare definition text; begin
 select pg_get_functiondef('public.parent_delivery_allowed(text,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'parent_delivery_allowed.','parent_delivery_allowed_before_trials.');
 execute replace(definition,'FUNCTION public.parent_delivery_allowed(','FUNCTION public.parent_delivery_allowed_before_trials(');
end $$;
create or replace function public.parent_delivery_allowed(recipient text,kind text,payload jsonb) returns boolean language sql stable security definer set search_path=public as $$
 select case when kind like 'trial\_%' escape '\' then trial_delivery_allowed(recipient,kind,payload) when kind in ('planning','change','training_reminder','attendance','correction','training_removed') and exists(select 1 from event_participants ep where ep.event_id::text=payload->>'event_id' and ep.player_id::text=payload->>'player_id' and ep.trial_request_id is not null) then false
 else parent_delivery_allowed_before_trials(recipient,kind,payload) end
$$;

create function public.plan_trial_notifications() returns integer language plpgsql security definer set search_path=public as $$
declare row record; stage text; body jsonb; key text; first_sent timestamptz; seven_sent timestamptz; n integer:=0;
begin
 if not trial_enabled() then return 0; end if;
 for row in select r.*,f.email,f.email_verified_at,e.starts_at,e.ends_at,e.revision,e.status event_status,ep.status attendance,ep.removed_from_event
 from trial_requests r join trial_families f on f.id=r.family_id join training_events e on e.id=r.event_id join event_participants ep on ep.id=r.participant_id
 where r.status<>'closed' and f.stopped_at is null loop
  body:=jsonb_build_object('family_id',row.family_id,'request_id',row.id,'player_id',row.player_id,'event_id',row.event_id,'starts_at',row.starts_at,'revision',row.revision,'confirmed_at',row.confirmed_at);
  for stage in select unnest(array['trial_planning','trial_reminder','trial_cancelled','trial_feedback','trial_day7','trial_day14']) loop
   if stage='trial_reminder' and (row.starts_at>now()+interval '24 hours' or row.starts_at<=row.scheduled_at+interval '24 hours') then continue; end if;
   if stage in ('trial_day7','trial_day14') then
    select max(updated_at) into first_sent from notification_jobs where kind='trial_feedback' and payload->>'request_id'=row.id::text and status='sent';
    if first_sent is null or now()<greatest(row.confirmed_at+interval '7 days',first_sent+interval '6 days') then continue; end if;
    if stage='trial_day14' then
     select max(updated_at) into seven_sent from notification_jobs where kind='trial_day7' and payload->>'request_id'=row.id::text and status='sent';
     if seven_sent is null or now()<greatest(row.confirmed_at+interval '14 days',seven_sent+interval '7 days') then continue; end if;
    end if;
   end if;
   if not trial_delivery_allowed(row.email,stage,body) then continue; end if;
   key:=stage||':'||row.id||':'||row.event_id||':'||case when stage in ('trial_planning','trial_cancelled') then row.revision::text when stage='trial_reminder' then row.starts_at::text else row.confirmed_at::text end;
   insert into notification_jobs(idempotency_key,kind,recipient,payload) values(key,stage,row.email,body) on conflict(idempotency_key) do update set payload=excluded.payload
    where notification_jobs.status in ('pending','held') and notification_jobs.payload is distinct from excluded.payload;
   if found then n:=n+1; end if;
  end loop;
 end loop;
 return n;
end $$;

-- Permission boundary: browser/session RPCs only for team; public actions via validated server routes.
do $$ declare name text; signature text; begin
 for signature in select p.oid::regprocedure::text from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public'
 and (p.proname like 'trial_%' or p.proname in ('create_trial_request','manage_trial','sync_trial_attendance','plan_trial_notifications','parent_delivery_allowed_before_trials')) loop
  execute 'revoke all on function '||signature||' from public,anon,authenticated';
  execute 'grant execute on function '||signature||' to service_role';
 end loop;
end $$;
grant execute on function public.manage_trial(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
