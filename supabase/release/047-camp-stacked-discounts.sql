begin;
set local lock_timeout='5s';set local statement_timeout='60s';
-- Abo entitlement changes the quoted Camp price; a normal Stripe promotion may
-- then apply to that price, followed by the existing gift-credit settlement.
create function public.camp_member_price_snapshot(data jsonb,input jsonb) returns jsonb
language plpgsql set search_path=public as $$
declare price jsonb:=nullif(input->'camp_member_price','null'::jsonb); percent integer:=coalesce((input->>'benefit_percent')::int,0); amount integer;
begin
 if price is null then return data;end if;
 amount:=(data->'price'->>'amount')::int-round((data->'price'->>'amount')::numeric*percent/100)::int;
 if data->>'kind' is distinct from 'camp' or not coalesce((data->>'member_benefits_enabled')::boolean,false)
 or percent not in (10,15,20) or amount<=0 or (price->>'amount')::int is distinct from amount
 or price->>'product_id' is distinct from data->'price'->>'product_id' or price->>'currency' is distinct from data->'price'->>'currency'
 or price->>'livemode' is distinct from data->'price'->>'livemode' or price->>'source' is distinct from 'stripe'
 or coalesce(price->>'id','') !~ '^price_[A-Za-z0-9_]+$' or nullif(price->'interval','null'::jsonb) is not null
 then raise exception 'Camp-Mitgliedspreis ungültig';end if;
 return jsonb_set(data,'{price}',price)||jsonb_build_object('camp_member_base_price',data->'price','camp_member_percent',percent);
end $$;
create function public.camp_quote_matches_offer(data jsonb,subtotal integer,offer public.camp_offers) returns boolean
language plpgsql set search_path=public as $$
declare base jsonb:=coalesce(data->'camp_member_base_price',data->'price');percent int:=coalesce((data->>'camp_member_percent')::int,0);
begin
 if data ? 'camp_member_base_price' then
  if percent not in (10,15,20) or (data->'price'->>'amount')::int is distinct from (base->>'amount')::int-round((base->>'amount')::numeric*percent/100)::int
   or subtotal is distinct from (data->'price'->>'amount')::int or data->'price'->>'product_id' is distinct from offer.stripe_product_id then return false;end if;
 end if;
 if coalesce((data->>'booking_option_selected')::boolean,false) then
  return offer.stripe_price_id is not distinct from data->'booking_option_base_price'->>'id'
   and offer.amount is not distinct from (data->'booking_option_base_price'->>'amount')::int
   and (base->>'amount')::int is not distinct from (data->'booking_option'->>'amount')::int
   and subtotal is not distinct from (data->'price'->>'amount')::int
   and base->>'product_id' is not distinct from offer.stripe_product_id;
 end if;
 return offer.stripe_price_id is not distinct from base->>'id' and offer.amount is not distinct from (base->>'amount')::int
 and subtotal is not distinct from (data->'price'->>'amount')::int;
end $$;
revoke all on function public.camp_member_price_snapshot(jsonb,jsonb),public.camp_quote_matches_offer(jsonb,integer,public.camp_offers) from public,anon,authenticated;
-- Only the reservation service may supply a server-verified Stripe price.
grant execute on function public.camp_member_price_snapshot(jsonb,jsonb) to service_role;
do $$ declare original text;changed text;begin
 original:=pg_get_functiondef('public.reserve_product_purchase_before_gifts(jsonb)'::regprocedure);
 changed:=replace(original,'data:=camp_booking_option_snapshot(camp_product_snapshot(p.published),input);','data:=camp_member_price_snapshot(camp_booking_option_snapshot(camp_product_snapshot(p.published),input),input);');
 if changed=original then raise exception 'Unexpected Camp member reservation baseline';end if;execute changed;
 original:=pg_get_functiondef('public.fulfill_product_purchase_before_guest(jsonb)'::regprocedure);
 changed:=replace(original,$s$(case when coalesce((i.product->>'booking_option_selected')::boolean,false) then
   offer.stripe_price_id is distinct from i.product->'booking_option_base_price'->>'id'
   or offer.amount is distinct from (i.product->'booking_option_base_price'->>'amount')::int
   or i.expected_subtotal is distinct from (i.product->'booking_option'->>'amount')::int
   or i.product->'price'->>'product_id' is distinct from offer.stripe_product_id
  else offer.stripe_price_id is distinct from i.product->'price'->>'id' or offer.amount<>i.expected_subtotal end)$s$,
 'not camp_quote_matches_offer(i.product,i.expected_subtotal,offer)');
 if changed=original then raise exception 'Unexpected Camp member fulfillment baseline';end if;execute changed;
end $$;
notify pgrst,'reload schema';commit;
