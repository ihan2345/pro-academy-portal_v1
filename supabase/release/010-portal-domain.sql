-- Activate the portal's canonical production domain without changing recipients,
-- invitation tokens or delivery approvals. No mail is sent by this migration.
begin;
do $patch$
declare original text; changed text;
begin
 select pg_get_functiondef('public.release_parent_invitation(jsonb)'::regprocedure) into original;
 changed:=replace(original,'^https://proacademy-portal[.]proacademy-by-ak[.]workers[.]dev/einladung[?]token=',
 '^https://portal[.]proacademy-ak[.]com/einladung[?]token=');
 if changed=original then raise exception 'Unexpected invitation domain validation'; end if;
 execute changed;
end $patch$;
-- Preserve queued/held delivery state and replace only the old host in payloads.
update public.notification_jobs
set payload=replace(payload::text,'https://proacademy-portal.proacademy-by-ak.workers.dev','https://portal.proacademy-ak.com')::jsonb
where status in ('pending','held') and payload::text like '%https://proacademy-portal.proacademy-by-ak.workers.dev%';
commit;
