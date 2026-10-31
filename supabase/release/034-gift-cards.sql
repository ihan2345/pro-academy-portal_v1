-- Preparation only: applied locally, never enabled or migrated by deployment automatically.
begin;
alter table catalog_products drop constraint catalog_products_kind_check;
alter table catalog_products add constraint catalog_products_kind_check check(kind in ('subscription','camp','other','gift'));
alter table catalog_products add column gift_amount int generated always as (case when kind='gift' then (draft->>'gift_amount')::int end) stored;
create unique index gift_catalog_amount_unique on catalog_products(gift_amount) where kind='gift';
create table gift_settings (
 id boolean primary key default true check(id), validity_months int not null default 12 check(validity_months between 1 and 120),
 min_amount int not null default 100 check(min_amount>=50), max_amount int not null default 100000 check(max_amount>=min_amount), allow_custom boolean not null default true
);
insert into gift_settings default values;
create table gift_stripe_values (
 livemode boolean not null, currency text not null check(currency='eur'), amount int not null check(amount>0),
 product_id text not null unique, price_id text unique, primary key(livemode,currency,amount), created_at timestamptz not null default now()
);
create table gift_orders (
 id uuid primary key, product_id uuid references catalog_products(id), auth_id uuid references profiles(id), parent_id uuid references parents(id),
 buyer jsonb not null, recipient jsonb not null, amount int not null check(amount>0), currency text not null default 'eur' check(currency='eur'), livemode boolean not null,
 access_hash text not null, access_cipher text not null, appearance jsonb not null default '{}',
 status text not null default 'reserved' check(status in('reserved','checkout','issued','expired','review','refunded')),
 stripe_product_id text not null, stripe_price_id text not null, session_id text unique, checkout_url text, payment_id text unique, paid_at timestamptz,
 checkout_expires_at timestamptz not null default now()+interval '31 minutes',
 created_at timestamptz not null default now()
);
create table gift_cards (
 id uuid primary key default gen_random_uuid(), order_id uuid not null unique references gift_orders(id), code_hash text not null unique, code_cipher text not null,
 amount int not null check(amount>0), currency text not null, livemode boolean not null, issued_at timestamptz not null, expires_at timestamptz not null,
 status text not null default 'issued' check(status in('issued','claimed','refunded','review')), claimed_by uuid references parents(id), claimed_at timestamptz,
 check((claimed_by is null)=(claimed_at is null))
);
create table gift_wallet_credits (
 gift_id uuid primary key references gift_cards(id), parent_id uuid not null references parents(id), amount int not null check(amount>0),
 remaining int not null check(remaining>=0), reserved int not null default 0 check(reserved>=0 and reserved<=remaining),
 currency text not null, livemode boolean not null, expires_at timestamptz not null, frozen boolean not null default false
);
create index gift_wallet_owner on gift_wallet_credits(parent_id,livemode,expires_at);
create table gift_allocations (
 intent_id uuid not null references product_purchase_intents(id), gift_id uuid not null references gift_wallet_credits(gift_id), amount int not null check(amount>0),
 state text not null default 'held' check(state in('held','spent','released','returned')), primary key(intent_id,gift_id)
);
create table gift_ledger (
 id uuid primary key default gen_random_uuid(), gift_id uuid not null references gift_cards(id), intent_id uuid references product_purchase_intents(id),
 action text not null check(action in('claim','hold','spend','release','return','freeze')), amount int not null,
 created_at timestamptz not null default now(), unique(gift_id,intent_id,action)
);
create table gift_messages (
 order_id uuid not null references gift_orders(id), audience text not null check(audience in('buyer','recipient','access_buyer','access_recipient')),
 status text not null default 'pending' check(status in('pending','processing','sent','captured','failed','cancelled')),
 attempts int not null default 0, available_at timestamptz not null default now(), locked_at timestamptz, lease_token uuid, sent_at timestamptz,
 primary key(order_id,audience)
);
alter table product_purchase_intents add column gift_credit_amount int not null default 0 check(gift_credit_amount>=0), add column gift_original_discount jsonb, add column gift_credit_prepared boolean not null default false;

