-- Additive pAi storage. No changes to subscriptions, badges or training rules.
create table public.pai_preferences(user_id uuid primary key references public.profiles(id), enabled boolean not null default true);
create table public.pai_config(id uuid primary key default gen_random_uuid(), singleton boolean not null unique default true check(singleton), version integer not null default 1, value jsonb not null);
insert into public.pai_config(value) values ('{"enabled":true,"bases":{"starter":3,"bronze":5,"silver":7,"gold":10,"ultimate":12},"factors":{"firsttouch":50,"gamechanger":70,"pro":100,"nextlevel":100},"coach":10,"admin":15,"monthlyFallback":10,"budgetUsd":5,"retentionDays":30,"model":"gpt-5.4-mini"}');
create table public.pai_overrides(id uuid primary key default gen_random_uuid(), user_id uuid not null unique references public.profiles(id), limit_value integer not null check(limit_value between 0 and 1000), period_kind text not null check(period_kind in ('day','month')), reason text not null, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_by uuid references public.profiles(id), expires_at timestamptz, active boolean not null default true, updated_at timestamptz not null default now());
create table public.pai_requests(id uuid primary key, user_id uuid not null references public.profiles(id), role text not null, fingerprint text not null, status text not null default 'reserved' check(status in ('reserved','completed','failed')), created_at timestamptz not null default now(), lease_until timestamptz not null default (now()+interval '5 minutes'), reserve_usd numeric not null check(reserve_usd>=0), cost_usd numeric not null default 0 check(cost_usd>=0), input_tokens integer not null default 0, output_tokens integer not null default 0, prompt text, answer text, error_code text, model text not null, price_version text not null default '2026-10-17', expires_at timestamptz not null);
create index pai_requests_user_date on public.pai_requests(user_id,created_at);
create index pai_requests_date on public.pai_requests(created_at);
-- No client table access. RPCs derive identity; service functions are server-only.
do $$ declare t text; begin foreach t in array array['pai_preferences','pai_config','pai_overrides','pai_requests'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop; end $$;
create trigger pai_config_audit after update on public.pai_config for each row execute function public.audit_change();
create trigger pai_override_audit after insert or update on public.pai_overrides for each row execute function public.audit_change();
create function public.pai_preference(wanted boolean default null) returns boolean language plpgsql security definer set search_path=public as $$
declare previous boolean;
begin
 if public.current_role() is distinct from 'parent'::public.app_role then raise exception 'Forbidden'; end if;
 if not exists(select 1 from parents where auth_user_id=auth.uid() and archived_at is null) then raise exception 'Forbidden'; end if;
 select coalesce((select enabled from pai_preferences where user_id=auth.uid()),true) into previous;
 if wanted is not null and wanted is distinct from previous then
  insert into audit_log(actor_id,actor_type,action,table_name,record_id,old_value,new_value,reason) values(auth.uid(),'user','UPDATE','pai_preferences',auth.uid(),jsonb_build_object('enabled',previous),jsonb_build_object('enabled',wanted),'Persönliche pAi-Einstellung');
 end if;
 if wanted is not null then insert into pai_preferences(user_id,enabled) values(auth.uid(),wanted) on conflict(user_id) do update set enabled=excluded.enabled; end if;
 return coalesce((select enabled from pai_preferences where user_id=auth.uid()),true);
end $$;
revoke all on function public.pai_preference(boolean) from public,anon;
grant execute on function public.pai_preference(boolean) to authenticated;

create function public.pai_reserve(uid uuid, rid uuid, fp text, role_name text, max_questions integer, period_start timestamptz, config_version integer, reserve_cost numeric, model_name text) returns jsonb language plpgsql security definer set search_path=public as $$
declare c pai_config; previous pai_requests; used integer; spent numeric; budget_start timestamptz; retention integer; ov pai_overrides;
begin
 -- One lock serializes quota and budget checks, including admin changes.
 perform pg_advisory_xact_lock(170001);
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
create function public.pai_finish(uid uuid,rid uuid,success boolean,actual_cost numeric,tokens_in integer,tokens_out integer,question text,response_text text,failure text,uncertain boolean) returns void language plpgsql security definer set search_path=public as $$
declare r pai_requests; retention integer;
begin
 perform pg_advisory_xact_lock(170001);
 select * into r from pai_requests where id=rid and user_id=uid for update;
 if not found then raise exception 'REQUEST_MISSING'; end if;
 if r.status='completed' or (r.status='failed' and r.error_code is distinct from 'TIMEOUT') then return; end if;
 if actual_cost<0 or actual_cost>r.reserve_usd or tokens_in<0 or tokens_out<0 then raise exception 'INVALID_COST'; end if;
 select (value->>'retentionDays')::integer into retention from pai_config where singleton;
 update pai_requests set status=case when success then 'completed' else 'failed' end,
 cost_usd=actual_cost,reserve_usd=case when uncertain then greatest(0,r.reserve_usd-actual_cost) else 0 end,
 input_tokens=tokens_in,output_tokens=tokens_out,
 prompt=case when success and retention>0 then left(question,4000) else null end,
 answer=case when success and retention>0 then left(response_text,12000) else null end,
 expires_at=least(r.expires_at,now()+make_interval(days=>retention)),error_code=failure where id=rid;
end $$;
create function public.pai_save_config(settings jsonb,expected integer) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Forbidden'; end if;
 perform pg_advisory_xact_lock(170001);
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
create function public.pai_save_override(target uuid,wanted integer,kind text,note text,expiry timestamptz,is_active boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Forbidden'; end if;
 perform pg_advisory_xact_lock(170001);
 if length(trim(note))<3 or length(note)>500 or (expiry is not null and expiry<=now()) then raise exception 'Invalid override'; end if;
 perform set_config('app.audit_reason',note,true);
 insert into pai_overrides(user_id,limit_value,period_kind,reason,created_by,updated_by,expires_at,active) values(target,wanted,kind,note,auth.uid(),auth.uid(),expiry,is_active)
 on conflict(user_id) do update set limit_value=excluded.limit_value,period_kind=excluded.period_kind,reason=excluded.reason,updated_by=excluded.updated_by,expires_at=excluded.expires_at,active=excluded.active,updated_at=now();
 -- Invalidate in-flight limit snapshots before reservation.
 update pai_config set version=version+1 where singleton;
end $$;
create function public.pai_cleanup() returns void language sql security definer set search_path=public as $$
 update pai_requests set prompt=null,answer=null where expires_at<=now() and (prompt is not null or answer is not null);
$$;
revoke all on function public.pai_reserve(uuid,uuid,text,text,integer,timestamptz,integer,numeric,text),public.pai_finish(uuid,uuid,boolean,numeric,integer,integer,text,text,text,boolean),public.pai_cleanup() from public,anon,authenticated;
grant execute on function public.pai_reserve(uuid,uuid,text,text,integer,timestamptz,integer,numeric,text),public.pai_finish(uuid,uuid,boolean,numeric,integer,integer,text,text,text,boolean),public.pai_cleanup() to service_role;
revoke all on function public.pai_save_config(jsonb,integer),public.pai_save_override(uuid,integer,text,text,timestamptz,boolean) from public,anon;
grant execute on function public.pai_save_config(jsonb,integer),public.pai_save_override(uuid,integer,text,text,timestamptz,boolean) to authenticated;

-- Use the existing database scheduler when enabled. No external services or mail.
-- On installations without pg_cron, provision this job before production activation.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('pai-retention','*/10 * * * *','select public.pai_cleanup()');
 end if;
end $$;
