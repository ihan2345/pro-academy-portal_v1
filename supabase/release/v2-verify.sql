-- Read-only verification, valid both before and after final activation.
begin transaction read only;
select jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,
   'authenticated_insert',has_table_privilege('authenticated',c.oid,'insert'),
   'authenticated_update',has_table_privilege('authenticated',c.oid,'update'),
   'anon_select',has_table_privilege('anon',c.oid,'select')))
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('training_backfills','training_backfill_private_notes','stripe_customer_registry')),
 'policies',(select jsonb_agg(jsonb_build_object('table',tablename,'policy',policyname,'roles',roles,'command',cmd,'using',qual)) from pg_policies
   where schemaname='public' and tablename in ('training_backfills','training_backfill_private_notes','stripe_customer_registry')),
 'authenticated_can_save',has_function_privilege('authenticated','public.save_training_backfill(jsonb,text)','execute'),
 'anon_can_save',has_function_privilege('anon','public.save_training_backfill(jsonb,text)','execute'),
 'authenticated_can_sync_registry',has_function_privilege('authenticated','public.observe_stripe_customers(jsonb)','execute'),
 'backfills',(select count(*) from public.training_backfills),
 'private_notes',(select count(*) from public.training_backfill_private_notes),
 'backfill_jobs',(select count(*) from public.notification_jobs where kind='training_backfill'),
 'registry_customers',(select count(*) from public.stripe_customer_registry),
 'missing_linked_customers',(select count(*) from public.parent_stripe_customers p where p.stripe_customer_id like 'cus_%' and not exists(select 1 from public.stripe_customer_registry r where r.id=p.stripe_customer_id)),
 'history',(select jsonb_agg(jsonb_build_object('version',version,'name',name)) from supabase_migrations.schema_migrations where version in ('202609230010','202609230011'))
) as verification;
commit;
