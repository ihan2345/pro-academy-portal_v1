-- V2: additive, transactional backfills. Deploy only with explicit release approval.
create table public.training_backfills (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 period_id uuid not null references public.entitlement_periods(id),
 player_id uuid not null references public.players(id),
 event_type text not null check(event_type in ('Gruppentraining','Einzeltraining','Fördertraining','Athletiktraining')),
 title text not null default 'Nachgetragen' check(length(title) between 1 and 120),
 occurred_on date,
 duration_minutes int not null check(duration_minutes between 1 and 720),
 parent_note text not null check(length(trim(parent_note)) between 3 and 2000),
 location_id uuid references public.locations(id),
 trainer_id uuid references public.staff_profiles(id),
 notify_parents boolean not null default false,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create index training_backfills_period on public.training_backfills(period_id);
create index training_backfills_player on public.training_backfills(player_id);
create table public.training_backfill_private_notes (
 id uuid primary key references public.training_backfills(id),
 note text not null default '' check(length(note)<=2000)
);
alter table public.training_backfills enable row level security;
alter table public.training_backfill_private_notes enable row level security;
revoke all on public.training_backfills, public.training_backfill_private_notes from anon, authenticated;
grant select on public.training_backfills, public.training_backfill_private_notes to authenticated, service_role;
create policy backfill_read on public.training_backfills for select to authenticated using(public.is_team() or public.owns_player(player_id));
create policy backfill_private_read on public.training_backfill_private_notes for select to authenticated using(public.is_team());
create trigger backfill_audit after insert on public.training_backfills for each row execute function public.audit_change();
create trigger backfill_note_audit after insert on public.training_backfill_private_notes for each row execute function public.audit_change();

-- Shared public projection: internal notes are never selected into snapshots.
create function public.backfill_report_events(period uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',b.id,'title',b.title,'event_type',b.event_type,
 'starts_at',b.created_at,'ends_at',b.created_at,
 'status','attended_manual','retrospective',true,'occurred_on',b.occurred_on,
 'duration_minutes',b.duration_minutes,'parent_note',b.parent_note,
 'location_name',coalesce(l.name,''),'trainer_name',coalesce(s.display_name,'')) order by b.created_at,b.id),'[]'::jsonb)
 from public.training_backfills b left join public.locations l on l.id=b.location_id
 left join public.staff_profiles s on s.id=b.trainer_id where b.period_id=period
$$;
revoke all on function public.backfill_report_events(uuid) from public,anon,authenticated;
grant execute on function public.backfill_report_events(uuid) to service_role;

create or replace function public.capture_report(period uuid, force_version boolean default false, contact_number text default '') returns uuid language plpgsql security definer set search_path=public as $$
declare ent public.entitlement_periods; player public.players; report uuid; version_num int; events jsonb; completed int; minutes int;
begin
 select * into ent from public.entitlement_periods where id=period for update;
 if not found or ent.ends_at>now() then raise exception 'Leistungszeitraum noch nicht abgeschlossen'; end if;
 select id into report from public.report_snapshots where period_id=period order by version desc limit 1;
 if found and not force_version then return report; end if;
 select coalesce(max(version),0)+1 into version_num from public.report_snapshots where period_id=period;
 select * into player from public.players where id=ent.player_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'event_type',e.event_type,'starts_at',e.starts_at,'ends_at',e.ends_at,'status',ep.status,'location_name',l.name,'trainer_name',s.display_name) order by e.starts_at),'[]'), count(*) filter(where ep.status in ('attended_auto','attended_manual','cancelled','absent')),coalesce(sum(extract(epoch from(e.ends_at-e.starts_at))/60) filter(where ep.status in ('attended_auto','attended_manual')),0)::int into events,completed,minutes from public.event_participants ep join public.training_events e on e.id=ep.event_id left join public.locations l on l.id=e.location_id left join public.staff_profiles s on s.id=e.trainer_id where ep.period_id=period and not ep.removed_from_event;
 events:=events || public.backfill_report_events(period);
 select completed+count(*), minutes+coalesce(sum(duration_minutes),0)::int into completed,minutes from public.training_backfills where period_id=period;
 insert into public.report_snapshots(period_id,player_id,version,snapshot) values(period,ent.player_id,version_num,jsonb_build_object('player_name',player.first_name||' '||player.last_name,'product_name',ent.product_name,'starts_at',ent.starts_at,'ends_at',ent.ends_at,'included_units',ent.included_units,'athletics_units',ent.athletics_units,'tariff_generation',ent.tariff_generation,'completed',completed,'minutes',minutes,'created_at',now(),'version',version_num,'attendance_policy','charged_absences_v1','suppress_delivery',coalesce(current_setting('app.backfill_report',true),'false')='true','whatsapp',contact_number,'events',events)) returning id into report;
 return report;
end $$;

create or replace function public.register_report_file(snapshot uuid, path text, digest text) returns void language plpgsql security definer set search_path=public as $$
declare r public.report_snapshots; p record; job uuid;
begin
 select * into r from public.report_snapshots where id=$1 for update;
 if not found then raise exception 'Bericht nicht gefunden'; end if;
 insert into public.report_files(snapshot_id,storage_path,sha256) values(snapshot,path,digest) on conflict(snapshot_id) do nothing;
 if coalesce((r.snapshot->>'suppress_delivery')::boolean,false) then return; end if;
 for p in select parents.id,parents.contact_email from public.parents join public.parent_players pp on pp.parent_id=parents.id where pp.player_id=r.player_id and parents.archived_at is null loop
 insert into public.notification_jobs(idempotency_key,kind,recipient,payload) values('report:'||snapshot||':'||p.id,'report',p.contact_email,jsonb_build_object('snapshot_id',snapshot,'player_name',r.snapshot->>'player_name','storage_path',path)) on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into job;
 insert into public.report_deliveries(snapshot_id,parent_id,job_id) values(snapshot,p.id,job) on conflict(job_id) do nothing;
 end loop;
