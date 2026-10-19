-- Global feature switches: no client writes, identity always derived from the session.
create table public.platform_permissions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 permission text not null check (permission in ('manage_features')),
 unique(user_id,permission)
);
create table public.platform_features (
 id uuid primary key default gen_random_uuid(),
 key text not null unique,
 enabled boolean not null default false,
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now()
);
insert into public.platform_features(key,enabled) values ('pai',false);
alter table public.platform_permissions enable row level security;
alter table public.platform_features enable row level security;
revoke all on public.platform_permissions,public.platform_features from public,anon,authenticated;
grant all on public.platform_permissions,public.platform_features to service_role;
create trigger platform_permission_audit after insert or update or delete on public.platform_permissions for each row execute function public.audit_change();
create trigger platform_feature_audit after update on public.platform_features for each row execute function public.audit_change();
create function public.can_manage_features() returns boolean language sql stable security definer set search_path=public as $$
 select public.is_admin() and exists(select 1 from platform_permissions where user_id=auth.uid() and permission='manage_features')
$$;
revoke all on function public.can_manage_features() from public,anon;
grant execute on function public.can_manage_features() to authenticated;
grant select on public.platform_features to authenticated;
create policy feature_manager_read on public.platform_features for select to authenticated using(public.can_manage_features());
create function public.set_platform_feature(feature_key text,wanted boolean,expected boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.can_manage_features() then raise exception 'Forbidden' using errcode='42501'; end if;
 if wanted is null or expected is null then raise exception 'Invalid value'; end if;
 perform pg_advisory_xact_lock(170001);
 perform set_config('app.audit_reason','Globalen Funktionsschalter geändert',true);
 update platform_features set enabled=wanted,updated_by=auth.uid(),updated_at=clock_timestamp() where key=feature_key and enabled=expected;
 if not found then raise exception 'FEATURE_CHANGED'; end if;
end $$;
revoke all on function public.set_platform_feature(text,boolean,boolean) from public,anon;
grant execute on function public.set_platform_feature(text,boolean,boolean) to authenticated;
-- Retire the former independent config switch. It cannot disable or re-enable pAi.
update public.pai_config set value=jsonb_set(value,'{enabled}','true'),version=version+1 where singleton;

create or replace function public.pai_preference(wanted boolean default null) returns boolean language plpgsql security definer set search_path=public as $$
declare previous boolean;
begin
 if not coalesce((select enabled from platform_features where key='pai'),false) then raise exception 'DISABLED'; end if;
 if public.current_role() is distinct from 'parent'::public.app_role then raise exception 'Forbidden'; end if;
 if not exists(select 1 from parents where auth_user_id=auth.uid() and archived_at is null) then raise exception 'Forbidden'; end if;
 select coalesce((select enabled from pai_preferences where user_id=auth.uid()),true) into previous;
 if wanted is not null and wanted is distinct from previous then
  insert into audit_log(actor_id,actor_type,action,table_name,record_id,old_value,new_value,reason) values(auth.uid(),'user','UPDATE','pai_preferences',auth.uid(),jsonb_build_object('enabled',previous),jsonb_build_object('enabled',wanted),'Persönliche pAi-Einstellung');
 end if;
 if wanted is not null then insert into pai_preferences(user_id,enabled) values(auth.uid(),wanted) on conflict(user_id) do update set enabled=excluded.enabled; end if;
 return coalesce((select enabled from pai_preferences where user_id=auth.uid()),true);
end $$;

create or replace function public.pai_reserve(uid uuid, rid uuid, fp text, role_name text, max_questions integer, period_start timestamptz, config_version integer, reserve_cost numeric, model_name text) returns jsonb language plpgsql security definer set search_path=public as $$
declare c pai_config; previous pai_requests; used integer; spent numeric; budget_start timestamptz; retention integer; ov pai_overrides;
begin
 -- One lock serializes quota and budget checks, including admin changes.
 perform pg_advisory_xact_lock(170001);
 if not coalesce((select enabled from platform_features where key='pai'),false) then raise exception 'DISABLED'; end if;
 select * into c from pai_config where singleton;
 if c.version<>config_version then raise exception 'CONFIG_CHANGED'; end if;
 if not (c.value->>'enabled')::boolean then raise exception 'DISABLED'; end if;
 if role_name not in ('parent','staff','admin') or not exists(select 1 from profiles where id=uid and role::text=role_name) then raise exception 'FORBIDDEN'; end if;
 if role_name='staff' and not exists(select 1 from staff_profiles where id=uid and active) then raise exception 'FORBIDDEN'; end if;
 if role_name='parent' and (not exists(select 1 from parents where auth_user_id=uid and archived_at is null) or not coalesce((select enabled from pai_preferences where user_id=uid),true)) then raise exception 'DISABLED'; end if;
 select * into previous from pai_requests where id=rid;
 if found then
  if previous.user_id<>uid or previous.fingerprint<>fp then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('duplicate',true,'status',previous.status,'answer',case when previous.expires_at>now() then previous.answer else null end);
 end if;
 if max_questions<0 or max_questions>1000 or reserve_cost<=0 or reserve_cost>1 or period_start>now() or period_start<(date_trunc('month',now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin') then raise exception 'INVALID_RESERVATION'; end if;
 -- Overrides are re-read under the lock, including expiry at reservation time.
 select * into ov from pai_overrides where user_id=uid and active and (expires_at is null or expires_at>now());
 if found then
  max_questions:=ov.limit_value;
  period_start:=date_trunc(case when ov.period_kind='month' then 'month' else 'day' end,now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
 end if;
 -- Expired calls refund questions, but retain uncertain provider cost reservations.
 update pai_requests set status='failed',error_code='TIMEOUT' where status='reserved' and lease_until<now();
 select count(*) into used from pai_requests where user_id=uid and created_at>=period_start and status in ('reserved','completed');
 if used>=max_questions then raise exception 'QUOTA'; end if;
 budget_start:=date_trunc('month',now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
 select coalesce(sum(cost_usd+reserve_usd),0) into spent from pai_requests where created_at>=budget_start;
 if spent+reserve_cost>(c.value->>'budgetUsd')::numeric then raise exception 'BUDGET'; end if;
 retention:=(c.value->>'retentionDays')::integer;
 insert into pai_requests(id,user_id,role,fingerprint,reserve_usd,model,expires_at) values(rid,uid,role_name,fp,reserve_cost,model_name,now()+make_interval(days=>retention));
 return jsonb_build_object('duplicate',false);
end $$;

create or replace function public.pai_save_config(settings jsonb,expected integer) returns void language plpgsql security definer set search_path=public as $$
begin
 if not coalesce((select enabled from platform_features where key='pai'),false) then raise exception 'DISABLED'; end if;
 if not public.is_admin() then raise exception 'Forbidden'; end if;
 perform pg_advisory_xact_lock(170001);
 settings:=jsonb_set(settings,'{enabled}','true');
 -- Server validates the full shape; DB also bounds all cost/retention/limit fields.
 if jsonb_typeof(settings)<>'object' or not (settings ?& array['enabled','bases','factors','coach','admin','monthlyFallback','budgetUsd','retentionDays','model']) or (settings->>'budgetUsd')::numeric not between 0 and 10000 or (settings->>'retentionDays')::integer not between 0 and 365 or settings->>'model' not in ('gpt-5.4-mini','gpt-5.4-mini-2026-03-17') then raise exception 'Invalid configuration'; end if;
 perform (settings->>'enabled')::boolean;
 if exists(select 1 from jsonb_each_text(settings->'bases') where value::numeric not between 0 and 1000 or value::numeric<>trunc(value::numeric)) or exists(select 1 from jsonb_each_text(settings->'factors') where value::numeric not between 0 and 1000 or value::numeric<>trunc(value::numeric)) then raise exception 'Invalid limits'; end if;
 if (settings->>'coach')::integer not between 0 and 1000 or (settings->>'admin')::integer not between 0 and 1000 or (settings->>'monthlyFallback')::integer not between 0 and 1000 then raise exception 'Invalid limits'; end if;
 perform set_config('app.audit_reason','pAi Konfiguration',true);
 update pai_config set value=settings,version=version+1 where singleton and version=expected;
 if not found then raise exception 'CONFIG_CHANGED'; end if;
 -- Shortening retention applies immediately; increasing it never restores deleted text.
 update pai_requests set expires_at=least(expires_at,created_at+make_interval(days=>(settings->>'retentionDays')::integer));
 update pai_requests set prompt=null,answer=null where expires_at<=now() and (prompt is not null or answer is not null);
end $$;

create or replace function public.pai_save_override(target uuid,wanted integer,kind text,note text,expiry timestamptz,is_active boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 if not coalesce((select enabled from platform_features where key='pai'),false) then raise exception 'DISABLED'; end if;
 if not public.is_admin() then raise exception 'Forbidden'; end if;
 perform pg_advisory_xact_lock(170001);
 if length(trim(note))<3 or length(note)>500 or (expiry is not null and expiry<=now()) then raise exception 'Invalid override'; end if;
 perform set_config('app.audit_reason',note,true);
 insert into pai_overrides(user_id,limit_value,period_kind,reason,created_by,updated_by,expires_at,active) values(target,wanted,kind,note,auth.uid(),auth.uid(),expiry,is_active)
 on conflict(user_id) do update set limit_value=excluded.limit_value,period_kind=excluded.period_kind,reason=excluded.reason,updated_by=excluded.updated_by,expires_at=excluded.expires_at,active=excluded.active,updated_at=now();
 -- Invalidate in-flight limit snapshots before reservation.
 update pai_config set version=version+1 where singleton;
end $$;
