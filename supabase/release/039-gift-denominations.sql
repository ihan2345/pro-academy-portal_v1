begin;
-- A catalogue product now owns several values. Stripe's (mode, currency, amount) key
-- remains the unique financial mapping, including values shared with older entries.
drop index gift_catalog_amount_unique;
create function gift_product_amounts(data jsonb) returns integer[] language plpgsql stable security definer set search_path=public as $$
declare source jsonb:=coalesce(data->'gift_amounts','[]'::jsonb); amounts integer[]; settings gift_settings;
begin
 if jsonb_typeof(source)<>'array' then raise exception 'Geschenkbeträge müssen eine Liste sein';end if;
 if jsonb_array_length(source)=0 and nullif(data->>'gift_amount','') is not null then source:=jsonb_build_array((data->>'gift_amount')::numeric);end if;
 if jsonb_array_length(source)=0 then raise exception 'Bitte mindestens einen Geschenkbetrag hinzufügen';end if;
 if exists(select 1 from jsonb_array_elements(source) a where jsonb_typeof(a)<>'number') then raise exception 'Ungültiger Geschenkbetrag';end if;
 select * into settings from gift_settings where id;
 if exists(select 1 from jsonb_array_elements_text(source) a where a::numeric<>trunc(a::numeric) or a::numeric<settings.min_amount or a::numeric>settings.max_amount) then raise exception 'Geschenkbetrag außerhalb des erlaubten Bereichs';end if;
 select array_agg(a::integer order by a::integer) into amounts from jsonb_array_elements_text(source) a;
 if cardinality(amounts)<>(select count(distinct a) from unnest(amounts) a) then raise exception 'Geschenkbeträge dürfen nicht doppelt sein';end if;
 return amounts;
end $$;
revoke all on function gift_product_amounts(jsonb) from public,anon,authenticated;
grant execute on function gift_product_amounts(jsonb) to service_role;
alter function save_catalog_product(jsonb) rename to save_catalog_product_before_gift_denominations;
revoke all on function save_catalog_product_before_gift_denominations(jsonb) from public,anon,authenticated,service_role;
create function save_catalog_product(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare data jsonb:=input->'data'; amounts integer[];
begin
 if data->>'kind'='gift' then
  amounts:=gift_product_amounts(data);
  data:=data||jsonb_build_object('gift_amounts',to_jsonb(amounts),'gift_amount',amounts[1]);
  input:=jsonb_set(input,'{data}',data);
 end if;
 return save_catalog_product_before_gift_denominations(input);
end $$;
revoke all on function save_catalog_product(jsonb) from public,anon;
grant execute on function save_catalog_product(jsonb) to authenticated;
create or replace function gift_publish_snapshot(data jsonb) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v gift_stripe_values; first_value gift_stripe_values; amounts integer[]; denomination integer;
begin
 if data->>'kind'<>'gift' then return data;end if;
 amounts:=gift_product_amounts(data);
 data:=data||jsonb_build_object('gift_amounts',to_jsonb(amounts),'gift_amount',amounts[1]);
 if data->>'status' in('draft','archived') then return data;end if;
 foreach denomination in array amounts loop
  select * into v from gift_stripe_values g where g.livemode=product_payment_livemode() and g.currency='eur' and g.amount=denomination;
  if not found or v.price_id is null then raise exception 'Geschenkpreis für % Cent ist noch nicht vorbereitet',denomination;end if;
  if denomination=amounts[1] then first_value:=v;end if;
 end loop;
 return jsonb_set(data,'{price}',jsonb_build_object('id',first_value.price_id,'product_id',first_value.product_id,'amount',first_value.amount,'currency',first_value.currency,'interval',null,'interval_count',1,'livemode',first_value.livemode,'checked_at',now(),'product_name','ProAcademy Geschenkkarte','source','stripe'));
end $$;
commit;
