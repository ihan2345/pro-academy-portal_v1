-- Separate trial identities and manual attendance. Apply after 017.
begin;
create table public.trial_players (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references trial_families(id),
 first_name text not null, last_name text not null, birth_date date not null, team text not null default '',
 gender text, club text not null default '', position text, strong_foot text, height_cm integer check(height_cm between 50 and 250), development_goals text,
 original_data jsonb not null, converted_player_id uuid references players(id), converted_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table trial_players enable row level security;
revoke all on trial_players from public,anon,authenticated;
grant all on trial_players to service_role;
grant select on trial_players to authenticated;
create policy trial_players_team on trial_players for select to authenticated using(is_team());
create trigger trial_player_audit after insert or update on trial_players for each row execute function audit_change();
alter table trial_families add column auth_user_id uuid references auth.users(id);
alter table trial_requests add column assigned_to uuid references profiles(id);
alter table trial_requests add column feedback_at timestamptz;
alter table trial_feedback add column published_at timestamptz;
alter table event_participants alter column player_id drop not null;
alter table event_participants add column trial_player_id uuid references trial_players(id);
insert into trial_players(id,family_id,first_name,last_name,birth_date,team,gender,club,position,strong_foot,height_cm,development_goals,original_data,converted_player_id,converted_at)
select p.id,r.family_id,p.first_name,p.last_name,r.birth_date,coalesce(p.team,''),p.gender,coalesce(p.club,''),p.position,p.strong_foot,p.height_cm,p.development_goals,to_jsonb(p),
 case when f.request_input ? 'manual_by' or exists(select 1 from entitlement_periods where player_id=p.id) or exists(select 1 from subscription_players where player_id=p.id) or exists(select 1 from event_participants where player_id=p.id and trial_request_id is null) or exists(select 1 from camp_bookings where player_id=p.id) or exists(select 1 from training_backfills where player_id=p.id) then p.id end,
 case when f.request_input ? 'manual_by' or exists(select 1 from entitlement_periods where player_id=p.id) then now() end
from trial_requests r join players p on p.id=r.player_id join trial_families f on f.id=r.family_id;
alter table trial_requests drop constraint trial_requests_player_id_fkey;
alter table trial_feedback drop constraint trial_feedback_player_id_fkey;
alter table trial_requests add foreign key(player_id) references trial_players(id);
alter table trial_feedback add foreign key(player_id) references trial_players(id);
-- Trial attendance keeps its own profile reference; ordinary players remain untouched.
do $$ declare d text; begin
 select pg_get_functiondef('public.participant_validate()'::regprocedure) into d;
 d:=replace(d,'r.player_id=new.player_id','r.player_id=coalesce(new.trial_player_id,new.player_id)');
 d:=replace(d,'if new.period_id is not null or not exists','if new.status=''attended_auto'' then raise exception ''Probetraining nur manuell bestätigen''; end if; if new.period_id is not null or not exists');
 execute d;
 select pg_get_functiondef('public.auto_attendance(timestamptz)'::regprocedure) into d;
 d:=replace(d,'p.status=''planned''','p.status=''planned'' and p.trial_request_id is null');execute d;
end $$;
-- Undo old automatic confirmations, preserving truly manual confirmations.
update event_participants set status='planned' where trial_request_id is not null and status='attended_auto';
update event_participants set trial_player_id=player_id,player_id=null where trial_request_id is not null;
create unique index event_trial_player on event_participants(event_id,trial_player_id) where trial_player_id is not null;
delete from parent_players where player_id in(select id from trial_players where converted_player_id is null);
delete from players where id in(select id from trial_players where converted_player_id is null);
update trial_requests r set assigned_to=e.trainer_id from training_events e where r.event_id=e.id;
update trial_feedback set published_at=updated_at where author_type='academy' and ready;
update trial_requests r set feedback_at=a.published_at from trial_feedback a where a.request_id=r.id and a.event_id=r.event_id and a.author_type='academy' and a.ready;
create or replace function public.create_trial_request(input jsonb, rate_key text) returns uuid language plpgsql security definer set search_path=public as $$
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
  if exists(select 1 from trial_players p where trial_normalize(p.first_name)=trial_normalize(child->>'first_name') and trial_normalize(p.last_name)=trial_normalize(child->>'last_name') and p.birth_date=(child->>'birth_date')::date) then raise exception 'TRIAL_MATCH'; end if;
 end loop;
 insert into parents(full_name,contact_email,phone,notifications_held) values(trim(input->>'parent_name'),lower(trim(input->>'email')),input->>'phone',true) returning id into parent;
 insert into trial_families(id,parent_id,request_input,parent_name,email,phone,preferred_location,availability,operational_consent,privacy_acknowledged,marketing_consent)
 values(fid,parent,input,trim(input->>'parent_name'),lower(trim(input->>'email')),input->>'phone',coalesce(input->>'preferred_location',''),coalesce(input->>'availability',''),true,true,coalesce((input->>'marketing_consent')::boolean,false));
 for child in select * from jsonb_array_elements(input->'children') loop
  insert into trial_players(family_id,first_name,last_name,birth_date,club,original_data) values(fid,trim(child->>'first_name'),trim(child->>'last_name'),(child->>'birth_date')::date,coalesce(child->>'club',''),child) returning id into player;

  insert into trial_requests(family_id,player_id,first_name,last_name,birth_date,club) values(fid,player,trim(child->>'first_name'),trim(child->>'last_name'),(child->>'birth_date')::date,coalesce(child->>'club',''));
 end loop;
 insert into notification_jobs(idempotency_key,kind,recipient,payload) values('trial-welcome:'||fid,'trial_welcome',lower(trim(input->>'email')),jsonb_build_object('family_id',fid));
 return fid;
end $$;
create or replace function public.manage_trial(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
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
  insert into trial_players(id,family_id,first_name,last_name,birth_date,team,club,original_data,converted_player_id) values(pl.id,f.id,pl.first_name,pl.last_name,pl.camp_birth_date,coalesce(pl.team,''),coalesce(pl.club,''),to_jsonb(pl),pl.id) on conflict(id) do nothing;
  insert into trial_requests(family_id,player_id,first_name,last_name,birth_date,club,event_id,participant_id,status,scheduled_at)
  values(f.id,pl.id,pl.first_name,pl.last_name,pl.camp_birth_date,coalesce(pl.club,''),e.id,ep.id,'planned',now()) returning * into r;
  update event_participants set trial_request_id=r.id,trial_player_id=pl.id,player_id=null,period_id=null,revision=revision+1 where id=ep.id;
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
  if f.stopped_at is not null then raise exception 'Anfrage wurde beendet'; end if;
  if e.id is null or e.status<>'scheduled' or e.ends_at<=now() or r.confirmed_at is not null or r.status='closed' then raise exception 'Bitte einen offenen Termin wählen'; end if;
  if r.event_id=e.id and exists(select 1 from event_participants where id=r.participant_id and not removed_from_event) then return r.id; end if;
  if r.participant_id is not null then update event_participants set removed_from_event=true,status='cancelled',revision=revision+1 where id=r.participant_id; end if;
  update trial_requests set event_id=e.id,participant_id=null,feedback_at=null,status='planned',scheduled_at=now(),assigned_to=coalesce(assigned_to,auth.uid()) where id=r.id;
  insert into event_participants(event_id,trial_player_id,period_id,trial_request_id) values(e.id,r.player_id,null,r.id)
  on conflict(event_id,trial_player_id) where trial_player_id is not null do update set trial_request_id=excluded.trial_request_id,period_id=null,removed_from_event=false,status='planned',revision=event_participants.revision+1
  returning id into r.participant_id;
  update trial_requests set participant_id=r.participant_id where id=r.id;
 elsif input->>'action'='owner' then
  if not exists(select 1 from profiles p where p.id=(input->>'assigned_to')::uuid and (p.role='admin' or (p.role='staff' and exists(select 1 from staff_profiles s where s.id=p.id and s.active)))) then raise exception 'Aktiven Mitarbeiter wählen'; end if;
  update trial_requests set assigned_to=(input->>'assigned_to')::uuid where id=r.id;
 elsif input->>'action'='profile' then
  if exists(select 1 from trial_players p where p.id<>r.player_id and trial_normalize(p.first_name)=trial_normalize(input->>'first_name') and trial_normalize(p.last_name)=trial_normalize(input->>'last_name') and p.birth_date=(input->>'birth_date')::date) then raise exception 'Dieses Kinderprofil existiert bereits. Bitte Zuordnung prüfen'; end if;
  if length(trim(input->>'first_name'))<2 or length(trim(input->>'last_name'))<2 or (input->>'birth_date')::date not between date '2000-01-01' and current_date then raise exception 'Pflichtangaben prüfen'; end if;
  update trial_players set first_name=trim(input->>'first_name'),last_name=trim(input->>'last_name'),birth_date=(input->>'birth_date')::date,
   team=coalesce(input->>'team',''),gender=nullif(input->>'gender',''),club=coalesce(input->>'club',''),position=nullif(input->>'position',''),strong_foot=nullif(input->>'strong_foot',''),height_cm=nullif(input->>'height_cm','')::int,development_goals=nullif(input->>'development_goals',''),updated_at=now() where id=r.player_id and converted_player_id is null;
  if not found then raise exception 'Bereits übernommene Profile bitte im Spielerprofil bearbeiten'; end if;
  update trial_requests set first_name=trim(input->>'first_name'),last_name=trim(input->>'last_name'),birth_date=(input->>'birth_date')::date,club=coalesce(input->>'club','') where id=r.id;
 elsif input->>'action'='attendance' then
  perform set_attendance(r.participant_id,(input->>'status')::attendance_status,'Probetraining manuell bestätigt / geprüft',false);
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
  if coalesce((input->>'ready')::boolean,false) then
   update trial_feedback set published_at=coalesce(published_at,now()) where request_id=r.id and event_id=r.event_id and author_type='academy';
   update trial_requests set feedback_at=coalesce(feedback_at,now()),assigned_to=coalesce(assigned_to,auth.uid()) where id=r.id;
  end if;
 else raise exception 'Unbekannte Aktion'; end if;
 return r.id;
end $$;
drop view trial_team_overview;
create view public.trial_team_overview with (security_invoker=true) as
 select r.*,f.parent_name,f.email,f.phone,f.preferred_location,f.availability,f.email_verified_at is not null email_verified,
 e.title event_title,e.starts_at,e.ends_at,e.status event_status,ep.status::text attendance,
 l.name location_name,l.address,s.display_name coach_name,
 p2.team,p2.gender,p2.position,p2.strong_foot,p2.height_cm,p2.development_goals,p2.original_data,p2.converted_player_id,coalesce(owner.display_name,owner_profile.full_name) assigned_name,a.rating academy_rating,a.feedback academy_feedback,coalesce(a.ready,false) academy_ready,
 p.rating parent_rating,p.feedback parent_feedback,trial_has_subscription(r.player_id) subscribed
 from trial_requests r join trial_families f on f.id=r.family_id join trial_players p2 on p2.id=r.player_id left join staff_profiles owner on owner.id=r.assigned_to left join profiles owner_profile on owner_profile.id=r.assigned_to
 left join training_events e on e.id=r.event_id left join event_participants ep on ep.id=r.participant_id
 left join locations l on l.id=e.location_id left join staff_profiles s on s.id=e.trainer_id
 left join trial_feedback a on a.request_id=r.id and a.event_id=r.event_id and a.author_type='academy'
 left join trial_feedback p on p.request_id=r.id and p.event_id=r.event_id and p.author_type='parent';
revoke all on trial_team_overview from public,anon,authenticated;
grant select on trial_team_overview to service_role;

create or replace function public.trial_delivery_allowed(recipient text,kind text,payload jsonb) returns boolean language plpgsql stable security definer set search_path=public as $$
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
 if kind='trial_feedback' then return r.feedback_at is not null; end if;
 if kind in ('trial_day7','trial_day14') then
  return r.feedback_at is not null and (kind<>'trial_day7' or now()<r.feedback_at+interval '14 days') and now()>=r.feedback_at+case when kind='trial_day7' then interval '7 days' else interval '14 days' end and f.marketing_consent and not trial_has_subscription(r.player_id)
   and not exists(select 1 from trial_feedback where request_id=r.id and author_type='parent' and rating<=2);
 end if;
 return false;
end $$;
create or replace function public.plan_trial_notifications() returns integer language plpgsql security definer set search_path=public as $$
declare row record; stage text; body jsonb; key text; first_sent timestamptz; seven_sent timestamptz; n integer:=0;
begin
 if not trial_enabled() then return 0; end if;
 for row in select r.*,f.email,f.email_verified_at,e.starts_at,e.ends_at,e.revision,e.status event_status,ep.status attendance,ep.removed_from_event
 from trial_requests r join trial_families f on f.id=r.family_id join training_events e on e.id=r.event_id join event_participants ep on ep.id=r.participant_id
 where r.status<>'closed' and f.stopped_at is null loop
  body:=jsonb_build_object('family_id',row.family_id,'request_id',row.id,'player_id',row.player_id,'event_id',row.event_id,'starts_at',row.starts_at,'revision',row.revision,'confirmed_at',row.confirmed_at);
  for stage in select unnest(array['trial_planning','trial_reminder','trial_cancelled','trial_feedback','trial_day7','trial_day14']) loop
   if stage='trial_reminder' and (row.starts_at>now()+interval '24 hours' or row.starts_at<=row.scheduled_at+interval '24 hours') then continue; end if;
   if stage in ('trial_day7','trial_day14') and not exists(select 1 from notification_jobs j where j.kind='trial_feedback' and j.payload->>'request_id'=row.id::text and j.status='sent') then continue; end if;
   if not trial_delivery_allowed(row.email,stage,body) then continue; end if;
   key:=stage||':'||row.id||':'||row.event_id||':'||case when stage in ('trial_planning','trial_cancelled') then row.revision::text when stage='trial_reminder' then row.starts_at::text else row.confirmed_at::text end;
   insert into notification_jobs(idempotency_key,kind,recipient,payload) values(key,stage,row.email,body) on conflict(idempotency_key) do update set payload=excluded.payload
    where notification_jobs.status in ('pending','held') and notification_jobs.payload is distinct from excluded.payload;
   if found then n:=n+1; end if;
  end loop;
 end loop;
 return n;
end $$;
-- Keep existing calendar writes but recognize the separate trial profile identity.
do $$ declare d text; begin
 select pg_get_functiondef('public.save_training_before_calendar_backfills(jsonb)'::regprocedure) into d;
 d:=replace(d,'player_id=child and trial_request_id','trial_player_id=child and trial_request_id');
 d:=replace(d,'player_id=any(children)','coalesce(trial_player_id,player_id)=any(children)');
 d:=replace(d,'player_id = any(children)','coalesce(trial_player_id,player_id) = any(children)');
 execute d;
 select pg_get_functiondef('public.parent_delivery_allowed(text,text,jsonb)'::regprocedure) into d;
 d:=replace(d,'ep.player_id::text=payload','coalesce(ep.trial_player_id,ep.player_id)::text=payload');execute d;
 select pg_get_functiondef('public.save_training(jsonb)'::regprocedure) into d;
 d:=replace(d,'ep.player_id=c::uuid','coalesce(ep.trial_player_id,ep.player_id)=c::uuid');execute d;
end $$;

create or replace function public.sync_trial_attendance() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.trial_request_id is not null then
  if new.status not in ('attended_manual') or new.removed_from_event then
   update trial_feedback set ready=false,published_at=null where request_id=new.trial_request_id and event_id=new.event_id and author_type='academy' and exists(select 1 from trial_requests where id=new.trial_request_id and confirmed_at is not null);
  end if;
  update trial_requests set confirmed_at=case when new.status='attended_manual' and not new.removed_from_event then coalesce(confirmed_at,now()) else null end,
   feedback_at=case when new.status='attended_manual' and not new.removed_from_event then feedback_at else null end,
   status=case when status='closed' then 'closed' when new.removed_from_event or new.status in ('cancelled','absent','excused') then 'contacted' when new.status='attended_manual' then 'attended' else 'planned' end
  where id=new.trial_request_id and event_id=new.event_id;
 end if;return new;
end $$;
-- Conservatively stop offers once the family's matching subscription is active, even before assignment.
do $$ declare d text; begin
 select pg_get_functiondef('public.trial_has_subscription(uuid)'::regprocedure) into d;
 execute replace(d,'FUNCTION public.trial_has_subscription(','FUNCTION public.trial_has_subscription_before_profiles(');
end $$;
create or replace function public.trial_has_subscription(player uuid) returns boolean language sql stable security definer set search_path=public as $$
 select trial_has_subscription_before_profiles(player) or exists(
 select 1 from trial_players p join trial_families f on f.id=p.family_id join subscriptions s on s.parent_id=f.parent_id
 or exists(select 1 from stripe_customer_registry c where c.id=s.stripe_customer_id and lower(trim(c.email))=lower(trim(f.email)))
 where p.id=player and s.status in ('active','trialing','incomplete','past_due'))
$$;
revoke all on function trial_has_subscription_before_profiles(uuid) from public,anon,authenticated;

create function public.trial_link_auth(family uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare f trial_families; uid uuid;
begin
 select * into f from trial_families where id=family for update;
 if f.id is null or f.email_verified_at is null then raise exception 'E-Mail zuerst bestätigen'; end if;
 select id into uid from auth.users where lower(email)=lower(f.email);
 if uid is null then return null; end if;
 insert into profiles(id,full_name,role) values(uid,f.parent_name,'parent') on conflict(id) do nothing;
 if exists(select 1 from profiles where id=uid and role<>'parent') then raise exception 'Teamkonto kann nicht als Elternkonto verwendet werden'; end if;
 update parents set auth_user_id=uid where id=f.parent_id and (auth_user_id is null or auth_user_id=uid);
 if not found then raise exception 'Elternkonto ist bereits anders verknüpft'; end if;
 update trial_families set auth_user_id=uid where id=family;
 return uid;
end $$;
revoke all on function trial_link_auth(uuid) from public,anon,authenticated;
grant execute on function trial_link_auth(uuid) to service_role;
-- Conversion runs in the same transaction as the existing checked Abo assignment.
create function public.trial_convert_for_review(input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare p trial_players; f trial_families; sub subscriptions; review subscription_assignment_reviews;
begin
 if not is_admin() then raise exception 'Keine Berechtigung'; end if;
 select * into p from trial_players where id=(input->>'player_id')::uuid for update;
 if p.id is null or p.converted_player_id is not null then return; end if;
 select * into f from trial_families where id=p.family_id for update;
 select * into review from subscription_assignment_reviews where id=(input->>'review_id')::uuid for update;
 select * into sub from subscriptions where id=review.subscription_id for update;
 if review.signature is distinct from input->>'signature' or review.status<>'pending' or sub.status not in ('active','trialing') then raise exception 'Abo-Zuordnung hat sich geändert'; end if;
 if f.stopped_at is not null or not (
  sub.parent_id=f.parent_id or exists(select 1 from parent_stripe_customers where parent_id=f.parent_id and stripe_customer_id=sub.stripe_customer_id)
  or exists(select 1 from stripe_customer_registry where id=sub.stripe_customer_id and lower(trim(email))=lower(trim(f.email)))
 ) then raise exception 'Probefamilie passt nicht eindeutig zum Stripe-Kunden'; end if;
 if sub.parent_id is not null and sub.parent_id<>f.parent_id then raise exception 'Stripe-Kunde ist bereits einer anderen Familie zugeordnet'; end if;
 if exists(select 1 from parent_stripe_customers where stripe_customer_id=sub.stripe_customer_id and parent_id<>f.parent_id) then raise exception 'Stripe-Kunde gehört bereits zu einer anderen Familie'; end if;
 insert into players(id,first_name,last_name,birth_year,camp_birth_date,team,gender,club,position,strong_foot,height_cm,development_goals)
 values(p.id,p.first_name,p.last_name,extract(year from p.birth_date),p.birth_date,p.team,p.gender,p.club,p.position,p.strong_foot,p.height_cm,p.development_goals);
 insert into parent_players(parent_id,player_id) values(f.parent_id,p.id);
 insert into parent_stripe_customers(parent_id,stripe_customer_id) values(f.parent_id,sub.stripe_customer_id) on conflict do nothing;
 update subscriptions set parent_id=f.parent_id where id=sub.id;
 update parents set notifications_held=false where id=f.parent_id and f.email_verified_at is not null and exists(select 1 from auth.users u where u.id=parents.auth_user_id and u.email_confirmed_at is not null);
 update trial_players set converted_player_id=p.id,converted_at=now() where id=p.id;
end $$;
revoke all on function trial_convert_for_review(jsonb) from public,anon,authenticated;
-- Preserve tariff and snapshot checks of releases 011/015.
do $$ declare d text; begin
 if to_regprocedure('public.resolve_subscription_assignment(jsonb)') is not null then
 select pg_get_functiondef('public.resolve_subscription_assignment(jsonb)'::regprocedure) into d;
 execute replace(d,'FUNCTION public.resolve_subscription_assignment(','FUNCTION public.resolve_subscription_assignment_before_trials(');
 end if;
end $$;
create or replace function public.resolve_subscription_assignment(input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare sid text;
begin
 if not is_admin() then raise exception 'Keine Berechtigung'; end if;
 select s.stripe_subscription_id into sid from subscriptions s join subscription_assignment_reviews r on r.subscription_id=s.id where r.id=(input->>'review_id')::uuid;
 perform pg_advisory_xact_lock(hashtext(sid));
 perform trial_convert_for_review(input);
 perform resolve_subscription_assignment_before_trials(input);
end $$;
revoke all on function resolve_subscription_assignment_before_trials(jsonb) from public,anon,authenticated,service_role;
grant execute on function resolve_subscription_assignment(jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
