-- Local product workflow corrections. Existing allowance algorithms stay intact.
begin;
create function public.product_family_version(family uuid) returns text language sql stable security definer set search_path=public as $$
 with kids as (select player_id id from parent_players where parent_id=family union select t.id from trial_players t join trial_families f on f.id=t.family_id where f.parent_id=family),
 subs as (select id from subscriptions s where s.parent_id=family or exists(select 1 from subscription_players m where m.subscription_id=s.id and m.player_id in(select id from kids)))
 select md5(jsonb_build_array(
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from parents x where id=family),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from profiles x where id in(select auth_user_id from parents where id=family)),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from players x where id in(select id from kids)),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from parent_players x where parent_id=family),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from subscriptions x where id in(select id from subs)),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from subscription_players x where player_id in(select id from kids)),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from entitlement_periods x where player_id in(select id from kids)),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from trial_families x where parent_id=family),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from trial_players x where id in(select id from kids)),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from camp_bookings x where parent_id=family),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from product_purchases x where parent_id=family),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from catalog_product_grants x where parent_id=family or auth_id in(select auth_user_id from parents where id=family)),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from parent_stripe_customers x where parent_id=family)
 )::text)
$$;
revoke all on function product_family_version(uuid) from public,anon,authenticated;
grant execute on function product_family_version(uuid) to service_role;
create table product_payment_links (
 id uuid primary key default gen_random_uuid(), intent_id uuid references product_purchase_intents(id),
 parent_id uuid not null references parents(id), subscription_id text, invoice_id text not null default '',
 payment_intent_id text not null, charge_id text, amount int not null, currency text not null,
 status text not null default 'paid' check(status in('paid','refunded','review')),
 reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(payment_intent_id,invoice_id)
);
alter table product_payment_links enable row level security;
revoke all on product_payment_links from public,anon,authenticated;
grant all on product_payment_links to service_role;
create trigger product_payment_audit after insert or update or delete on product_payment_links for each row execute function audit_change();
-- Separate lifecycle from the financial order state for manually provided services.
alter table product_purchases add column service_status text not null default 'booked' check(service_status in('booked','scheduled','delivered'));
alter table product_purchases add column service_note text not null default '';
-- Use one shared identity bridge for paid non-Abo services; no trial conversion.
do $$ declare d text; begin
 d:=pg_get_functiondef('public.fulfill_product_purchase(jsonb)'::regprocedure);
 d:=replace(d, 'input->>''context_version'' is distinct from product_context_version()', 'input->>''context_version'' is distinct from product_family_version(i.parent_id)');
 d:=replace(d, $a$ else
  if not exists(select 1 from parent_players where parent_id=i.parent_id and player_id=i.player_id)$a$, $a$ else
  if exists(select 1 from trial_players where id=i.player_id and converted_at is null) then perform prepare_trial_camp_player(i.parent_id,i.player_id);end if;
  if not exists(select 1 from parent_players where parent_id=i.parent_id and player_id=i.player_id)$a$);
 execute d;
end $$;
-- Exclusive is a restricted offer, never an open offer carrying a different label.
do $$ declare d text; begin
 d:=pg_get_functiondef('public.publish_catalog_product(jsonb)'::regprocedure);
 d:=replace(d, ' data:=p.draft;', $a$ data:=p.draft;
 if data->>'status'='exclusive' and exists(select 1 from jsonb_array_elements(data->'rules'->'visibility'->'clauses') c where c->'include' ? 'all' or c->'include' ? 'visitor') then raise exception 'Exklusive Angebote benötigen eingeschränkte Sichtbarkeit';end if;$a$);
 execute d;
end $$;
create function public.recheck_product_order(input jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
 if not is_admin() or length(btrim(coalesce(input->>'reason',''))) < 5 then raise exception 'Admin und Prüfgrund erforderlich';end if;
 if exists(select 1 from product_payment_links where intent_id=(input->>'id')::uuid and status in('review','refunded')) then raise exception 'Zahlungsproblem zuerst fachlich prüfen';end if;
 perform set_config('app.audit_reason',input->>'reason',true);
 update product_purchase_intents set status='checkout',reason='Erneute Adminprüfung: '||(input->>'reason'),updated_at=now() where id=(input->>'id')::uuid and status='review';
end $$;
revoke all on function recheck_product_order(jsonb) from public,anon;
grant execute on function recheck_product_order(jsonb) to authenticated;
insert into system_settings(key,value) values('product_workflow_schema_version','27'::jsonb) on conflict(key) do update set value=excluded.value;
notify pgrst,'reload schema';
commit;
