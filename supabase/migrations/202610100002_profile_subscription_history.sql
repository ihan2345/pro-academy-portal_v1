-- Stripe service periods only. No invoices, amounts or customer details exposed.
create table public.profile_subscription_history (
 subscription_id uuid primary key references public.subscriptions(id) on delete cascade,
 source_signature text not null,
 periods jsonb not null check (jsonb_typeof(periods) = 'array'),
 checked_at timestamptz not null default now()
);
alter table public.profile_subscription_history enable row level security;
revoke all on public.profile_subscription_history from public, anon, authenticated;
grant select, insert, update, delete on public.profile_subscription_history to service_role;
