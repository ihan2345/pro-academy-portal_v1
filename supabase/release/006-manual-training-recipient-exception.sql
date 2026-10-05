-- Apply after 005. Opens only explicitly approved manual training mail recipients.
-- Does not change release settings, enqueue mail, or release existing held jobs.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare original text; changed text; recipient_gate text;
begin
 select pg_get_functiondef('public.parent_delivery_allowed(text,text,jsonb)'::regprocedure) into original;
 if position('manual_training_recipient_exception_v1' in original)>0 then
  raise exception 'Manual training recipient exception already applied';
 end if;
 recipient_gate:='if coalesce((settings->>''enabled'')::boolean,false) is not true or not coalesce(settings->''recipients'',''[]''::jsonb) ? lower(btrim(recipient)) then return false; end if;';
 changed:=replace(original,recipient_gate,
  'if coalesce((settings->>''enabled'')::boolean,false) is not true then return false; end if;');
 if changed=original then raise exception 'Unexpected training delivery gate; no changes applied'; end if;
 original:=changed;
 changed:=replace(original,
  '-- Explicit approvals bypass onboarding only, never the global/recipient gates above.',
  '-- manual_training_recipient_exception_v1: explicit approvals bypass onboarding and the recipient allowlist; the global switch and family checks still apply.');
 if changed=original then raise exception 'Unexpected manual approval rules; no changes applied'; end if;
 original:=changed;
 changed:=replace(original,
  E' return parent_delivery_allowed_before_training(recipient,\n',
  E' -- Automatic training mail still requires the unchanged recipient allowlist.\n if not coalesce(settings->''recipients'',''[]''::jsonb) ? lower(btrim(recipient)) then return false; end if;\n return parent_delivery_allowed_before_training(recipient,\n');
 if changed=original then raise exception 'Unexpected automatic training gate; no changes applied'; end if;
 execute changed;
end $patch$;
notify pgrst,'reload schema';
commit;
