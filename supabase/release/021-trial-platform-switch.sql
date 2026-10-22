-- Same Super-Admin permission, audit and optimistic locking as the pAi switch.
begin;
insert into public.platform_features(key,enabled) values('trial_training',false) on conflict(key) do nothing;
create or replace function public.trial_enabled() returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select enabled from public.platform_features where key='trial_training'),false)
$$;
-- Retire the local staging switch: it can no longer re-enable the feature.
delete from public.system_settings where key='trial_training_release';
notify pgrst,'reload schema';
commit;
