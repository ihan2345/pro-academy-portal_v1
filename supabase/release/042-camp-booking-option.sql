-- This release runs after 041-product-showcase-embed.sql (see schema.mjs).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create function public.camp_booking_option_snapshot(data jsonb, input jsonb) returns jsonb
language plpgsql set search_path=public as $$
declare price jsonb:=nullif(input->'booking_option_price','null'::jsonb); option jsonb:=nullif(data->'booking_option','null'::jsonb);
begin
 if not coalesce((input->>'booking_option_selected')::boolean,false) then
  if price is not null then raise exception 'Optionspreis ohne Auswahl';end if;
  return data;
 end if;
 if data->>'kind' is distinct from 'camp' or option is null or price is null
  or coalesce((option->>'amount')::int,0)<50 or (option->>'amount')::int>10000000
  or coalesce(length(btrim(option->>'title')),0)<2 or coalesce(length(btrim(option->>'alert')),0)<1
  or price->>'amount' is distinct from option->>'amount'
  or price->>'product_id' is distinct from data->'price'->>'product_id'
  or price->>'currency' is distinct from data->'price'->>'currency'
  or price->>'livemode' is distinct from data->'price'->>'livemode'
  or coalesce(price->>'id','') !~ '^price_[A-Za-z0-9_]+$'
  or price->>'source' is distinct from 'stripe' or nullif(price->'interval','null'::jsonb) is not null
 then raise exception 'Buchungsoption oder Optionspreis ungültig';end if;
 return jsonb_set(data,'{price}',price)||jsonb_build_object('booking_option_selected',true,'booking_option_base_price',data->'price');
end $$;
revoke all on function public.camp_booking_option_snapshot(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.camp_booking_option_snapshot(jsonb,jsonb) to service_role;

do $$ declare original text; changed text; begin
 original:=pg_get_functiondef('public.reserve_product_purchase_before_gifts(jsonb)'::regprocedure);
 changed:=replace(original,'data:=camp_product_snapshot(p.published);','data:=camp_booking_option_snapshot(camp_product_snapshot(p.published),input);');
 if changed=original then raise exception 'Unexpected Camp reservation baseline';end if;
 execute changed;
 original:=pg_get_functiondef('public.fulfill_product_purchase_before_guest(jsonb)'::regprocedure);
 changed:=replace(original,$s$offer.stripe_price_id is distinct from i.product->'price'->>'id' or offer.amount<>i.expected_subtotal$s$,
 $s$(case when coalesce((i.product->>'booking_option_selected')::boolean,false) then
   offer.stripe_price_id is distinct from i.product->'booking_option_base_price'->>'id'
   or offer.amount is distinct from (i.product->'booking_option_base_price'->>'amount')::int
   or i.expected_subtotal is distinct from (i.product->'booking_option'->>'amount')::int
   or i.product->'price'->>'product_id' is distinct from offer.stripe_product_id
  else offer.stripe_price_id is distinct from i.product->'price'->>'id' or offer.amount<>i.expected_subtotal end)$s$);
 if changed=original then raise exception 'Unexpected Camp fulfillment baseline';end if;
 execute changed;
end $$;
-- A retry must not silently switch the selected variant, including gift wrappers.
alter function public.reserve_product_purchase(jsonb) rename to reserve_product_purchase_before_booking_options;
revoke all on function public.reserve_product_purchase_before_booking_options(jsonb) from public,anon,authenticated,service_role;
create function public.reserve_product_purchase(input jsonb) returns product_purchase_intents
language plpgsql security definer set search_path=public as $$
declare i product_purchase_intents;
begin
 i:=reserve_product_purchase_before_booking_options(input);
 if coalesce((i.product->>'booking_option_selected')::boolean,false) is distinct from coalesce((input->>'booking_option_selected')::boolean,false)
 then raise exception 'Buchungsoption des offenen Kaufs wurde geändert';end if;
 return i;
end $$;
revoke all on function public.reserve_product_purchase(jsonb) from public,anon,authenticated;
grant execute on function public.reserve_product_purchase(jsonb) to service_role;
commit;