do $$ declare t text; begin
 foreach t in array array['gift_settings','gift_stripe_values','gift_orders','gift_cards','gift_wallet_credits','gift_allocations','gift_ledger','gift_messages'] loop
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from public,anon,authenticated',t);
 execute format('grant all on %I to service_role',t);
 end loop;
end $$;

create function gift_publish_snapshot(data jsonb) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v gift_stripe_values;
begin
 if data->>'kind'<>'gift' then return data;end if;
 select * into v from gift_stripe_values where livemode=product_payment_livemode() and currency='eur' and amount=(data->>'gift_amount')::int;
 if not found or v.price_id is null then raise exception 'Geschenkpreis ist noch nicht vorbereitet';end if;
 return jsonb_set(data,'{price}',jsonb_build_object('id',v.price_id,'product_id',v.product_id,'amount',v.amount,'currency',v.currency,'interval',null,'interval_count',1,'livemode',v.livemode,'checked_at',now(),'product_name','ProAcademy Geschenkkarte','source','stripe'));
end $$;
do $$ declare d text; changed text; begin
 select pg_get_functiondef('publish_catalog_product(jsonb)'::regprocedure) into d;
 changed:=replace(d,'data:=p.draft;','data:=gift_publish_snapshot(p.draft);');
 if changed=d then raise exception 'Unexpected product publisher';end if;execute changed;
end $$;

do $$ declare d text; changed text; begin
 select pg_get_functiondef('save_catalog_product(jsonb)'::regprocedure) into d;
 changed:=replace(d, $old$('subscription','camp','other')$old$, $new$('subscription','camp','other','gift')$new$);
 if changed=d then raise exception 'Unexpected product writer';end if; execute changed;
