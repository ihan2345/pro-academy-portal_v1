-- First observed by this portal, never Stripe's customer creation date.
create table public.stripe_customer_registry (
 id text primary key check(id like 'cus_%'),
 name text,
 email text,
 first_seen_at timestamptz not null default now()
);
alter table public.stripe_customer_registry enable row level security;
revoke all on public.stripe_customer_registry from anon,authenticated;
grant select on public.stripe_customer_registry to authenticated;
grant select,insert,update on public.stripe_customer_registry to service_role;
create policy registry_admin_read on public.stripe_customer_registry for select to authenticated using(public.is_admin());
create function public.observe_stripe_customer() returns trigger language plpgsql security definer set search_path=public as $$
declare customer_id text;
begin
 if TG_TABLE_NAME='stripe_webhook_events' then
   customer_id:=case when new.payload#>>'{data,object,object}'='customer' then new.payload#>>'{data,object,id}' else coalesce(new.payload#>>'{data,object,customer,id}',new.payload#>>'{data,object,customer}') end;
 else customer_id:=new.stripe_customer_id; end if;
 if customer_id like 'cus_%' then
   insert into public.stripe_customer_registry(id,first_seen_at) values(customer_id,new.created_at)
   on conflict(id) do update set first_seen_at=least(stripe_customer_registry.first_seen_at,excluded.first_seen_at);
 end if;
 return new;
end $$;
revoke all on function public.observe_stripe_customer() from public,anon,authenticated;
create trigger observe_customer after insert on public.stripe_webhook_events for each row execute function public.observe_stripe_customer();
create trigger observe_customer after insert on public.subscriptions for each row execute function public.observe_stripe_customer();
create trigger observe_customer after insert on public.parent_stripe_customers for each row execute function public.observe_stripe_customer();
create trigger observe_customer after insert on public.parents for each row execute function public.observe_stripe_customer();
create trigger observe_customer after insert on public.entitlement_periods for each row execute function public.observe_stripe_customer();
insert into public.stripe_customer_registry(id,first_seen_at)
select customer_id,min(observed_at) from (
 select stripe_customer_id customer_id,created_at observed_at from public.parents
 union all select stripe_customer_id,created_at from public.parent_stripe_customers
 union all select stripe_customer_id,created_at from public.subscriptions
 union all select stripe_customer_id,created_at from public.entitlement_periods
 union all select case when payload#>>'{data,object,object}'='customer' then payload#>>'{data,object,id}' else coalesce(payload#>>'{data,object,customer,id}',payload#>>'{data,object,customer}') end,created_at from public.stripe_webhook_events
) history where customer_id like 'cus_%' group by customer_id;
-- Refresh identity fields without resetting the first observation timestamp.
create function public.observe_stripe_customers(customers jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
 insert into public.stripe_customer_registry(id,name,email)
 select c->>'id',c->>'name',c->>'email' from jsonb_array_elements(customers) c
 on conflict(id) do update set name=excluded.name,email=excluded.email;
end $$;
revoke all on function public.observe_stripe_customers(jsonb) from public,anon,authenticated;
grant execute on function public.observe_stripe_customers(jsonb) to service_role;
