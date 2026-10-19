-- Run only on the explicitly approved target database after the pAi migration.
-- This schedules only expired pAi text removal, never mail or training jobs.
create extension if not exists pg_cron;
select cron.schedule('pai-retention','*/10 * * * *','select public.pai_cleanup()');
