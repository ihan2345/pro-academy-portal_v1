begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.camps add column booking_option jsonb;
alter table public.camps add column booking_option_version integer not null default 0;
alter table public.camps add constraint camp_booking_option_shape check(booking_option is null or (
 jsonb_typeof(booking_option)='object' and coalesce(booking_option->>'amount','')~'^[0-9]+$'
 and (booking_option->>'amount')::numeric between 50 and 10000000
 and coalesce(length(btrim(booking_option->>'title')),0) between 2 and 160
 and coalesce(length(booking_option->>'description'),0)<=3000
 and coalesce(length(btrim(booking_option->>'alert')),0) between 1 and 3000));
create function public.camp_booking_option_version() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='INSERT' then new.booking_option_version:=case when new.booking_option is null then 0 else 1 end;
 elsif new.booking_option is distinct from old.booking_option then new.booking_option_version:=old.booking_option_version+1;
 else new.booking_option_version:=old.booking_option_version;end if;
 return new;
end $$;
revoke all on function public.camp_booking_option_version() from public,anon,authenticated;
create trigger camp_booking_option_version before insert or update on public.camps for each row execute function public.camp_booking_option_version();
-- Preserve any option saved through the briefly available product editor.
-- Different choices for one Camp require reconciliation instead of silent data loss.
do $$ begin
 if exists(select o.camp_id from catalog_products p join camp_offers o on o.id=coalesce(p.published->>'camp_offer_id',p.draft->>'camp_offer_id')::uuid
  cross join lateral (values(nullif(p.published->'booking_option','null'::jsonb)),(nullif(p.draft->'booking_option','null'::jsonb))) v(option)
  where v.option is not null group by o.camp_id having count(distinct v.option)>1)
 then raise exception 'Conflicting product booking options must be reconciled before migration';end if;
end $$;
update camps c set booking_option=x.option from (
 select distinct o.camp_id,coalesce(nullif(p.published->'booking_option','null'::jsonb),nullif(p.draft->'booking_option','null'::jsonb)) option
 from catalog_products p join camp_offers o on o.id=coalesce(p.published->>'camp_offer_id',p.draft->>'camp_offer_id')::uuid
 where coalesce(nullif(p.published->'booking_option','null'::jsonb),nullif(p.draft->'booking_option','null'::jsonb)) is not null
) x where c.id=x.camp_id;
update catalog_products set draft=draft-'booking_option'-'booking_option_version',published=published-'booking_option'-'booking_option_version'
 where draft?'booking_option' or published?'booking_option' or draft?'booking_option_version' or published?'booking_option_version';
-- Historical versions and purchase snapshots remain immutable.
create or replace function public.camp_product_snapshot(data jsonb) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c camps; o camp_offers;
begin
 if data->>'kind' is distinct from 'camp' then return data;end if;
 select camp.* into c from camps camp join camp_offers anchor on anchor.camp_id=camp.id where anchor.id=(data->>'camp_offer_id')::uuid;
 if not found then raise exception 'Campangebot fehlt';end if;
 select * into o from camp_offers where camp_id=c.id and kind=case when c.early_bird_until is not null and now()<c.early_bird_until then 'early' else 'main' end;
 if not found then raise exception 'Aktueller Camppreis fehlt';end if;
 return jsonb_set(jsonb_set(data,'{camp_offer_id}',to_jsonb(o.id::text)),'{price}',coalesce(nullif(data->'price','null'::jsonb),'{}'::jsonb)||jsonb_build_object(
 'id',o.stripe_price_id,'product_id',o.stripe_product_id,'amount',o.amount,'currency',o.currency,'interval',null,'interval_count',1,'livemode',c.payment_mode='live','product_name',c.title))
 ||jsonb_build_object('booking_option',c.booking_option,'booking_option_version',c.booking_option_version);
end $$;
revoke all on function public.camp_product_snapshot(jsonb) from public,anon,authenticated;
grant execute on function public.camp_product_snapshot(jsonb) to service_role;
do $$ declare d text; changed text;begin
 d:=pg_get_functiondef('public.camp_booking_option_snapshot(jsonb,jsonb)'::regprocedure);
 changed:=replace(d,$s$if data->>'kind' is distinct from 'camp' or option is null or price is null$s$,
 $s$if data->>'kind' is distinct from 'camp' or option is null or price is null or input->>'booking_option_version' is distinct from data->>'booking_option_version'$s$);
 if changed=d then raise exception 'Unexpected option snapshot baseline';end if;execute changed;
 d:=pg_get_functiondef('public.save_catalog_product(jsonb)'::regprocedure);
 changed:=replace(d,$s$return save_catalog_product_before_gift_denominations(input);$s$,$s$if nullif(data->'booking_option','null'::jsonb) is not null then raise exception 'Buchungsoption zentral beim Camp bearbeiten';end if;
 return save_catalog_product_before_gift_denominations(input);$s$);
 if changed=d then raise exception 'Unexpected product save baseline';end if;execute changed;
end $$;
alter table public.camp_bookings add column booking_option_snapshot jsonb;
create function public.check_camp_booking_option() returns trigger language plpgsql set search_path=public as $$
declare c camps;begin
 if new.booking_option_snapshot is null then return new;end if;
 select * into c from camps where id=new.camp_id for update;
 if new.booking_origin is distinct from 'portal_checkout' or c.booking_option is null
 or new.booking_option_snapshot->'option' is distinct from c.booking_option
 or new.booking_option_snapshot->>'version' is distinct from c.booking_option_version::text
 or new.expected_amount is distinct from (c.booking_option->>'amount')::int
 or new.stripe_payment_link_id is not null
 then raise exception 'Camp-Buchungsoption wurde geändert. Bitte erneut prüfen.';end if;
 return new;
end $$;
revoke all on function public.check_camp_booking_option() from public,anon,authenticated;
create trigger check_camp_booking_option before insert on public.camp_bookings for each row execute function public.check_camp_booking_option();
notify pgrst, 'reload schema';
commit;
