-- Only after explicit publication approval and deployment of BOTH V2 services.
-- Does not release held mail or expand the recipient allowlist.
begin;
grant execute on function public.save_training_backfill(jsonb,text) to authenticated;
notify pgrst, 'reload schema';
commit;
