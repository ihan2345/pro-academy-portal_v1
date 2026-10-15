-- Prepared only. Apply explicitly after 008, before deploying the matching app/runner.
-- Does not change release lists, onboarding holds, or send any messages.
begin;
create table public.parent_email_preferences (
 id uuid not null unique default gen_random_uuid(),
 parent_id uuid primary key references public.parents(id),
 enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
alter table public.parent_email_preferences enable row level security;
revoke all on public.parent_email_preferences from anon,authenticated;
grant all on public.parent_email_preferences to service_role;
create trigger parent_email_preferences_audit after insert or update on public.parent_email_preferences
 for each row execute function public.audit_change();

create function public.my_email_preference() returns boolean language plpgsql stable security definer set search_path=public as $$
declare p uuid;
begin
 select id into strict p from parents where auth_user_id=auth.uid() and archived_at is null;
 return coalesce((select enabled from parent_email_preferences where parent_id=p),true);
end $$;
create function public.set_my_email_preference(wanted boolean) returns boolean language plpgsql security definer set search_path=public as $$
declare p parents;
begin
 if wanted is null then raise exception 'Einstellung fehlt'; end if;
 select * into strict p from parents where auth_user_id=auth.uid() and archived_at is null for update;
 perform set_config('app.audit_reason','Persönliche E-Mail-Einstellung',true);
 insert into parent_email_preferences(parent_id,enabled) values(p.id,wanted)
 on conflict(parent_id) do update set enabled=excluded.enabled,updated_at=now()
 where parent_email_preferences.enabled is distinct from excluded.enabled;
 if not wanted then
  update notification_jobs set status=case when status='processing' then status else 'held' end,payload=payload||'{"email_preference_discarded":true}',last_error='Persönlicher E-Mail-Empfang deaktiviert'
  where lower(btrim(recipient))=lower(btrim(p.contact_email)) and kind not in ('invitation','staff_invitation')
   and status in ('pending','held','failed','processing');
 end if;
 return wanted;
end $$;
-- Address-based suppression also covers manually typed recipient addresses and Camp jobs.
create function public.email_preference_allows(recipient text, kind text, payload jsonb) returns boolean
language sql stable security definer set search_path=public as $$
 select case when kind in ('invitation','staff_invitation') then true else
 coalesce(payload->>'email_preference_discarded','false')<>'true' and not exists(
 select 1 from parents p join parent_email_preferences pref on pref.parent_id=p.id
 where lower(btrim(p.contact_email))=lower(btrim(recipient)) and p.archived_at is null and not pref.enabled) end
$$;
create function public.email_job_preference_allows(job_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce((select email_preference_allows(recipient,kind,payload) from notification_jobs where id=job_id),false)
$$;
revoke all on function public.email_job_preference_allows(uuid) from public,anon,authenticated;
grant execute on function public.email_job_preference_allows(uuid) to service_role;
-- Preserve the currently installed gate, including explicit manual approvals.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.parent_delivery_allowed(text,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'parent_delivery_allowed.', 'parent_delivery_allowed_before_email_preference.');
 execute replace(definition,'FUNCTION public.parent_delivery_allowed(', 'FUNCTION public.parent_delivery_allowed_before_email_preference(');
end $$;
create or replace function public.parent_delivery_allowed(recipient text, kind text, payload jsonb) returns boolean
language sql stable security definer set search_path=public as $$
 select email_preference_allows(recipient,kind,payload) and parent_delivery_allowed_before_email_preference(recipient,kind,payload)
$$;
-- Mark new jobs created during opt-out, so opting in never replays them.
create function public.mark_email_preference_hold() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status in ('pending','held','failed') and not email_preference_allows(new.recipient,new.kind,new.payload) then
  new.status:='held'; new.payload:=new.payload||'{"email_preference_discarded":true}';
 end if;
 return new;
end $$;
create trigger email_preference_hold before insert or update on public.notification_jobs
 for each row execute function public.mark_email_preference_hold();
revoke all on function public.my_email_preference(),public.set_my_email_preference(boolean) from public,anon;
grant execute on function public.my_email_preference(),public.set_my_email_preference(boolean) to authenticated;
revoke all on function public.email_preference_allows(text,text,jsonb),public.mark_email_preference_hold(),public.parent_delivery_allowed_before_email_preference(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.email_preference_allows(text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
