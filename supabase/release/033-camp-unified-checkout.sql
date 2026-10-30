-- Additive support for one portal booking URL and one Stripe product per new Camp.
begin;
alter table public.camp_offers alter column stripe_payment_link_id drop not null;
alter table public.camp_offers alter column payment_url drop not null;
alter table public.camp_offers add constraint camp_offer_checkout_shape check ((stripe_payment_link_id is null) = (payment_url is null));
alter table public.camp_bookings add column checkout_session_id text unique;
alter table public.camp_bookings drop constraint camp_bookings_booking_origin_check;
alter table public.camp_bookings add constraint camp_bookings_booking_origin_check check(booking_origin in ('checkout','stripe_import','api_checkout','portal_checkout'));
alter table public.camp_bookings drop constraint product_camp_origin_shape;
alter table public.camp_bookings add constraint product_camp_origin_shape check(
 (booking_origin in ('checkout','stripe_import') and stripe_payment_link_id is not null) or
 (booking_origin in ('api_checkout','portal_checkout') and stripe_payment_link_id is null and offer_id is not null));
alter table public.camp_payment_events alter column payment_link_id drop not null;

-- The offer saved on the shop product identifies the Camp, not a permanently fixed price tier.
create function public.camp_product_snapshot(data jsonb) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c camps; o camp_offers;
begin
 if data->>'kind' is distinct from 'camp' then return data; end if;
 select camp.* into c from camps camp join camp_offers anchor on anchor.camp_id=camp.id where anchor.id=(data->>'camp_offer_id')::uuid;
 if not found then raise exception 'Campangebot fehlt'; end if;
 select * into o from camp_offers where camp_id=c.id and kind=case when c.early_bird_until is not null and now()<c.early_bird_until then 'early' else 'main' end;
 if not found then raise exception 'Aktueller Camppreis fehlt'; end if;
 return jsonb_set(jsonb_set(data,'{camp_offer_id}',to_jsonb(o.id::text)),'{price}',coalesce(nullif(data->'price','null'::jsonb),'{}'::jsonb)||jsonb_build_object(
  'id',o.stripe_price_id,'product_id',o.stripe_product_id,'amount',o.amount,'currency',o.currency,'interval',null,'interval_count',1,'livemode',c.payment_mode='live','product_name',c.title));
end $$;
revoke all on function public.camp_product_snapshot(jsonb) from public,anon,authenticated;
grant execute on function public.camp_product_snapshot(jsonb) to service_role;

do $$ declare original text; changed text; begin
 select pg_get_functiondef('public.reserve_product_purchase(jsonb)'::regprocedure) into original;
 changed:=replace(original,'data:=p.published;',E'data:=camp_product_snapshot(p.published);\n if data->>''kind''=''camp'' and input->>''camp_offer_id'' is distinct from data->>''camp_offer_id'' then raise exception ''Camppreis wurde geändert. Bitte erneut buchen.'';end if;');
 if changed=original then raise exception 'Unexpected reservation function'; end if;
 execute changed;
 select pg_get_functiondef('public.camp_confirm_payment(jsonb)'::regprocedure) into original;
 changed:=replace(original,'if b.stripe_session_id is not null then',E'if b.booking_origin=''portal_checkout'' and (b.checkout_session_id is null or b.checkout_session_id is distinct from input->>''session_id'') then raise exception ''Checkout session does not belong to this booking''; end if;\n if b.stripe_session_id is not null then');
 if changed=original then raise exception 'Unexpected Camp confirmation function'; end if;
 execute changed;
end $$;
commit;