end $$;
create function gift_freeze_order(input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare g gift_cards;
begin
 perform 1 from gift_orders where id=(input->>'id')::uuid for update;
 if input->>'status' not in('review','refunded') then raise exception 'Invalid gift status';end if;
 update gift_orders set status=input->>'status',payment_id=coalesce(input->>'payment_id',payment_id) where id=(input->>'id')::uuid;
 update gift_cards set status=input->>'status' where order_id=(input->>'id')::uuid returning * into g;
 if found then
  update gift_wallet_credits set frozen=true where gift_id=g.id;
  insert into gift_ledger(gift_id,action,amount)values(g.id,'freeze',0);
 end if;
 update gift_messages set status='cancelled' where order_id=(input->>'id')::uuid and status in('pending','failed');
end $$;
revoke all on function gift_freeze_order(jsonb) from public,anon,authenticated;
grant execute on function gift_freeze_order(jsonb) to service_role;

create function gift_issue_paid_order(input jsonb) returns gift_cards language plpgsql security definer set search_path=public as $$
declare o gift_orders; g gift_cards; months int;
begin
 select * into o from gift_orders where id=(input->>'id')::uuid for update;
 if not found or o.session_id is distinct from input->>'session_id' or o.amount is distinct from (input->>'amount')::int or o.livemode is distinct from (input->>'livemode')::boolean or o.currency is distinct from input->>'currency' then raise exception 'Geschenkzahlung passt nicht';end if;
 select * into g from gift_cards where order_id=o.id;
 if found then return g;end if;
 if o.status<>'checkout' or nullif(input->>'payment_id','') is null or nullif(input->>'paid_at','') is null then raise exception 'Geschenkzahlung fehlt';end if;
 select validity_months into months from gift_settings where id;
 insert into gift_cards(order_id,code_hash,code_cipher,amount,currency,livemode,issued_at,expires_at)
 values(o.id,input->>'code_hash',input->>'code_cipher',o.amount,o.currency,o.livemode,(input->>'paid_at')::timestamptz,(input->>'paid_at')::timestamptz+make_interval(months=>months)) returning * into g;
 update gift_orders set status='issued',payment_id=input->>'payment_id',paid_at=g.issued_at where id=o.id;
 insert into gift_messages(order_id,audience) values(o.id,'buyer'),(o.id,'recipient');
 return g;
end $$;
create function gift_claim(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare g gift_cards; pid uuid:=(input->>'parent_id')::uuid;
begin
 if not exists(select 1 from parents where id=pid and auth_user_id=(input->>'auth_id')::uuid and archived_at is null) then raise exception 'Elternkonto passt nicht';end if;
 select * into g from gift_cards where code_hash=input->>'code_hash' and livemode=(input->>'livemode')::boolean for update;
 if not found then raise exception 'Geschenkcode nicht gefunden';end if;
 if g.status='claimed' and g.claimed_by=pid then return g.id;end if;
 if g.status<>'issued' then raise exception 'Geschenkcode wurde bereits eingelöst oder gesperrt';end if;
 if g.expires_at<=now() then raise exception 'Einlösefrist abgelaufen. Bitte kontaktiere die Academy; der Wert bleibt dokumentiert.';end if;
 insert into gift_wallet_credits(gift_id,parent_id,amount,remaining,currency,livemode,expires_at)values(g.id,pid,g.amount,g.amount,g.currency,g.livemode,g.expires_at);
 update gift_cards set status='claimed',claimed_by=pid,claimed_at=now() where id=g.id;
 insert into gift_ledger(gift_id,action,amount)values(g.id,'claim',g.amount);
 return g.id;
end $$;

alter function reserve_product_purchase(jsonb) rename to reserve_product_purchase_before_gifts;
revoke all on function reserve_product_purchase_before_gifts(jsonb) from public,anon,authenticated,service_role;
create function reserve_product_purchase(input jsonb) returns product_purchase_intents language plpgsql security definer set search_path=public as $$
declare i product_purchase_intents; credit gift_wallet_credits; needed int; used int; total_used int:=0; budget int;
begin
 if exists(select 1 from catalog_products where id=(input->>'product_id')::uuid and published->>'kind'='gift') then raise exception 'Bitte den Geschenk-Checkout verwenden';end if;
 if coalesce((input->>'use_gift_credit')::boolean,false) then
  perform pg_advisory_xact_lock(hashtext('product-child:'||(input->>'player_id')));
  select * into i from product_purchase_intents where id=(input->>'id')::uuid for update;
  if found then
   if not i.gift_credit_prepared or i.parent_id is distinct from (input->>'parent_id')::uuid or i.auth_id is distinct from (input->>'auth_id')::uuid or i.player_id is distinct from (input->>'player_id')::uuid or i.product_id is distinct from (input->>'product_id')::uuid or i.gift_original_discount is distinct from nullif(input->'discount','null'::jsonb) or (input->>'amount')::int is distinct from i.expected_amount+i.gift_credit_amount then raise exception 'Guthabenbestellung wurde mit anderen Angaben begonnen';end if;
   return i;
  end if;
 else
  if exists(select 1 from product_purchase_intents where id=(input->>'id')::uuid and gift_credit_prepared) then raise exception 'Guthabenwahl wurde geändert';end if;
 end if;
 i:=reserve_product_purchase_before_gifts(input);
 if not coalesce((input->>'use_gift_credit')::boolean,false) or i.gift_credit_amount>0 or i.status<>'reserved' then return i;end if;
 if i.parent_id is null or i.guest_data is not null or i.product->>'kind'='gift' then raise exception 'Geschenkguthaben benötigt dein Elternkonto';end if;
 update product_purchase_intents set gift_credit_prepared=true,gift_original_discount=discount where id=i.id returning * into i;
 perform pg_advisory_xact_lock(hashtext('gift-wallet:'||i.parent_id::text));
 -- Lock once before calculating availability, also serializing a concurrent refund freeze.
 perform 1 from gift_wallet_credits where parent_id=i.parent_id and currency=i.currency and livemode=product_payment_livemode() and not frozen and expires_at>now() and remaining>reserved order by expires_at,gift_id for update;
 needed:=i.expected_amount;
 select least(needed,coalesce(sum(remaining-reserved),0)) into budget from gift_wallet_credits where parent_id=i.parent_id and currency=i.currency and livemode=product_payment_livemode() and not frozen and expires_at>now() and remaining>reserved;
 -- EUR card payments require at least 50 cents. Keep unused cents in the wallet.
 if needed-budget between 1 and 49 then budget:=greatest(0,needed-50);end if;
 for credit in select * from gift_wallet_credits where parent_id=i.parent_id and currency=i.currency and livemode=product_payment_livemode() and not frozen and expires_at>now() and remaining>reserved order by expires_at,gift_id for update loop
  exit when budget<=0;
  used:=least(budget,credit.remaining-credit.reserved);
  insert into gift_allocations(intent_id,gift_id,amount)values(i.id,credit.gift_id,used);
  update gift_wallet_credits set reserved=reserved+used where gift_id=credit.gift_id;
  insert into gift_ledger(gift_id,intent_id,action,amount)values(credit.gift_id,i.id,'hold',used);
  needed:=needed-used;budget:=budget-used;total_used:=total_used+used;
 end loop;
 if total_used>0 then
 update product_purchase_intents set gift_original_discount=discount,gift_credit_amount=total_used,expected_amount=needed,
 discount=coalesce(discount,'{}'::jsonb)||jsonb_build_object('amount',needed,'source','gift','duration','once','duration_in_months',null)
 where id=i.id returning * into i;
 end if;
 return i;
end $$;

create function gift_finish_allocations() returns trigger language plpgsql security definer set search_path=public as $$
declare a gift_allocations; locked_frozen boolean;
begin
 if new.gift_credit_amount=0 or old.status=new.status then return new;end if;
 if new.status='fulfilled' then
  for a in select * from gift_allocations where intent_id=new.id and state='held' for update loop
   select frozen into locked_frozen from gift_wallet_credits where gift_id=a.gift_id for update;
   if locked_frozen then raise exception 'Geschenkguthaben benötigt Prüfung';end if;
   update gift_wallet_credits set reserved=reserved-a.amount,remaining=remaining-a.amount where gift_id=a.gift_id;
   update gift_allocations set state='spent' where intent_id=a.intent_id and gift_id=a.gift_id;
   insert into gift_ledger(gift_id,intent_id,action,amount)values(a.gift_id,new.id,'spend',-a.amount);
  end loop;
 elsif new.status='expired' then
  for a in select * from gift_allocations where intent_id=new.id and state='held' for update loop
   update gift_wallet_credits set reserved=reserved-a.amount where gift_id=a.gift_id;
   update gift_allocations set state='released' where intent_id=a.intent_id and gift_id=a.gift_id;
   insert into gift_ledger(gift_id,intent_id,action,amount)values(a.gift_id,new.id,'release',a.amount);
  end loop;
 elsif new.status='refunded' then
  for a in select * from gift_allocations where intent_id=new.id and state='spent' for update loop
   update gift_wallet_credits set remaining=remaining+a.amount where gift_id=a.gift_id;
   update gift_allocations set state='returned' where intent_id=a.intent_id and gift_id=a.gift_id;
   insert into gift_ledger(gift_id,intent_id,action,amount)values(a.gift_id,new.id,'return',a.amount);
  end loop;
 end if;
 return new;
end $$;
create trigger gift_allocations_status after update of status on product_purchase_intents for each row execute function gift_finish_allocations();

create function gift_claim_messages(mode boolean, owner uuid) returns setof gift_messages language sql security definer set search_path=public as $$
 update gift_messages set status='processing',attempts=attempts+1,locked_at=now(),lease_token=owner
 where (order_id,audience) in(select m.order_id,m.audience from gift_messages m join gift_orders o on o.id=m.order_id where o.livemode=mode and o.status='issued' and ((m.status in('pending','failed') and m.available_at<=now() and m.attempts<8) or (m.status='processing' and m.locked_at<now()-interval '10 minutes')) order by m.available_at for update of m skip locked limit 10) returning *
$$;
revoke all on function gift_publish_snapshot(jsonb),gift_issue_paid_order(jsonb),gift_claim(jsonb),gift_claim_messages(boolean,uuid),gift_finish_allocations(),reserve_product_purchase(jsonb) from public,anon,authenticated;
grant execute on function gift_publish_snapshot(jsonb),gift_issue_paid_order(jsonb),gift_claim(jsonb),gift_claim_messages(boolean,uuid),reserve_product_purchase(jsonb) to service_role;
commit;
