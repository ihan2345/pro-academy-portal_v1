begin;
set local lock_timeout='5s';set local statement_timeout='60s';
-- A Camp needs the same purchase/gift ledger even when no shop card was published.
-- These private backing records are omitted from catalogue listings.
alter table public.catalog_products add column camp_checkout_for uuid unique references public.camps(id);
-- Preserve price uniqueness for published shop cards; a private backing record
-- is not a second offer and may share that same canonical Camp price.
drop index public.catalog_one_active_price;
create unique index catalog_one_active_price on catalog_products((published->'price'->>'id')) where camp_checkout_for is null and status in ('active','exclusive','internal');
create function public.camp_ensure_checkout_product(camp uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare c camps;o camp_offers;pid uuid;data jsonb;
begin
 if not product_shop_enabled() then raise exception 'Campbuchung derzeit nicht verfügbar';end if;
 select * into c from camps where id=camp for update;
 if c.id is null or c.status<>'open' or (c.payment_mode='live') is distinct from product_payment_livemode()
 or exists(select 1 from jsonb_array_elements(c.days) d where (d->>'starts_at')::timestamptz<=now())
 then raise exception 'Camp ist nicht buchbar';end if;
 select id into pid from catalog_products where camp_checkout_for=camp;
 if pid is not null then return pid;end if;
 select * into o from camp_offers where camp_id=camp and kind='main';
 if o.id is null then raise exception 'Campangebot fehlt';end if;
 data:=$template${"name":"Neues Produkt","internal_name":"","description":"","short_description":"","category":"","kind":"subscription","status":"draft","sort_order":0,"priority":0,"effect_color":"#8B53FE","sale_enabled":false,"sale_audiences":[],"featured":false,"popular":false,"publish_at":null,"expires_at":null,"channels":[],"price":null,"plan_id":null,"camp_offer_id":null,"gift_amount":null,"gift_amounts":[],"repeatable":false,"training_content":{"football_hours":null,"athletics_hours":null,"camp_hours":null},"rules":{"visibility":{"mode":"all","clauses":[{"scope":"player","mode":"any","include":["all"],"exclude":[]}]},"purchase":{"mode":"all","clauses":[{"scope":"player","mode":"any","include":["all"],"exclude":[]}]},"usage":{"mode":"all","clauses":[{"scope":"player","mode":"any","include":["all"],"exclude":[]}]}},"asset_ids":[]}$template$::jsonb ||jsonb_build_object(
  'name',c.title,'internal_name','Camp-Buchungsformular','kind','camp','status','active','description',c.description,
  'channels',jsonb_build_array('catalog'),'camp_offer_id',o.id,
  'price',jsonb_build_object('id',o.stripe_price_id,'product_id',o.stripe_product_id,'amount',o.amount,'currency',o.currency,
   'interval',null,'interval_count',1,'livemode',c.payment_mode='live','checked_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'product_name',c.title,'source','stripe'));
 insert into catalog_products(name,internal_name,kind,status,draft,published,published_revision,camp_checkout_for)
 values(c.title,'Camp-Buchungsformular','camp','active',data,data,1,camp) returning id into pid;
 insert into catalog_product_versions(product_id,revision,payload) values(pid,1,data);
 return pid;
end $$;
revoke all on function public.camp_ensure_checkout_product(uuid) from public,anon,authenticated;
grant execute on function public.camp_ensure_checkout_product(uuid) to service_role;
notify pgrst,'reload schema';commit;
