-- Trial release rules. Apply explicitly after 018; does not enable the feature.
begin;
alter table trial_families alter column consent_version set default 'trial-v2';
alter table trial_families add column parent_created_for_trial boolean not null default false;
update trial_families f set parent_created_for_trial=true from parents p where p.id=f.parent_id and p.created_at=f.created_at and p.notifications_held;
alter table trial_feedback add column parent_id uuid references parents(id);
alter table trial_feedback add column comment_submitted_at timestamptz;
update trial_feedback b set parent_id=f.parent_id,comment_submitted_at=case when b.author_type='parent' and length(trim(b.feedback))>0 then b.updated_at end
from trial_requests r join trial_families f on f.id=r.family_id where b.request_id=r.id and b.author_type='parent';
create unique index trial_parent_feedback_once on trial_feedback(parent_id,player_id,event_id) where author_type='parent';
create table trial_access_links(id uuid primary key default gen_random_uuid(),family_id uuid not null references trial_families(id) on delete cascade,parent_id uuid not null references parents(id),expires_at timestamptz not null default now()+interval '24 hours',consumed_at timestamptz,created_at timestamptz not null default now());
alter table trial_access_links enable row level security;
revoke all on trial_access_links from public,anon,authenticated;
grant all on trial_access_links to service_role;
-- Preserve international letters; punctuation and spacing are ignored.
create or replace function trial_normalize(value text) returns text language sql immutable as $$
 select regexp_replace(replace(replace(replace(replace(lower(trim(coalesce(value,''))),'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss'),'[^[:alnum:]]','','g')
$$;
create function trial_account_state() returns text language sql stable security definer set search_path=public as $$
 select case when exists(select 1 from trial_families f join parents pa on pa.id=f.parent_id where pa.auth_user_id=auth.uid())
 then case when exists(select 1 from parent_players pp join parents pa on pa.id=pp.parent_id where pa.auth_user_id=auth.uid())
 then case when exists(select 1 from trial_players p join trial_families f on f.id=p.family_id join parents pa on pa.id=f.parent_id where pa.auth_user_id=auth.uid() and p.converted_at is null) then 'mixed' else 'subscriber' end else 'trial' end
 else 'none' end
$$;
revoke all on function trial_account_state() from public,anon;
grant execute on function trial_account_state() to authenticated,service_role;
create function issue_trial_access(family uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare f trial_families; nonce uuid;
begin
 select * into f from trial_families where id=family;
 if f.id is null or f.stopped_at is not null or f.created_at+interval '180 days'<=now() then raise exception 'Zugang nicht verfügbar'; end if;
 insert into trial_access_links(family_id,parent_id) values(f.id,f.parent_id) returning id into nonce;
 return nonce;
end $$;
create function consume_trial_access(nonce uuid,family uuid,parent uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 update trial_access_links set consumed_at=now() where id=nonce and family_id=family and parent_id=parent and consumed_at is null and expires_at>now();
 if not found then raise exception 'Link abgelaufen oder bereits verwendet'; end if;
 update trial_families set email_verified_at=coalesce(email_verified_at,now()) where id=family and parent_id=parent and stopped_at is null and created_at+interval '180 days'>now();
 if not found then raise exception 'Zugang nicht verfügbar'; end if;
end $$;
create function queue_trial_access(email_address text) returns void language plpgsql security definer set search_path=public as $$
declare f trial_families;
begin
 select * into f from trial_families where lower(email)=lower(trim(email_address)) and stopped_at is null and created_at+interval '180 days'>now() for update;
 if f.id is null then return; end if;
 if exists(select 1 from notification_jobs where kind='trial_welcome' and payload->>'family_id'=f.id::text and created_at>now()-interval '10 minutes') then return; end if;
 insert into notification_jobs(idempotency_key,kind,recipient,payload) values('trial-access:'||gen_random_uuid(),'trial_welcome',f.email,jsonb_build_object('family_id',f.id));
end $$;
create or replace function public.create_trial_request(input jsonb, rate_key text) returns uuid language plpgsql security definer set search_path=public as $$
declare fid uuid:=(input->>'request_id')::uuid; prior trial_families; parent uuid; player uuid; child jsonb; hit int; new_parent boolean:=false;
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
 -- Exact email reuses an existing parent, but never creates a second application.
 select id into parent from parents where lower(trim(contact_email))=lower(trim(input->>'email')) and archived_at is null;
 if parent is not null and exists(select 1 from trial_families where parent_id=parent) then raise exception 'TRIAL_MATCH'; end if;
 if (select count(distinct trial_normalize(c->>'first_name')||':'||trial_normalize(c->>'last_name')||':'||(c->>'birth_date')) from jsonb_array_elements(input->'children') c)<>jsonb_array_length(input->'children') then raise exception 'TRIAL_MATCH'; end if;
 for child in select * from jsonb_array_elements(input->'children') loop
  if (child->>'birth_date')::date>current_date or (child->>'birth_date')::date<'2000-01-01'::date then raise exception 'Geburtsdatum prüfen'; end if;
  if exists(
   select 1 from (
    select pa.full_name parent_name,p.first_name,p.last_name,p.birth_year from players p
    left join parent_players pp on pp.player_id=p.id left join parents pa on pa.id=pp.parent_id
    union all
    select f.parent_name,p.first_name,p.last_name,extract(year from p.birth_date)::int from trial_players p join trial_families f on f.id=p.family_id
   ) candidate
   where coalesce((trial_normalize(candidate.parent_name)=trial_normalize(input->>'parent_name'))::int,0)
    +(trial_normalize(candidate.first_name||' '||candidate.last_name)=trial_normalize((child->>'first_name')||' '||(child->>'last_name')))::int
    +coalesce((candidate.birth_year=extract(year from (child->>'birth_date')::date))::int,0)>=2
  ) then raise exception 'TRIAL_MATCH'; end if;
 end loop;
 if parent is null then
 new_parent:=true;
 insert into parents(full_name,contact_email,phone,notifications_held) values(trim(input->>'parent_name'),lower(trim(input->>'email')),input->>'phone',true) returning id into parent;
 end if;
 insert into trial_families(id,parent_id,request_input,parent_name,email,phone,preferred_location,availability,operational_consent,privacy_acknowledged,marketing_consent,parent_created_for_trial)
 values(fid,parent,input,trim(input->>'parent_name'),lower(trim(input->>'email')),input->>'phone',coalesce(input->>'preferred_location',''),coalesce(input->>'availability',''),true,true,coalesce((input->>'marketing_consent')::boolean,false),new_parent);
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
 if input->>'action'='add_child' then
  perform pg_advisory_xact_lock(hashtextextended('trial-application',0));
  select * into f from trial_families where id=(input->>'family_id')::uuid for update;
  if f.id is null or f.stopped_at is not null or f.created_at+interval '180 days'<=now() then raise exception 'Familie nicht verfügbar'; end if;
  if (select count(*) from trial_players where family_id=f.id)>=3 then raise exception 'Maximal drei Spieler pro Elternteil'; end if;
  if length(trim(input->>'first_name'))<2 or length(trim(input->>'last_name'))<2 or (input->>'birth_date')::date not between date '2000-01-01' and current_date then raise exception 'Pflichtangaben prüfen'; end if;
  if length(trim(coalesce(input->>'reason','')))<5 then raise exception 'Manuelle Prüfung begründen'; end if;
  if exists(select 1 from trial_players where family_id=f.id and trial_normalize(first_name)=trial_normalize(input->>'first_name') and trial_normalize(last_name)=trial_normalize(input->>'last_name') and birth_date=(input->>'birth_date')::date) then raise exception 'Kinderprofil existiert bereits'; end if;
  perform set_config('app.audit_reason','Geschwister nach Prüfung: '||left(input->>'reason',500),true);
  insert into trial_players(family_id,first_name,last_name,birth_date,club,original_data)
  values(f.id,trim(input->>'first_name'),trim(input->>'last_name'),(input->>'birth_date')::date,coalesce(input->>'club',''),input-'reason') returning id into fid;
  insert into trial_requests(family_id,player_id,first_name,last_name,birth_date,club,assigned_to)
  values(f.id,fid,trim(input->>'first_name'),trim(input->>'last_name'),(input->>'birth_date')::date,coalesce(input->>'club',''),auth.uid()) returning id into fid;
  return fid;
 end if;
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
 if exists(select 1 from trial_players where id=r.player_id and converted_at is not null) and input->>'action' not in ('review','note') then raise exception 'Bereits übernommen: bitte Spielerprofil verwenden'; end if;
 if input->>'action'='assign' then
  if f.stopped_at is not null then raise exception 'Anfrage wurde beendet'; end if;
  if e.id is null or e.status<>'scheduled' or e.ends_at<=now() or r.confirmed_at is not null or r.status='closed' then raise exception 'Bitte einen offenen Termin wählen'; end if;
  if r.event_id=e.id and exists(select 1 from event_participants where id=r.participant_id and not removed_from_event) then return r.id; end if;
  if r.participant_id is not null then update event_participants set removed_from_event=true,status='cancelled',revision=revision+1 where id=r.participant_id; end if;
  update trial_requests set event_id=e.id,participant_id=null,feedback_at=null,status='planned',scheduled_at=now(),assigned_to=coalesce(assigned_to,e.trainer_id) where id=r.id;
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

create or replace function trial_parent_action(family uuid,input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare f trial_families; r trial_requests; current_feedback trial_feedback; message text;
begin
 select * into f from trial_families where id=family for update;
 if f.id is null or f.stopped_at is not null or f.created_at+interval '180 days'<=now() then raise exception 'Zugang abgelaufen'; end if;
 -- Only the service API may call this function. Verification requires a consumed login token there.
 if input->>'action'='verify' then update trial_families set email_verified_at=coalesce(email_verified_at,now()) where id=family;return;end if;
 if f.email_verified_at is null then raise exception 'E-Mail zuerst bestätigen'; end if;
 if input->>'action'='unsubscribe' then update trial_families set marketing_consent=false where id=family;return;end if;
 if input->>'action' not in ('feedback','comment') then raise exception 'Unbekannte Aktion'; end if;
 select * into r from trial_requests where id=(input->>'request_id')::uuid and family_id=family for update;
 if r.id is null or r.confirmed_at is null or r.event_id is distinct from (input->>'event_id')::uuid
 or not exists(select 1 from event_participants where id=r.participant_id and status='attended_manual' and not removed_from_event)
 or not exists(select 1 from trial_feedback where request_id=r.id and event_id=r.event_id and author_type='academy' and ready)
 then raise exception 'Feedback ist für diesen Termin nicht möglich'; end if;
 message:=trim(coalesce(input->>'feedback',''));
 if length(message)>2000 then raise exception 'Nachricht zu lang'; end if;
 if input->>'action'='feedback' then
  insert into trial_feedback(request_id,event_id,player_id,parent_id,author_type,rating,feedback,ready,comment_submitted_at)
  values(r.id,r.event_id,r.player_id,f.parent_id,'parent',(input->>'rating')::int,message,true,case when message<>'' then now() end)
  on conflict(request_id,event_id,author_type) do nothing;
 else
  if length(message)<1 then raise exception 'Bitte Nachricht eingeben'; end if;
  update trial_feedback set feedback=message,comment_submitted_at=now(),updated_at=now()
  where request_id=r.id and event_id=r.event_id and author_type='parent' and parent_id=f.parent_id and comment_submitted_at is null;
  -- Idempotent retries return the saved value; cannot replace it.
 end if;
end $$;
-- Subscription identity is family-wide only for marketing. Operational notices remain per child.
create function trial_family_has_subscription(family uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from trial_families f join subscriptions s on s.parent_id=f.parent_id or exists(select 1 from parent_stripe_customers c where c.parent_id=f.parent_id and c.stripe_customer_id=s.stripe_customer_id) or exists(select 1 from stripe_customer_registry c where c.id=s.stripe_customer_id and lower(trim(c.email))=lower(trim(f.email))) where f.id=family and s.status in ('active','trialing','incomplete','past_due'))
$$;
create or replace function trial_has_subscription(player uuid) returns boolean language sql stable security definer set search_path=public as $$
 select trial_has_subscription_before_profiles(player) or exists(select 1 from trial_players p where p.id=player and p.converted_at is not null)
$$;
drop view trial_team_overview;
create view public.trial_team_overview with (security_invoker=true) as
 select r.*,f.parent_name,f.email,f.phone,f.preferred_location,f.availability,f.email_verified_at is not null email_verified,
 e.title event_title,e.starts_at,e.ends_at,e.status event_status,ep.status::text attendance,
 l.name location_name,l.address,s.display_name coach_name,
 p2.team,p2.gender,p2.position,p2.strong_foot,p2.height_cm,p2.development_goals,p2.original_data,p2.converted_player_id,coalesce(owner.display_name,owner_profile.full_name) assigned_name,a.rating academy_rating,a.feedback academy_feedback,coalesce(a.ready,false) academy_ready,
 p.rating parent_rating,p.feedback parent_feedback,trial_has_subscription(r.player_id) subscribed,p2.converted_at,p.comment_submitted_at,
 e.ends_at+interval '24 hours' attendance_due_at,r.confirmed_at+interval '48 hours' feedback_due_at,
 notice.status feedback_mail_status,notice.last_error feedback_mail_error
 from trial_requests r join trial_families f on f.id=r.family_id join trial_players p2 on p2.id=r.player_id left join staff_profiles owner on owner.id=r.assigned_to left join profiles owner_profile on owner_profile.id=r.assigned_to
 left join training_events e on e.id=r.event_id left join event_participants ep on ep.id=r.participant_id
 left join locations l on l.id=e.location_id left join staff_profiles s on s.id=e.trainer_id
 left join trial_feedback a on a.request_id=r.id and a.event_id=r.event_id and a.author_type='academy'
 left join trial_feedback p on p.request_id=r.id and p.event_id=r.event_id and p.author_type='parent'
 left join lateral(select j.status,j.last_error from notification_jobs j where j.kind='trial_feedback' and j.payload->>'request_id'=r.id::text order by j.created_at desc limit 1) notice on true;
revoke all on trial_team_overview from public,anon,authenticated;
grant select on trial_team_overview to service_role;


create or replace function trial_delivery_allowed(recipient text,kind text,payload jsonb) returns boolean language plpgsql stable security definer set search_path=public as $$
declare f trial_families; r trial_requests; ep event_participants; e training_events; zero_at timestamptz; customer_notice boolean:=false;
begin
 if not trial_enabled() then return false; end if;
 select * into f from trial_families where id=(payload->>'family_id')::uuid;
 if f.id is null or lower(trim(f.email))<>lower(trim(recipient)) or not f.operational_consent or f.stopped_at is not null or f.created_at+interval '180 days'<=now() then return false; end if;
 if not exists(select 1 from parents where id=f.parent_id and archived_at is null and lower(trim(contact_email))=lower(trim(recipient))) or not email_preference_allows(recipient,kind,payload) then return false;end if;
 if kind='trial_welcome' then return exists(select 1 from trial_players where family_id=f.id and converted_at is null);end if;
 if f.email_verified_at is null then return false;end if;
 if kind in ('trial_day7','trial_day14') then
  if coalesce((payload->>'family_sequence')::boolean,false) is not true or not f.marketing_consent or trial_family_has_subscription(f.id) then return false; end if;
  select min(x.feedback_at) into zero_at from trial_requests x join trial_players p on p.id=x.player_id join event_participants a on a.id=x.participant_id join training_events t on t.id=x.event_id where x.family_id=f.id and x.status<>'closed' and p.converted_at is null and x.confirmed_at is not null and a.status='attended_manual' and not a.removed_from_event and t.status='scheduled' and exists(select 1 from trial_feedback b where b.request_id=x.id and b.event_id=x.event_id and b.author_type='academy' and b.ready);
  if zero_at is null or now()<zero_at+(case when kind='trial_day7' then interval '7 days' else interval '14 days' end) or (kind='trial_day7' and now()>=zero_at+interval '14 days') then return false;end if;
  if exists(select 1 from trial_feedback b join trial_requests x on x.id=b.request_id where x.family_id=f.id and b.author_type='parent' and b.rating<=2) then return false;end if;
  if not exists(select 1 from notification_jobs j where j.kind='trial_feedback' and j.payload->>'family_id'=f.id::text and j.status='sent') then return false;end if;
  if exists(select 1 from notification_jobs j where j.kind in ('trial_feedback','trial_day7','trial_day14') and j.payload->>'family_id'=f.id::text and j.status='sent' and j.updated_at>now()-interval '48 hours' and j.kind<>trial_delivery_allowed.kind) then return false;end if;
  return true;
 end if;
 select * into r from trial_requests where id=(payload->>'request_id')::uuid and family_id=f.id;
 if r.id is null or r.status='closed' or r.event_id::text is distinct from payload->>'event_id' then return false;end if;
 customer_notice:=kind in ('trial_customer_planning','trial_customer_reminder','trial_customer_cancelled');
 if customer_notice then
  if not exists(select 1 from trial_players where id=r.player_id and converted_at is not null) then return false;end if;
  kind:=replace(kind,'trial_customer_','trial_');
 elsif trial_has_subscription(r.player_id) then return false;end if;
 select * into ep from event_participants where id=r.participant_id;
 select * into e from training_events where id=r.event_id;
 if ep.id is null then return false;end if;
 if kind='trial_cancelled' then return e.status='cancelled' or ep.removed_from_event or ep.status in ('cancelled','excused','absent');end if;
 if e.status='cancelled' or ep.removed_from_event then return false;end if;
 if kind in ('trial_planning','trial_reminder') then
  return ep.status='planned' and e.starts_at>now() and (payload->>'starts_at')::timestamptz=e.starts_at and (payload->>'revision')::int=e.revision;
 end if;
 if kind='trial_feedback' then return r.confirmed_at is not null and ep.status='attended_manual' and (payload->>'confirmed_at')::timestamptz is not distinct from r.confirmed_at and r.feedback_at is not null and exists(select 1 from trial_feedback where request_id=r.id and event_id=r.event_id and author_type='academy' and ready);end if;
 return false;
end $$;
create or replace function plan_trial_notifications() returns integer language plpgsql security definer set search_path=public as $$
declare row record; f trial_families; stage text; body jsonb; job_key text; mail_kind text; n integer:=0;
begin
 if not trial_enabled() then return 0;end if;
 for row in select r.*,family_row.email,e.starts_at,e.revision,ep.status attendance,ep.revision participation_revision,ep.removed_from_event from trial_requests r join trial_families family_row on family_row.id=r.family_id join training_events e on e.id=r.event_id join event_participants ep on ep.id=r.participant_id where r.status<>'closed' and family_row.stopped_at is null loop
  body:=jsonb_build_object('family_id',row.family_id,'request_id',row.id,'player_id',row.player_id,'event_id',row.event_id,'starts_at',row.starts_at,'revision',row.revision,'confirmed_at',row.confirmed_at);
  for stage in select unnest(array['trial_planning','trial_reminder','trial_cancelled','trial_feedback']) loop
   if stage='trial_reminder' and (row.starts_at>now()+interval '24 hours' or row.starts_at<=row.scheduled_at+interval '24 hours') then continue;end if;
   mail_kind:=stage;
   if exists(select 1 from trial_players where id=row.player_id and converted_at is not null) then
    if stage='trial_feedback' then continue;end if;
    mail_kind:=replace(stage,'trial_','trial_customer_');
   end if;
   if not trial_delivery_allowed(row.email,mail_kind,body) then continue;end if;
   job_key:=mail_kind||':'||row.id||':'||row.event_id||':'||case when stage='trial_planning' then row.revision::text when stage='trial_cancelled' then row.revision||':'||row.participation_revision when stage='trial_reminder' then row.starts_at::text else row.confirmed_at::text end;
   insert into notification_jobs(idempotency_key,kind,recipient,payload) values(job_key,mail_kind,row.email,body) on conflict(idempotency_key) do update set payload=excluded.payload where notification_jobs.status in ('pending','held') and notification_jobs.payload is distinct from excluded.payload;
   if found then n:=n+1;end if;
  end loop;
 end loop;
 for f in select * from trial_families where stopped_at is null loop
  body:=jsonb_build_object('family_id',f.id,'family_sequence',true);
  for stage in select unnest(array['trial_day7','trial_day14']) loop
   if not trial_delivery_allowed(f.email,stage,body) then continue;end if;
   insert into notification_jobs(idempotency_key,kind,recipient,payload) values(stage||':family:'||f.id,stage,f.email,body) on conflict(idempotency_key) do nothing;
   if found then n:=n+1;end if;
  end loop;
 end loop;
 return n;
end $$;

create or replace function public.trial_convert_for_review(input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare p trial_players; f trial_families; sub subscriptions; review subscription_assignment_reviews;
begin
 if not is_admin() then raise exception 'Keine Berechtigung'; end if;
 select * into p from trial_players where id=(input->>'player_id')::uuid for update;
 if p.id is null or p.converted_player_id is not null then return; end if;
 select * into f from trial_families where id=p.family_id for update;
 select * into review from subscription_assignment_reviews where id=(input->>'review_id')::uuid for update;
 select * into sub from subscriptions where id=review.subscription_id for update;
 if review.signature is distinct from input->>'signature' or review.status<>'pending' or sub.status not in ('active','trialing') then raise exception 'Abo-Zuordnung hat sich geändert'; end if;
 if f.stopped_at is not null then raise exception 'Probefamilie beendet'; end if;
 if not (
  sub.parent_id=f.parent_id or exists(select 1 from parent_stripe_customers where parent_id=f.parent_id and stripe_customer_id=sub.stripe_customer_id)
  or exists(select 1 from stripe_customer_registry where id=sub.stripe_customer_id and lower(trim(email))=lower(trim(f.email)))
 ) and length(trim(coalesce(input->>'manual_trial_reason','')))<10 then raise exception 'Probefamilie passt nicht eindeutig zum Stripe-Kunden'; end if;
 if sub.parent_id is not null and sub.parent_id<>f.parent_id then raise exception 'Stripe-Kunde ist bereits einer anderen Familie zugeordnet'; end if;
 if exists(select 1 from parent_stripe_customers where stripe_customer_id=sub.stripe_customer_id and parent_id<>f.parent_id) then raise exception 'Stripe-Kunde gehört bereits zu einer anderen Familie'; end if;
 perform set_config('app.audit_reason','Probetraining übernehmen: '||coalesce(input->>'manual_trial_reason','Bestätigte Familienzuordnung'),true);
 insert into players(id,first_name,last_name,birth_year,camp_birth_date,team,gender,club,position,strong_foot,height_cm,development_goals)
 values(p.id,p.first_name,p.last_name,extract(year from p.birth_date),p.birth_date,p.team,p.gender,p.club,p.position,p.strong_foot,p.height_cm,p.development_goals);
 insert into parent_players(parent_id,player_id) values(f.parent_id,p.id);
 insert into parent_stripe_customers(parent_id,stripe_customer_id) values(f.parent_id,sub.stripe_customer_id) on conflict do nothing;
 update subscriptions set parent_id=f.parent_id where id=sub.id;
 update parents set notifications_held=false where id=f.parent_id and f.email_verified_at is not null and exists(select 1 from auth.users u where u.id=parents.auth_user_id and u.email_confirmed_at is not null);
 update trial_players set converted_player_id=p.id,converted_at=now() where id=p.id;
end $$;
create function trial_finish_conversion() returns trigger language plpgsql security definer set search_path=public as $$
declare request uuid;
begin
 if new.converted_at is not null and old.converted_at is null then
  select id into request from trial_requests where player_id=new.id;
  update notification_jobs set status='held',last_error='Als Abonnent übernommen' where status in ('pending','failed','held') and payload->>'request_id'=request::text and kind like 'trial_%';
  -- Historical free participation stays a trial; future bookings are ordinary participants.
 end if;return new;
end $$;
create trigger trial_conversion_finished after update of converted_at on trial_players for each row execute function trial_finish_conversion();
-- Complete normal notification access even when the Abo was assigned before email verification.
create function trial_release_parent_notifications() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.auth_user_id is not null and new.email_verified_at is not null and exists(select 1 from trial_players p where p.family_id=new.id and p.converted_at is not null) then
 update parents set notifications_held=false where id=new.parent_id and auth_user_id=new.auth_user_id;end if;
 return new;
end $$;
create trigger trial_verified_parent after update of auth_user_id,email_verified_at on trial_families for each row execute function trial_release_parent_notifications();

create function cleanup_trial_data() returns integer language plpgsql security definer set search_path=public as $$
declare f trial_families; children uuid[]; requests uuid[]; participants uuid[]; feedbacks uuid[]; jobs uuid[]; deliveries uuid[]; invitations uuid[]; n integer:=0; parent_owned boolean;
begin
 for f in select * from trial_families where created_at+interval '180 days'<=now() for update skip locked loop
  select array_agg(id) into children from trial_players where family_id=f.id and converted_player_id is null;
  if children is null then continue;end if;
  -- Do not delete an in-flight sender's record. It is already ineligible for new delivery.
  if exists(select 1 from notification_jobs where payload->>'family_id'=f.id::text and status='processing') then continue;end if;
  select array_agg(id) into requests from trial_requests where player_id=any(children);
  select array_agg(id) into participants from event_participants where trial_player_id=any(children);
  select array_agg(id) into feedbacks from trial_feedback where player_id=any(children);
  select array_agg(id) into jobs from notification_jobs where payload->>'family_id'=f.id::text and (payload->>'request_id'=any(select x::text from unnest(requests) x) or not exists(select 1 from trial_players where family_id=f.id and converted_player_id is not null));
  select array_agg(id) into deliveries from notification_deliveries where job_id=any(jobs);
  delete from notification_deliveries where id=any(deliveries);
  delete from notification_jobs where id=any(jobs);
  update trial_requests set participant_id=null where id=any(requests);
  delete from event_participants where id=any(participants);
  delete from trial_feedback where id=any(feedbacks);
  delete from trial_requests where id=any(requests);
  delete from trial_players where id=any(children);
  -- Snapshot input may contain deleted sibling details even in a converted family.
  update trial_families set request_input='{}' where id=f.id;
  delete from audit_log where (table_name='trial_players' and record_id=any(children)) or (table_name='trial_requests' and record_id=any(requests)) or (table_name='trial_feedback' and record_id=any(feedbacks)) or (table_name='event_participants' and record_id=any(participants)) or (table_name='notification_jobs' and record_id=any(jobs)) or (table_name='trial_families' and record_id=f.id) or (table_name='notification_deliveries' and record_id=any(deliveries));
  n:=n+array_length(children,1);
  if not exists(select 1 from trial_players where family_id=f.id) then
   delete from trial_access_links where family_id=f.id;
   delete from trial_families where id=f.id;
   -- Shared/paid/camp accounts are preserved. Erase an otherwise unused trial parent.
   parent_owned:=f.parent_created_for_trial and not exists(select 1 from parent_players where parent_id=f.parent_id) and not exists(select 1 from subscriptions where parent_id=f.parent_id) and not exists(select 1 from parent_stripe_customers where parent_id=f.parent_id) and not exists(select 1 from camp_bookings where parent_id=f.parent_id);
   if parent_owned then
    update parents set full_name='Gelöschtes Probetraining-Konto',contact_email=f.parent_id||'@deleted.invalid',phone=null,city=null,billing_email=null,archived_at=now() where id=f.parent_id;
    if f.auth_user_id is not null then
     update profiles set full_name='' where id=f.auth_user_id;
     update pai_requests set prompt=null,answer=null,expires_at=now() where user_id=f.auth_user_id;
     -- Supabase retains auth.users for referential integrity; revoke sessions and erase identity.
     update auth.users set email=f.auth_user_id||'@deleted.invalid',raw_user_meta_data='{}',raw_app_meta_data='{}',encrypted_password='',phone=null,phone_change='',phone_change_token='',email_change='',email_change_token_new='',email_change_token_current='',confirmation_token='',recovery_token='',reauthentication_token='',deleted_at=now(),banned_until=now()+interval '100 years' where id=f.auth_user_id;
     delete from auth.sessions where user_id=f.auth_user_id;
     delete from auth.refresh_tokens where user_id=f.auth_user_id::text;
     delete from auth.identities where user_id=f.auth_user_id;
     delete from auth.audit_log_entries where payload->>'actor_id'=f.auth_user_id::text or lower(payload->>'actor_username')=lower(f.email);
    end if;
    select array_agg(id) into invitations from parent_invitations where parent_id=f.parent_id;
    delete from parent_invitations where id=any(invitations);
    delete from audit_log where (table_name='parent_invitations' and record_id=any(invitations)) or (table_name='parents' and record_id=f.parent_id) or (table_name='profiles' and record_id=f.auth_user_id);
   end if;
  end if;
 end loop;
 delete from trial_access_links where expires_at<now()-interval '1 day';
 delete from trial_request_limits where expires_at<now();
 return n;
end $$;

revoke all on function issue_trial_access(uuid),consume_trial_access(uuid,uuid,uuid),queue_trial_access(text),trial_family_has_subscription(uuid),cleanup_trial_data() from public,anon,authenticated;
grant execute on function issue_trial_access(uuid),consume_trial_access(uuid,uuid,uuid),queue_trial_access(text),trial_family_has_subscription(uuid),cleanup_trial_data() to service_role;
notify pgrst,'reload schema';
commit;
