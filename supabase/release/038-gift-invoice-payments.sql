begin;
alter table gift_orders add column billing_model text not null default 'single_purpose_de_19' check(billing_model='single_purpose_de_19'),add column invoice_id text unique,add column invoice_url text,add column credit_note_id text unique;
alter table product_purchase_intents add column gift_code_hash text;
update product_purchase_intents set gift_code_hash=discount->>'gift_code_hash' where gift_credit_amount>0;
create table gift_billings(
 intent_id uuid primary key references product_purchase_intents(id),livemode boolean not null,
 started_at timestamptz not null default now(),invoice_id text unique,subscription_id text unique,payment_record_id text unique,cash_payment_id text unique,
 state text not null default 'preparing' check(state in('preparing','settled','returned'))
);
alter table gift_billings enable row level security;
revoke all on gift_billings from public,anon,authenticated;grant all on gift_billings to service_role;
alter function reserve_product_purchase(jsonb) rename to reserve_product_purchase_before_invoice_gifts;
revoke all on function reserve_product_purchase_before_invoice_gifts(jsonb) from public,anon,authenticated,service_role;
create function reserve_product_purchase(input jsonb) returns product_purchase_intents language plpgsql security definer set search_path=public as $$
declare i product_purchase_intents;begin
 i:=reserve_product_purchase_before_invoice_gifts(input);
 if i.gift_credit_amount>0 then
  update product_purchase_intents set gift_code_hash=coalesce(gift_code_hash,discount->>'gift_code_hash'),discount=gift_original_discount where id=i.id returning * into i;
 end if;return i;
end$$;
create function gift_start_billing(input jsonb) returns gift_billings language plpgsql security definer set search_path=public as $$
declare i product_purchase_intents;b gift_billings;begin
 select * into i from product_purchase_intents where id=(input->>'id')::uuid for update;
 if i.id is null or i.gift_credit_amount<=0 or i.status not in('checkout','paid','review','fulfilled') or i.session_id is null then raise exception 'Gutscheinzahlung ist nicht bestätigt';end if;
 insert into gift_billings(intent_id,livemode)values(i.id,product_payment_livemode())on conflict do nothing;
 select * into b from gift_billings where intent_id=i.id;
 if b.livemode is distinct from product_payment_livemode() then raise exception 'Zahlungsumgebung passt nicht';end if;return b;
end$$;
alter function fulfill_product_purchase(jsonb) rename to fulfill_product_purchase_before_invoice_gifts;
revoke all on function fulfill_product_purchase_before_invoice_gifts(jsonb) from public,anon,authenticated,service_role;
create function fulfill_product_purchase(input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare i product_purchase_intents;b gift_billings;begin
 select * into i from product_purchase_intents where id=(input->>'id')::uuid;
 if i.gift_credit_amount>0 then
  select * into b from gift_billings where intent_id=i.id;
  if b.intent_id is null or b.state<>'settled' or b.livemode is distinct from product_payment_livemode()
   or b.invoice_id is distinct from input->'proof'->>'gift_invoice_id' or b.payment_record_id is distinct from input->'proof'->>'gift_payment_record_id'
   or (input->'proof'->>'gift_credit_amount')::int is distinct from i.gift_credit_amount
   or (input->'proof'->>'gift_invoice_total')::int is distinct from i.expected_amount+i.gift_credit_amount then raise exception 'Bestätigte Guthabenzahlung auf der Rechnung fehlt';end if;
 end if;
 return fulfill_product_purchase_before_invoice_gifts(input);
end$$;
revoke all on function reserve_product_purchase(jsonb),fulfill_product_purchase(jsonb),gift_start_billing(jsonb) from public,anon,authenticated;
grant execute on function reserve_product_purchase(jsonb),fulfill_product_purchase(jsonb),gift_start_billing(jsonb) to service_role;
-- Filled by verified refund processing before returning value; no browser can call these routines.
alter table gift_billings add column return_started_at timestamptz,add column credit_note_id text unique,add column return_actor uuid references profiles(id),add column return_reason text;
create function gift_start_return(input jsonb) returns gift_billings language plpgsql security definer set search_path=public as $$declare b gift_billings;begin
 select * into b from gift_billings where intent_id=(input->>'id')::uuid for update;
 if b.state not in('settled','returned') then raise exception 'Bestätigte Guthabenzahlung fehlt';end if;
 update gift_billings set return_started_at=coalesce(return_started_at,now()) where intent_id=b.intent_id returning * into b;return b;
end$$;
create function gift_complete_return(input jsonb) returns void language plpgsql security definer set search_path=public as $$declare b gift_billings;i product_purchase_intents;begin
 select * into b from gift_billings where intent_id=(input->>'id')::uuid for update;
 if b.state='returned' then return;end if;
 if b.state<>'settled' or b.livemode is distinct from product_payment_livemode() or b.payment_record_id is distinct from input->>'record_id' or b.credit_note_id is distinct from input->>'credit_note_id' or b.credit_note_id is null then raise exception 'Erstattungsnachweis passt nicht';end if;
 select * into i from product_purchase_intents where id=b.intent_id for update;
 if (input->>'amount')::int is distinct from i.gift_credit_amount then raise exception 'Erstattungsbetrag passt nicht';end if;
 update product_purchase_intents set status='refunded',reason='Guthaben und Zuzahlung vollständig erstattet; Vertrag ggf. separat prüfen',updated_at=now() where id=i.id;
 update gift_billings set state='returned',return_actor=(input->>'actor_id')::uuid,return_reason=input->>'reason' where intent_id=i.id;
 if i.subscription_id is not null then update subscriptions set needs_review=true where stripe_subscription_id=i.subscription_id;end if;
 update product_purchases set status='refunded' where intent_id=i.id;
 if i.camp_booking_id is not null then update camp_bookings set status='refunded',review_reason='Guthabenzahlung vollständig erstattet' where id=i.camp_booking_id;end if;
end$$;
revoke all on function gift_start_return(jsonb),gift_complete_return(jsonb) from public,anon,authenticated;
grant execute on function gift_start_return(jsonb),gift_complete_return(jsonb) to service_role;
commit;
