-- Glocke und Aktivitäten: Erledigt / Ignorieren / Erinnern für alle Admins und
-- Mitarbeiter gemeinsam merken. Reine Anzeige-Entscheidung: ändert keine
-- Zahlung, kein Abo, keine Buchung und verschickt nichts.
begin;
create table public.notice_decisions (
  key text primary key check (length(key) between 3 and 300),
  state text not null check (state in ('done','ignored','snoozed')),
  remind_at timestamptz,
  actor_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (state <> 'snoozed' or remind_at is not null)
);
create index notice_decisions_updated on public.notice_decisions(updated_at);
alter table public.notice_decisions enable row level security;
revoke all on public.notice_decisions from public,anon,authenticated;
grant select,insert,update,delete on public.notice_decisions to service_role;
comment on table public.notice_decisions is 'Shared staff acknowledgements for bell and activity notices; display only, no business effect.';
notify pgrst,'reload schema';
commit;
