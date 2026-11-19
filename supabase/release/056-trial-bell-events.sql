-- Probetraining-Ereignisse in der Glocke: Die Glocke liest die Ereignisse aus
-- den bestehenden Probetraining-Tabellen. Nur die Abmeldung von den Folge-Mails
-- (Tag 7 / Tag 14) hatte bisher keinen Zeitpunkt. Diese Datei ergänzt ihn.
-- Es werden keine Mails erzeugt oder verändert.
-- Apply after 019 (unabhängig von 050-055). Patches the installed
-- trial_parent_action so live drift fails loudly.
begin;
alter table public.trial_families add column if not exists marketing_stopped_at timestamptz;
do $patch$ declare d text; changed text; begin
 d:=pg_get_functiondef('public.trial_parent_action(uuid,jsonb)'::regprocedure);
 changed:=replace(d,
  $s$if input->>'action'='unsubscribe' then update trial_families set marketing_consent=false where id=family;return;end if;$s$,
  $s$if input->>'action'='unsubscribe' then update trial_families set marketing_consent=false,marketing_stopped_at=case when marketing_consent then now() else marketing_stopped_at end where id=family;return;end if;$s$);
 if changed=d then raise exception 'Unexpected trial_parent_action unsubscribe baseline';end if;
 execute changed;
end $patch$;
notify pgrst,'reload schema';
commit;