end $$;

create function public.save_training_backfill(input jsonb, contact_number text default '') returns uuid
language plpgsql security definer set search_path=public as $$
declare ent public.entitlement_periods; existing public.training_backfills; saved uuid; units int; used int; recipient record; report uuid;
begin
 if not public.is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 if (input->>'request_id')::uuid is null then raise exception 'Anfrage-ID erforderlich'; end if;
 -- Serialize requests before checking idempotency, including concurrent retries.
 perform pg_advisory_xact_lock(hashtextextended(input->>'request_id',0));
 select * into existing from public.training_backfills where request_id=(input->>'request_id')::uuid;
 if found then
   if existing.created_by<>auth.uid() or existing.period_id<>(input->>'period_id')::uuid then raise exception 'Anfrage gehört zu einer anderen Nachtragung'; end if;
   if existing.event_type is distinct from input->>'event_type'
      or existing.duration_minutes is distinct from (input->>'duration_minutes')::int
      or existing.parent_note is distinct from trim(input->>'parent_note')
      or existing.occurred_on is distinct from nullif(input->>'occurred_on','')::date
      or existing.title is distinct from coalesce(nullif(trim(input->>'title'),''),'Nachgetragen')
      or existing.location_id is distinct from nullif(input->>'location_id','')::uuid
      or existing.trainer_id is distinct from nullif(input->>'trainer_id','')::uuid
      or existing.notify_parents is distinct from coalesce((input->>'notify_parents')::boolean,false)
      or (select note from public.training_backfill_private_notes where id=existing.id) is distinct from coalesce(input->>'internal_note','')
   then raise exception 'Diese Anfrage wurde bereits mit anderen Angaben gespeichert. Stempelkarte aktualisieren.'; end if;
   return existing.id;
 end if;
 select * into ent from public.entitlement_periods where id=(input->>'period_id')::uuid for update;
 if not found or ent.status='void' or ent.starts_at>now() then raise exception 'Kein gültiger vergangener Leistungszeitraum'; end if;
 if not exists(select 1 from public.players where id=ent.player_id and archived_at is null) then raise exception 'Kind nicht verfügbar'; end if;
 if nullif(input->>'occurred_on','') is not null and (
   (input->>'occurred_on')::date>(now() at time zone 'Europe/Berlin')::date or
   (input->>'occurred_on')::date<(ent.starts_at at time zone 'Europe/Berlin')::date or
   (input->>'occurred_on')::date>((ent.ends_at-interval '1 microsecond') at time zone 'Europe/Berlin')::date
 ) then raise exception 'Trainingsdatum muss in der Vergangenheit und im gewählten Zeitraum liegen'; end if;
 units:=case when input->>'event_type'='Athletiktraining' then ent.athletics_units else ent.included_units-ent.athletics_units end;
 select count(*) into used from public.event_participants ep join public.training_events e on e.id=ep.event_id
 where ep.period_id=ent.id and not ep.removed_from_event and ep.status<>'excused'
 and (e.event_type='Athletiktraining')=(input->>'event_type'='Athletiktraining');
 select used+count(*) into used from public.training_backfills where period_id=ent.id
 and (event_type='Athletiktraining')=(input->>'event_type'='Athletiktraining');
 if used>=units then raise exception 'Kein offener Stempel mehr vorhanden. Bitte Stempelkarte aktualisieren.'; end if;
 perform set_config('app.audit_reason','Training nachgetragen',true);
 insert into public.training_backfills(request_id,period_id,player_id,event_type,title,occurred_on,duration_minutes,parent_note,location_id,trainer_id,notify_parents,created_by)
 values((input->>'request_id')::uuid,ent.id,ent.player_id,input->>'event_type',coalesce(nullif(trim(input->>'title'),''),'Nachgetragen'),
 nullif(input->>'occurred_on','')::date,(input->>'duration_minutes')::int,trim(input->>'parent_note'),
 nullif(input->>'location_id','')::uuid,nullif(input->>'trainer_id','')::uuid,coalesce((input->>'notify_parents')::boolean,false),auth.uid()) returning id into saved;
 insert into public.training_backfill_private_notes(id,note) values(saved,coalesce(input->>'internal_note',''));
 if ent.ends_at<=now() then
   perform set_config('app.backfill_report','true',true);
   report:=public.capture_report(ent.id,true,contact_number);
   perform set_config('app.backfill_report','false',true);
 end if;
 if coalesce((input->>'notify_parents')::boolean,false) then
   for recipient in select p.id,p.contact_email from public.parents p join public.parent_players pp on pp.parent_id=p.id
     where pp.player_id=ent.player_id and p.archived_at is null loop
     insert into public.notification_jobs(idempotency_key,kind,recipient,payload)
     values('backfill:'||saved||':'||recipient.id,'training_backfill',recipient.contact_email,
       jsonb_build_object('backfill_id',saved,'parent_id',recipient.id,'player_id',ent.player_id,'period_id',ent.id,
         'player_name',(select first_name||' '||last_name from public.players where id=ent.player_id),
         'parent_note',trim(input->>'parent_note'),'duration_minutes',(input->>'duration_minutes')::int,
         'occurred_on',nullif(input->>'occurred_on',''),'period_starts_at',ent.starts_at,'period_ends_at',ent.ends_at,'snapshot_id',report));
   end loop;
 end if;
 return saved;
end $$;
revoke all on function public.save_training_backfill(jsonb,text) from public,anon;
grant execute on function public.save_training_backfill(jsonb,text) to authenticated;
