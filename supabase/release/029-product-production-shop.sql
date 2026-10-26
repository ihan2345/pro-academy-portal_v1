-- Production support and an independent, fail-closed storefront switch.
begin;
insert into public.platform_features(key,enabled) values('product_shop',false) on conflict(key) do nothing;
create function public.product_shop_enabled() returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select enabled from platform_features where key='product_shop'),false)
$$;
revoke all on function public.product_shop_enabled() from public,anon,authenticated;
grant execute on function public.product_shop_enabled() to service_role;
-- This setting belongs to the deployment, never to the browser or ordinary admins.
create table public.product_runtime (
 singleton boolean primary key default true check(singleton),
 livemode boolean not null default false
);
alter table public.product_runtime enable row level security;
revoke all on public.product_runtime from public,anon,authenticated;
grant all on public.product_runtime to service_role;
insert into public.product_runtime(singleton,livemode) values(true,false);
create function public.product_payment_livemode() returns boolean language sql stable security definer set search_path=public as $$
 select livemode from public.product_runtime where singleton
$$;
revoke all on function public.product_payment_livemode() from public,anon,authenticated;
grant execute on function public.product_payment_livemode() to service_role;
-- Adapt the tested canonical routines without replacing unrelated legacy logic.
do $$ declare d text; original text; name text; begin
 foreach name in array array['publish_catalog_product','reserve_product_purchase','fulfill_product_purchase'] loop
  original:=pg_get_functiondef(('public.'||name||'(jsonb)')::regprocedure);
  d:=replace(original, $a$data->'price'->>'livemode' is distinct from 'false'$a$, $a$data->'price'->>'livemode' is distinct from product_payment_livemode()::text$a$);
  d:=replace(d, $a$(proof->>'livemode')::boolean is distinct from false$a$, $a$(proof->>'livemode')::boolean is distinct from product_payment_livemode() or (i.product->'price'->>'livemode')::boolean is distinct from product_payment_livemode()$a$);
  d:=replace(d, $a$c.payment_mode='test'$a$, $a$c.payment_mode=(case when product_payment_livemode() then 'live' else 'test' end)$a$);
  d:=replace(d, $a$c.payment_mode<>'test'$a$, $a$c.payment_mode<>(case when product_payment_livemode() then 'live' else 'test' end)$a$);
  d:=replace(d,'Stripe-Testpreis','Stripe-Preis');
  d:=replace(d,'Test-Camp','Camp');
  if name='reserve_product_purchase' then
   d:=replace(d, 'begin'||chr(10), 'begin'||chr(10)||' if not product_shop_enabled() then raise exception ''Shop derzeit nicht verfügbar'';end if;'||chr(10));
   d:=replace(d,' data:=p.published;', ' data:=p.published;'||chr(10)||' if (data->''price''->>''livemode'')::boolean is distinct from product_payment_livemode() then raise exception ''Stripe-Umgebung passt nicht'';end if;');
  end if;
  if d=original then raise exception 'Unexpected product production baseline: %',name;end if;
  execute d;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
