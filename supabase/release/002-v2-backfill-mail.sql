-- Apply after the existing onboarding/Camp release scripts.
-- Keeps all recipient, invitation and Camp checks; enables no recipient or queue.
do $migration$
declare original text; changed text;
begin
 select pg_get_functiondef('public.parent_delivery_allowed(text,text,jsonb)'::regprocedure) into original;
 if position('''training_backfill''' in original)>0 then
  raise exception 'Backfill mail eligibility is already present; inspect before applying again';
 end if;
 changed:=replace(original,
  '''planning'',''attendance'',''correction'',''change'',''report'',''stamp_card''',
  '''planning'',''attendance'',''correction'',''change'',''report'',''stamp_card'',''training_backfill''');
 if changed=original then raise exception 'Unexpected parent_delivery_allowed definition; no changes applied'; end if;
 execute changed;
end $migration$;
