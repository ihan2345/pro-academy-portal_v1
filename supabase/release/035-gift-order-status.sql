-- Local preparation: personal status links, rotating codes and balance notifications.
begin;
alter table gift_orders add column recipient_access_hash text unique, add column recipient_access_cipher text;
alter table gift_cards add column remaining int, add column reserved int not null default 0, add column initial_code_cipher text;
update gift_cards set remaining=amount,initial_code_cipher=code_cipher;
alter table gift_cards alter column remaining set not null;
alter table gift_cards add constraint gift_card_balance check(remaining>=0 and remaining<=amount and reserved>=0 and reserved<=remaining);
create function gift_initial_balance() returns trigger language plpgsql set search_path=public as $$begin new.remaining:=new.amount;new.initial_code_cipher:=new.code_cipher;return new;end$$;
create trigger gift_initial_balance before insert on gift_cards for each row execute function gift_initial_balance();
create table gift_code_uses(
 intent_id uuid primary key references product_purchase_intents(id),gift_id uuid not null references gift_cards(id),
 amount int not null check(amount>0),state text not null default 'held' check(state in('held','spent','released','returned')),
 code_hash text not null,next_hash text not null,next_cipher text not null,refund_hash text not null,refund_cipher text not null,
 before_balance int,after_balance int,refund_before_balance int,refund_after_balance int,spent_at timestamptz,returned_at timestamptz,created_at timestamptz not null default now()
);
create index gift_code_history on gift_code_uses(gift_id,created_at desc);
create table gift_balance_messages(
 intent_id uuid primary key references gift_code_uses(intent_id),order_id uuid not null references gift_orders(id),gift_id uuid not null references gift_cards(id),
 before_balance int not null,used_amount int not null,after_balance int not null check(after_balance>0),code_hash text not null,code_cipher text not null,
 status text not null default 'pending' check(status in('pending','processing','sent','captured','failed','cancelled')),
 purchased_at timestamptz not null default now(),attempts int not null default 0,available_at timestamptz not null default now(),locked_at timestamptz,lease_token uuid,sent_at timestamptz
);
alter table gift_code_uses enable row level security;alter table gift_balance_messages enable row level security;
revoke all on gift_code_uses,gift_balance_messages from public,anon,authenticated;
grant all on gift_code_uses,gift_balance_messages to service_role;
update gift_messages set status='cancelled' where audience in('access_buyer','access_recipient') and status in('pending','processing','failed');
alter table gift_messages drop constraint gift_messages_audience_check;
alter table gift_messages add constraint gift_messages_audience_check check(audience in('buyer','recipient','access_buyer','access_recipient','status_buyer','status_recipient'));

do $$declare d text;changed text;begin
 select pg_get_functiondef('gift_claim_messages(boolean,uuid)'::regprocedure) into d;
 changed:=replace(d,$a$o.status='issued'$a$,$b$(o.status='issued' or m.audience in('status_buyer','status_recipient'))$b$);
 if changed=d then raise exception 'Unexpected gift mail queue';end if;execute changed;
end$$;
create function gift_ensure_recipient_access(input jsonb) returns gift_orders language plpgsql security definer set search_path=public as $$declare o gift_orders;begin
 select * into o from gift_orders where id=(input->>'id')::uuid for update;
 if o.id is null then raise exception 'Geschenk nicht gefunden';end if;
 if o.recipient_access_hash is null then update gift_orders set recipient_access_hash=input->>'hash',recipient_access_cipher=input->>'cipher' where id=o.id returning * into o;end if;
 return o;
end$$;
-- A partially spent code must never be transferred into the former account wallet at face value.
do $$declare d text;begin
 select pg_get_functiondef('gift_claim(jsonb)'::regprocedure) into d;
 d:=replace(d,' insert into gift_wallet_credits',E' if g.remaining<>g.amount or g.reserved>0 then raise exception ''Geschenkcode bitte direkt im Checkout verwenden'';end if;\n insert into gift_wallet_credits');execute d;
