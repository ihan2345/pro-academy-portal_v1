-- Separate visual preference, constrained by the authoritative pAi master switch.
create function public.enforce_pai_feature_dependency() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.key in ('pai','pai_mascot') then
  perform pg_advisory_xact_lock(170001);
  if new.key='pai_mascot' and new.enabled and not coalesce((select enabled from platform_features where key='pai'),false) then
   raise exception 'PAI_DISABLED' using errcode='23514';
  end if;
  if new.key='pai' and not new.enabled then
   update platform_features set enabled=false,updated_by=new.updated_by,updated_at=clock_timestamp()
   where key='pai_mascot' and enabled;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.enforce_pai_feature_dependency() from public,anon,authenticated;
create trigger platform_feature_dependency before insert or update on public.platform_features
for each row execute function public.enforce_pai_feature_dependency();
-- Publish the approved visual when pAi is currently on; never change the master switch.
insert into public.platform_features(key,enabled)
values ('pai_mascot',coalesce((select enabled from public.platform_features where key='pai'),false));
