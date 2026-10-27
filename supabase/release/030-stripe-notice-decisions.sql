-- Display decisions only: never changes a payment, entitlement or assignment review.
begin;
create table public.stripe_notice_decisions (
  id uuid not null default gen_random_uuid() unique,
  kind text not null check (kind in ('billing','review','activity')),
  entity_id text not null check (length(entity_id) between 1 and 200),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('done','ignored')),
  actor_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(kind,entity_id,fingerprint)
);
create index stripe_notice_decisions_entity on public.stripe_notice_decisions(entity_id);
alter table public.stripe_notice_decisions enable row level security;
revoke all on public.stripe_notice_decisions from public,anon,authenticated;
grant select,insert,update,delete on public.stripe_notice_decisions to service_role;
comment on table public.stripe_notice_decisions is 'Admin dashboard acknowledgements scoped to the exact source state; no billing or assignment effect.';
commit;