end$$;
alter function reserve_product_purchase(jsonb) rename to reserve_product_purchase_before_gift_codes;
revoke all on function reserve_product_purchase_before_gift_codes(jsonb) from public,anon,authenticated,service_role;
create function reserve_product_purchase(input jsonb) returns product_purchase_intents language plpgsql security definer set search_path=public as $$
declare i product_purchase_intents;g gift_cards;u gift_code_uses;used int;due int;
begin
 if nullif(input->>'gift_code_hash','') is null then
  if exists(select 1 from gift_code_uses where intent_id=(input->>'id')::uuid) then raise exception 'Geschenkcode wurde geändert';end if;
  return reserve_product_purchase_before_gift_codes(input);
 end if;
 if coalesce((input->>'use_gift_credit')::boolean,false) then raise exception 'Bitte genau einen Gutschein verwenden';end if;
 perform pg_advisory_xact_lock(hashtext('product-child:'||(input->>'player_id')));
 select * into i from product_purchase_intents where id=(input->>'id')::uuid for update;
 if found then
  select * into u from gift_code_uses where intent_id=i.id;
  if u.intent_id is null or u.code_hash is distinct from input->>'gift_code_hash' or i.parent_id is distinct from (input->>'parent_id')::uuid or i.auth_id is distinct from (input->>'auth_id')::uuid or i.guest_token_hash is distinct from input->>'guest_token_hash' or i.guest_data is distinct from nullif(input->'guest_data','null'::jsonb) or i.player_id is distinct from (input->>'player_id')::uuid or i.product_id is distinct from (input->>'product_id')::uuid or i.gift_original_discount is distinct from nullif(input->'discount','null'::jsonb) or i.expected_amount+i.gift_credit_amount is distinct from (input->>'amount')::int then raise exception 'Anfragereferenz gehört zu einem anderen Gutscheinkauf';end if;
  return i;
 end if;
 i:=reserve_product_purchase_before_gift_codes(input);
 if i.product->>'kind'='gift' then raise exception 'Geschenkkarten können nicht mit Geschenkguthaben gekauft werden';end if;
 select * into g from gift_cards where code_hash=input->>'gift_code_hash' and livemode=product_payment_livemode() for update;
 if g.id is null or g.status<>'issued' or g.remaining<=0 or g.expires_at<=now() or g.currency<>i.currency then raise exception 'Geschenkcode ist nicht verfügbar, bereits ersetzt oder abgelaufen';end if;
 if g.reserved>0 then raise exception 'Geschenkcode ist für einen offenen Kauf reserviert';end if;
 if nullif(input->>'gift_next_hash','') is null or nullif(input->>'gift_next_cipher','') is null or nullif(input->>'gift_refund_hash','') is null or nullif(input->>'gift_refund_cipher','') is null then raise exception 'Folgecode fehlt';end if;
 used:=least(g.remaining,i.expected_amount);due:=i.expected_amount-used;
 if due between 1 and 49 then used:=greatest(0,i.expected_amount-50);due:=i.expected_amount-used;end if;
 if used<=0 then raise exception 'Für diesen Kauf ist keine Gutscheinanrechnung möglich';end if;
 insert into gift_code_uses(intent_id,gift_id,amount,code_hash,next_hash,next_cipher,refund_hash,refund_cipher)values(i.id,g.id,used,g.code_hash,input->>'gift_next_hash',input->>'gift_next_cipher',input->>'gift_refund_hash',input->>'gift_refund_cipher');
 update gift_cards set reserved=reserved+used where id=g.id;
 update product_purchase_intents set gift_original_discount=discount,gift_credit_amount=used,expected_amount=due,
 discount=coalesce(discount,'{}'::jsonb)||jsonb_build_object('amount',due,'source','gift','gift_code_hash',g.code_hash,'duration','once','duration_in_months',null) where id=i.id returning * into i;
 return i;
end$$;
create function gift_complete_code_use() returns trigger language plpgsql security definer set search_path=public as $$
declare u gift_code_uses;g gift_cards;leftover int;
begin
 if old.status=new.status then return new;end if;
 select * into u from gift_code_uses where intent_id=new.id for update;
 if not found then return new;end if;
 select * into g from gift_cards where id=u.gift_id for update;
 if new.status='fulfilled' and u.state='held' then
  if g.status<>'issued' then raise exception 'Geschenkguthaben benötigt Prüfung';end if;
  leftover:=g.remaining-u.amount;
  update gift_cards set remaining=leftover,reserved=reserved-u.amount,code_hash=case when leftover>0 then u.next_hash else code_hash end,code_cipher=case when leftover>0 then u.next_cipher else code_cipher end where id=g.id;
  update gift_code_uses set state='spent',before_balance=g.remaining,after_balance=leftover,spent_at=now() where intent_id=u.intent_id;
  update gift_balance_messages set status='cancelled' where gift_id=g.id and status in('pending','failed');
  if leftover>0 then insert into gift_balance_messages(intent_id,order_id,gift_id,before_balance,used_amount,after_balance,code_hash,code_cipher) values(u.intent_id,g.order_id,g.id,g.remaining,u.amount,leftover,u.next_hash,u.next_cipher) on conflict do nothing;end if;
 elsif new.status in('expired','refunded') and u.state='held' then
  update gift_cards set reserved=reserved-u.amount where id=g.id;
  update gift_code_uses set state='released' where intent_id=u.intent_id;
 elsif new.status='refunded' and u.state='spent' then
  update gift_cards set remaining=remaining+u.amount,code_hash=u.refund_hash,code_cipher=u.refund_cipher where id=g.id;
  update gift_code_uses set state='returned',returned_at=now(),refund_before_balance=g.remaining,refund_after_balance=g.remaining+u.amount where intent_id=u.intent_id;
  update gift_balance_messages set status='cancelled' where gift_id=g.id and status in('pending','failed');
 end if;
 return new;
end$$;
create trigger gift_status_code_use after update of status on product_purchase_intents for each row execute function gift_complete_code_use();
create function gift_claim_balance_messages(mode boolean,owner uuid) returns setof gift_balance_messages language sql security definer set search_path=public as $$
 update gift_balance_messages set status='processing',attempts=attempts+1,locked_at=now(),lease_token=owner
 where intent_id in(select m.intent_id from gift_balance_messages m join gift_orders o on o.id=m.order_id where o.livemode=mode and o.status='issued' and ((m.status in('pending','failed') and m.available_at<=now() and m.attempts<8)or(m.status='processing' and m.locked_at<now()-interval '10 minutes')) order by m.available_at for update of m skip locked limit 10) returning *
$$;
revoke all on function gift_ensure_recipient_access(jsonb),reserve_product_purchase(jsonb),gift_complete_code_use(),gift_initial_balance(),gift_claim_balance_messages(boolean,uuid) from public,anon,authenticated;
grant execute on function gift_ensure_recipient_access(jsonb),reserve_product_purchase(jsonb),gift_claim_balance_messages(boolean,uuid) to service_role;
commit;
