-- Run in the SAME transaction as the V2 schema preparation.
-- The currently deployed runner cannot yet process backfill reports/mail.
revoke execute on function public.save_training_backfill(jsonb,text) from authenticated;
