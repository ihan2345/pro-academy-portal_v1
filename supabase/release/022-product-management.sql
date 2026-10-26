-- LOCAL ONLY: additive product catalogue. Requires camp 013 and trial releases 017–021.
begin;
create table public.catalog_products (
 id uuid primary key default gen_random_uuid(), revision int not null default 1,
 name text not null, internal_name text not null default '', kind text not null check(kind in ('subscription','camp','other')),
 status text not null default 'draft', category text not null default '', sort_order int not null default 0,
 draft jsonb not null, published jsonb, published_revision int,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index catalog_product_order on catalog_products(sort_order,id);
create index catalog_product_filter on catalog_products(status,kind,category,id);
alter table catalog_products add column search_document tsvector generated always as (to_tsvector('simple',name||' '||internal_name||' '||category)) stored;
create index catalog_product_search on catalog_products using gin(search_document);
create table public.catalog_product_versions (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references catalog_products(id),
 revision int not null, payload jsonb not null, actor_id uuid references profiles(id), created_at timestamptz not null default now(), unique(product_id,revision)
);
create table public.catalog_product_assets (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references catalog_products(id),
 storage_path text not null unique, content_type text not null check(content_type='image/webp'),
 bytes int not null check(bytes>0 and bytes<=8388608), width int not null, height int not null,
 sha256 text not null, alt text not null default '', created_at timestamptz not null default now()
);
create table public.catalog_product_grants (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references catalog_products(id),
 parent_id uuid references parents(id), auth_id uuid references profiles(id), player_id uuid,
 purpose text not null check(purpose in ('visibility','purchase','usage')), expires_at timestamptz,
 reason text not null check(length(reason)>=3), created_at timestamptz not null default now(),
 check(parent_id is not null or auth_id is not null)
);
create index product_grants_parent on catalog_product_grants(parent_id,expires_at);
create table public.product_purchase_intents (
 id uuid primary key, product_id uuid not null references catalog_products(id), product_revision int not null,
 product jsonb not null, parent_id uuid not null references parents(id), auth_id uuid not null references profiles(id),
 player_id uuid not null, player_data jsonb, customer_id text,
 status text not null default 'reserved' check(status in ('reserved','checkout','paid','fulfilled','failed','expired','review','refunded')),
 session_id text unique, checkout_url text, subscription_id text, item_id text, payment_id text unique,
 proof jsonb, camp_booking_id uuid references camp_bookings(id), expected_amount int not null, expected_subtotal int not null,
 benefit_percent int not null default 0, currency text not null, reason text,
 expires_at timestamptz not null default now()+interval '30 minutes', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index product_intent_player on product_purchase_intents(player_id,status);
create table public.product_purchases (
 id uuid primary key default gen_random_uuid(), intent_id uuid not null unique references product_purchase_intents(id),
 product_id uuid not null references catalog_products(id), parent_id uuid not null references parents(id), player_id uuid not null,
 status text not null default 'active' check(status in ('active','refunded','review')), created_at timestamptz not null default now()
);
create table public.product_change_requests (
 id uuid primary key default gen_random_uuid(), parent_id uuid not null references parents(id), auth_id uuid not null references profiles(id), player_id uuid not null,
 product_id uuid not null references catalog_products(id), product_revision int not null, subscription_id text not null, item_id text not null,
 fingerprint text not null, preview jsonb not null, status text not null default 'preview' check(status in ('preview','processing','scheduled','pending_payment','completed','failed','review')),
 schedule_id text, reason text, expires_at timestamptz not null default now()+interval '10 minutes', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index product_change_one_pending on product_change_requests(subscription_id) where status in ('processing','scheduled','pending_payment','review');
create table public.product_payment_events (
 id uuid primary key default gen_random_uuid(), stripe_event_id text not null unique, type text not null, object_id text not null,
 status text not null default 'pending', attempts int not null default 0, lease_token uuid, locked_at timestamptz, last_error text,
 available_at timestamptz not null default now(), created_at timestamptz not null default now()
);
-- No direct browser writes. Even admins use the revision-checked save routine.
do $$ declare t text; begin
 foreach t in array array['catalog_products','catalog_product_versions','catalog_product_assets','catalog_product_grants','product_purchase_intents','product_purchases','product_change_requests','product_payment_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create trigger product_audit after insert or update or delete on public.%I for each row execute function public.audit_change()',t);
 end loop;
end $$;
grant select on catalog_products,catalog_product_versions,catalog_product_assets,catalog_product_grants to authenticated;
create policy product_admin_read on catalog_products for select to authenticated using(is_admin());
create policy product_version_admin_read on catalog_product_versions for select to authenticated using(is_admin());
create policy product_asset_admin_read on catalog_product_assets for select to authenticated using(is_admin());
create policy product_grant_admin_read on catalog_product_grants for select to authenticated using(is_admin());
insert into storage.buckets(id,name,public) values('product-images','product-images',false) on conflict(id) do nothing;
-- Assets are served through the authorised application endpoint; no direct object policies.

create function public.product_context_version() returns text language sql stable security definer set search_path=public as $$
 select md5(concat_ws('|',
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from parents x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from plans x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from profiles x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from camps x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from camp_offers x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from players x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from parent_players x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from subscriptions x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from subscription_players x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from entitlement_periods x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from trial_players x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from trial_families x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from camp_bookings x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from product_purchases x),
 (select md5(coalesce(string_agg(to_jsonb(x)::text,',' order by id),'')) from catalog_product_grants x)))
$$;
revoke all on function product_context_version() from public,anon,authenticated;
grant execute on function product_context_version() to service_role;

create function public.save_catalog_product(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare p catalog_products; data jsonb:=input->'data'; pid uuid:=nullif(input->>'id','')::uuid;
begin
 if not is_admin() then raise exception 'Keine Berechtigung' using errcode='42501'; end if;
 if jsonb_typeof(data)<>'object' or length(btrim(coalesce(data->>'name','')))<2 or data->>'kind' not in ('subscription','camp','other') then raise exception 'Ungültiges Produkt'; end if;
 if pid is null then
  insert into catalog_products(name,internal_name,kind,category,sort_order,status,draft) values(data->>'name',data->>'internal_name',data->>'kind',data->>'category',(data->>'sort_order')::int,'draft',data) returning id into pid;
 else
  select * into p from catalog_products where id=pid for update;
  if not found or p.revision is distinct from (input->>'revision')::int then raise exception 'Produkt wurde zwischenzeitlich geändert. Bitte neu laden.'; end if;
  update catalog_products set name=data->>'name',internal_name=data->>'internal_name',kind=data->>'kind',category=data->>'category',sort_order=(data->>'sort_order')::int,draft=data,revision=revision+1,updated_at=now() where id=pid;
 end if;
 return pid;
end $$;
revoke all on function save_catalog_product(jsonb) from public,anon;
grant execute on function save_catalog_product(jsonb) to authenticated;

create function public.publish_catalog_product(input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare p catalog_products; data jsonb;
begin
 select * into p from catalog_products where id=(input->>'id')::uuid for update;
 if not found or p.revision is distinct from (input->>'revision')::int then raise exception 'Produkt wurde zwischenzeitlich geändert. Bitte neu laden.'; end if;
 if input->>'context_version' is distinct from product_context_version() then raise exception 'Die Familien-/Berechtigungsdaten haben sich geändert. Vorschau erneut berechnen.'; end if;
 data:=p.draft;
 if data->>'status' not in ('draft','active','internal','exclusive','sold_out','archived') then raise exception 'Ungültiger Status'; end if;
 if data->>'status' in ('active','internal','exclusive','sold_out') then
  if data->'price' is null or data->'price'='null'::jsonb or data->'price'->>'livemode' is distinct from 'false' or (data->'price'->>'amount')::int<=0 then raise exception 'Geprüfter Stripe-Testpreis fehlt'; end if;
  if jsonb_array_length(data->'channels')<1 then raise exception 'Anzeigeort fehlt'; end if;
  if data->>'kind'='subscription' and not exists(select 1 from plans where id=(data->>'plan_id')::uuid and stripe_price_id=data->'price'->>'id' and active and not coalesce(is_camp,false) and generation<>'legacy') then raise exception 'Aktueller kaufbarer Tarif fehlt'; end if;
  if data->>'kind'='camp' and not exists(select 1 from camp_offers o join camps c on c.id=o.camp_id where o.id=(data->>'camp_offer_id')::uuid and o.stripe_price_id=data->'price'->>'id' and c.payment_mode='test') then raise exception 'Passendes Test-Campangebot fehlt'; end if;
 end if;
 if exists(select 1 from jsonb_array_elements_text(data->'asset_ids') x where not exists(select 1 from catalog_product_assets a where a.id=x::uuid and a.product_id=p.id)) then raise exception 'Bildzuordnung ungültig'; end if;
 insert into catalog_product_versions(product_id,revision,payload,actor_id) values(p.id,p.revision,data,(input->>'actor_id')::uuid);
 update catalog_products set published=data,published_revision=revision,status=data->>'status',updated_at=now() where id=p.id;
end $$;
revoke all on function publish_catalog_product(jsonb) from public,anon,authenticated;
grant execute on function publish_catalog_product(jsonb) to service_role;

-- Reuse EXACTLY the current trial and assignment implementation. The old admin
-- entry points keep their checks; only the paid-order entry may use these cores.
do $$ declare d text; begin
 d:=pg_get_functiondef('public.trial_convert_for_review(jsonb)'::regprocedure);
 if position('if not is_admin() then raise exception ''Keine Berechtigung''; end if;' in d)=0 then raise exception 'Unexpected trial conversion baseline';end if;
 d:=replace(d,'FUNCTION public.trial_convert_for_review(', 'FUNCTION public.product_trial_conversion_core(');
 d:=replace(d,'if not is_admin() then raise exception ''Keine Berechtigung''; end if;','');
 execute d;
 d:=pg_get_functiondef('public.resolve_subscription_assignment_before_trials(jsonb)'::regprocedure);
 if position('if not public.is_admin() then raise exception ''Keine Berechtigung'' using errcode=''42501''; end if;' in d)=0 then raise exception 'Unexpected assignment baseline';end if;
 d:=replace(d,'FUNCTION public.resolve_subscription_assignment_before_trials(', 'FUNCTION public.product_assignment_core(');
 d:=replace(d,'if not public.is_admin() then raise exception ''Keine Berechtigung'' using errcode=''42501''; end if;','');
 execute d;
end $$;
create or replace function public.trial_convert_for_review(input jsonb) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Keine Berechtigung';end if;perform product_trial_conversion_core(input);end $$;
create or replace function public.resolve_subscription_assignment_before_trials(input jsonb) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Keine Berechtigung' using errcode='42501';end if;perform product_assignment_core(input);end $$;
revoke all on function product_trial_conversion_core(jsonb),product_assignment_core(jsonb) from public,anon,authenticated,service_role;

-- API checkouts have no Payment Link. Existing links remain mandatory for the old origin.
alter table camp_bookings alter column stripe_payment_link_id drop not null;
alter table camp_bookings drop constraint camp_booking_origin_shape;
alter table camp_bookings drop constraint camp_bookings_booking_origin_check;
alter table camp_bookings add constraint camp_bookings_booking_origin_check check(booking_origin in ('checkout','stripe_import','api_checkout'));
alter table camp_bookings add constraint product_camp_origin_shape check(
 (booking_origin in ('checkout','stripe_import') and stripe_payment_link_id is not null) or
 (booking_origin='api_checkout' and stripe_payment_link_id is null and offer_id is not null));
alter table camp_bookings add column product_intent_id uuid unique references product_purchase_intents(id);
-- Existing proof checks already use IS DISTINCT FROM and accept actual null link
-- on both sides. All age/capacity/identity/confirmation logic stays in this routine.

create function public.reserve_product_purchase(input jsonb) returns product_purchase_intents language plpgsql security definer set search_path=public as $$
declare prior product_purchase_intents; p catalog_products; child uuid:=(input->>'player_id')::uuid; family uuid:=(input->>'parent_id')::uuid; data jsonb; offer camp_offers; c camps; count_reserved int; booking uuid;
begin
 perform pg_advisory_xact_lock(hashtext('product-child:'||child::text));
 select * into prior from product_purchase_intents where id=(input->>'id')::uuid;
 if found then
  if prior.parent_id<>family or prior.player_id<>child or prior.product_id<>(input->>'product_id')::uuid then raise exception 'Anfragereferenz bereits anders verwendet';end if;
  return prior;
 end if;
 select * into p from catalog_products where id=(input->>'product_id')::uuid for update;
 data:=p.published;
 if p.published_revision is distinct from (input->>'revision')::int or data->>'status' not in ('active','internal','exclusive') or data is null
  or nullif(data->>'publish_at','')::timestamptz>now() or nullif(data->>'expires_at','')::timestamptz<=now() then raise exception 'Produkt ist nicht mehr kaufbar';end if;
 if not exists(select 1 from parents where id=family and auth_user_id=(input->>'auth_id')::uuid and archived_at is null) then raise exception 'Elternkonto passt nicht';end if;
 if not exists(select 1 from parent_players pp join players k on k.id=pp.player_id where pp.parent_id=family and k.id=child and k.archived_at is null)
 and not exists(select 1 from trial_players t join trial_families f on f.id=t.family_id where t.id=child and f.parent_id=family and f.stopped_at is null and f.created_at+interval '180 days'>now())
 and nullif(input->'player_data','null'::jsonb) is null then raise exception 'Kind gehört nicht zur Familie';end if;
 -- Expired remote sessions are not assumed cancelled: prevent a new paid attempt
 -- until their Stripe state is reconciled. Offline abandoned reservations can expire.
 update product_purchase_intents set status='expired',updated_at=now() where player_id=child and status='reserved' and session_id is null and expires_at<now();
 if exists(select 1 from product_purchase_intents where player_id=child and status in ('reserved','checkout','paid','review','failed') and (product_id=p.id or data->>'kind'='subscription' and product->>'kind'='subscription')) then raise exception 'Für dieses Kind ist bereits ein Kauf offen';end if;
 if data->>'kind'='subscription' and exists(select 1 from subscription_players m join subscriptions s on s.id=m.subscription_id where m.player_id=child and s.status in ('active','trialing','past_due','incomplete','unpaid','paused')) then raise exception 'Bestehendes Abo zuerst wechseln oder klären';end if;
 if (data->>'repeatable')::boolean is not true and exists(select 1 from product_purchases where product_id=p.id and player_id=child and status='active') then raise exception 'Bereits gekauft';end if;
 if data->>'kind'='camp' then
  select * into offer from camp_offers where id=(data->>'camp_offer_id')::uuid;
  select * into c from camps where id=offer.camp_id for update;
  if c.status<>'open' or c.payment_mode<>'test' then raise exception 'Test-Camp ist nicht geöffnet';end if;
  select count(*) into count_reserved from product_purchase_intents i where i.product->>'camp_offer_id' in(select id::text from camp_offers where camp_id=c.id) and i.status in ('reserved','checkout') and i.expires_at>now();
  if camp_occupied_seats(c.id)+count_reserved>=c.capacity+floor(c.capacity*c.buffer_percent/100.0)::int then raise exception 'Keine Campplätze frei';end if;
 end if;
 insert into product_purchase_intents(id,product_id,product_revision,product,parent_id,auth_id,player_id,player_data,customer_id,expected_amount,expected_subtotal,benefit_percent,currency)
 values((input->>'id')::uuid,p.id,p.published_revision,data,family,(input->>'auth_id')::uuid,child,nullif(input->'player_data','null'::jsonb),nullif(input->>'customer_id',''),(input->>'amount')::int,(data->'price'->>'amount')::int,coalesce((input->>'benefit_percent')::int,0),data->'price'->>'currency') returning * into prior;
 return prior;
end $$;
revoke all on function reserve_product_purchase(jsonb) from public,anon,authenticated;
grant execute on function reserve_product_purchase(jsonb) to service_role;

create function public.fulfill_product_purchase(input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
declare i product_purchase_intents; p catalog_products; sub subscriptions; review subscription_assignment_reviews; decision jsonb; child players; parent parents; offer camp_offers; c camps; booking uuid; confirmation jsonb; proof jsonb:=input->'proof';
begin
 select player_id into child.id from product_purchase_intents where id=(input->>'id')::uuid;
 perform pg_advisory_xact_lock(hashtext('product-child:'||child.id::text));
 select * into i from product_purchase_intents where id=(input->>'id')::uuid for update;
 if not found then raise exception 'Kaufauftrag fehlt';end if;
 if i.status='fulfilled' then return jsonb_build_object('status','fulfilled','id',i.id);end if;
 if i.status not in ('checkout','paid','reserved','failed') then raise exception 'Kaufauftrag benötigt Prüfung';end if;
 if proof->>'session_id' is distinct from i.session_id or (proof->>'livemode')::boolean is distinct from false or proof->>'payment_status' is distinct from 'paid'
 or proof->>'price_id' is distinct from i.product->'price'->>'id' or proof->>'product_id' is distinct from i.product->'price'->>'product_id'
 or proof->>'currency' is distinct from i.currency or (proof->>'total')::int is distinct from i.expected_amount or (proof->>'subtotal')::int is distinct from i.expected_subtotal
 or (proof->>'quantity')::int is distinct from 1 or coalesce(proof->>'payment_id','')='' or coalesce(proof->>'customer_id','')='' then raise exception 'Zahlungsnachweis passt nicht';end if;
 if i.customer_id is not null and i.customer_id is distinct from proof->>'customer_id' then raise exception 'Zahlkonto passt nicht';end if;
 select * into p from catalog_products where id=i.product_id for update;
 if p.published is null or p.published_revision<>i.product_revision or p.published->>'status' not in ('active','exclusive','internal') or nullif(p.published->>'expires_at','')::timestamptz<=now() then
  update product_purchase_intents set status='review',proof=proof,reason='Angebot während der Zahlung geändert oder deaktiviert',updated_at=now() where id=i.id;
  return jsonb_build_object('status','review','id',i.id);
 end if;
 select * into parent from parents where id=i.parent_id and auth_user_id=i.auth_id and archived_at is null for update;
 if not found then raise exception 'Familienzuordnung geändert';end if;
 if exists(select 1 from parent_stripe_customers where stripe_customer_id=proof->>'customer_id' and parent_id<>i.parent_id) or exists(select 1 from parents where stripe_customer_id=proof->>'customer_id' and id<>i.parent_id) then raise exception 'Zahlkonto gehört zu anderer Familie';end if;
 -- New children are materialised only after proof. An existing identity is never overwritten.
 if i.player_data is not null then
  if exists(select 1 from players k join parent_players pp on pp.player_id=k.id where pp.parent_id=i.parent_id and lower(btrim(k.first_name))=lower(btrim(i.player_data->>'first_name')) and lower(btrim(k.last_name))=lower(btrim(i.player_data->>'last_name')) and (k.camp_birth_date=(i.player_data->>'birth_date')::date or k.birth_year=extract(year from (i.player_data->>'birth_date')::date))) then raise exception 'Kind bereits vorhanden: bitte Zuordnung prüfen';end if;
  insert into players(id,first_name,last_name,birth_year,camp_birth_date) values(i.player_id,i.player_data->>'first_name',i.player_data->>'last_name',extract(year from (i.player_data->>'birth_date')::date),(i.player_data->>'birth_date')::date);
  insert into parent_players(parent_id,player_id) values(i.parent_id,i.player_id);
 end if;
 insert into parent_stripe_customers(parent_id,stripe_customer_id) values(i.parent_id,proof->>'customer_id') on conflict do nothing;
 update product_purchase_intents set status='paid',proof=proof,payment_id=proof->>'payment_id',customer_id=proof->>'customer_id',subscription_id=input->>'subscription_id',item_id=input->>'item_id',updated_at=now() where id=i.id;
 if i.product->>'kind'='subscription' then
  select * into sub from subscriptions where stripe_subscription_id=input->>'subscription_id' for update;
  if sub.id is null or sub.stripe_customer_id<>proof->>'customer_id' or sub.status<>'active' or sub.needs_review and not exists(select 1 from subscription_assignment_reviews where subscription_id=sub.id and stripe_item_id=input->>'item_id' and status='pending') then raise exception 'Abonnement nicht eindeutig bestätigt';end if;
  if sub.parent_id is not null and sub.parent_id<>i.parent_id then raise exception 'Abo gehört anderer Familie';end if;
  if exists(select 1 from subscription_players m join subscriptions s on s.id=m.subscription_id where m.player_id=i.player_id and s.id<>sub.id and s.status in ('active','trialing','past_due','incomplete','unpaid','paused')) then raise exception 'Für dieses Kind besteht bereits ein anderes Abo';end if;
  update subscriptions set parent_id=i.parent_id where id=sub.id;
  select * into review from subscription_assignment_reviews where subscription_id=sub.id and stripe_item_id=input->>'item_id' and status='pending' for update;
  if review.id is null then raise exception 'Geprüfte Abo-Zuordnung fehlt';end if;
  decision:=jsonb_build_object('review_id',review.id,'signature',review.signature,'player_id',i.player_id,'previous_item_id',null);
  perform product_trial_conversion_core(decision);
  perform product_assignment_core(decision);
  update subscriptions set needs_review=false where id=sub.id and jsonb_array_length(stripe_data->'items')=1 and not exists(select 1 from subscription_assignment_reviews where subscription_id=sub.id and status='pending');
 elsif i.product->>'kind'='camp' then
  select * into offer from camp_offers where id=(i.product->>'camp_offer_id')::uuid;
  select * into c from camps where id=offer.camp_id for update;
  if c.status<>'open' or c.payment_mode<>'test' or offer.stripe_price_id is distinct from i.product->'price'->>'id' or offer.amount<>i.expected_subtotal or offer.currency<>i.currency then raise exception 'Campangebot hat sich geändert';end if;
  if exists(select 1 from trial_players where id=i.player_id and converted_at is null) then perform prepare_trial_camp_player(i.parent_id,i.player_id);end if;
  select * into child from players where id=i.player_id and archived_at is null;
  if child.id is null or not exists(select 1 from parent_players where parent_id=i.parent_id and player_id=child.id) then raise exception 'Kindzuordnung fehlt';end if;
  -- Shared age/profile validation; no alternative age algorithm.
  perform camp_import_child(jsonb_build_object('child',coalesce(i.player_data,to_jsonb(child))||jsonb_build_object('first_name',child.first_name,'last_name',child.last_name,'birth_date',child.camp_birth_date,'gender',coalesce(child.camp_gender,'keine Angabe'),'clothing_size',coalesce(nullif(child.camp_clothing_size,''),'M'),'age_recorded_on',(now() at time zone 'Europe/Berlin')::date)),child,c);
  booking:=gen_random_uuid();
  insert into camp_bookings(id,camp_id,offer_id,parent_id,player_id,browser_token_hash,parent_data,child_data,customer_group,benefit_percent,expected_amount,currency,stripe_price_id,stripe_payment_link_id,booking_origin,product_intent_id)
  values(booking,c.id,offer.id,i.parent_id,child.id,'product:'||i.id,jsonb_build_object('name',parent.full_name,'email',parent.contact_email),jsonb_build_object('first_name',child.first_name,'last_name',child.last_name,'birth_date',child.camp_birth_date,'gender',coalesce(child.camp_gender,'keine Angabe'),'clothing_size',coalesce(nullif(child.camp_clothing_size,''),'M')),case when i.benefit_percent>0 then 'subscriber' else 'new' end,i.benefit_percent,i.expected_subtotal,i.currency,i.product->'price'->>'id',null,'api_checkout',i.id);
  confirmation:=camp_confirm_payment(proof||jsonb_build_object('booking_id',booking,'payment_link_id',null,'payment_id',proof->>'payment_id','refunded',false));
  if confirmation->>'status'<>'paid' then raise exception 'Campaufnahme benötigt Prüfung';end if;
  update product_purchase_intents set camp_booking_id=booking where id=i.id;
 else
  if not exists(select 1 from parent_players where parent_id=i.parent_id and player_id=i.player_id) then raise exception 'Kindzuordnung fehlt';end if;
 end if;
 if i.product->>'kind'<>'subscription' and (i.product->>'repeatable')::boolean is not true and exists(select 1 from product_purchases where product_id=i.product_id and player_id=i.player_id and status='active' and intent_id<>i.id) then raise exception 'Produkt wurde für dieses Kind bereits erfüllt';end if;
 insert into product_purchases(intent_id,product_id,parent_id,player_id) values(i.id,i.product_id,i.parent_id,i.player_id);
 update product_purchase_intents set status='fulfilled',updated_at=now() where id=i.id;
 return jsonb_build_object('status','fulfilled','id',i.id);
end $$;
revoke all on function fulfill_product_purchase(jsonb) from public,anon,authenticated;
grant execute on function fulfill_product_purchase(jsonb) to service_role;

create function public.claim_product_events() returns setof product_payment_events language sql security definer set search_path=public as $$
 update product_payment_events set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),locked_at=now()
 where id in(select id from product_payment_events where ((status in ('pending','failed') and attempts<8 and available_at<=now()) or (status='processing' and locked_at<now()-interval '5 minutes')) order by created_at limit 20 for update skip locked) returning *
$$;
revoke all on function claim_product_events() from public,anon,authenticated;
grant execute on function claim_product_events() to service_role;

create table public.product_request_limits(id text primary key, attempts int not null, reset_at timestamptz not null);
alter table product_request_limits enable row level security;
revoke all on product_request_limits from public,anon,authenticated;
grant all on product_request_limits to service_role;
create function public.limit_product_request(key text) returns boolean language plpgsql security definer set search_path=public as $$
declare n int;
begin
 insert into product_request_limits values(key,1,now()+interval '10 minutes') on conflict(id) do update set
 attempts=case when product_request_limits.reset_at<now() then 1 else product_request_limits.attempts+1 end,
 reset_at=case when product_request_limits.reset_at<now() then now()+interval '10 minutes' else product_request_limits.reset_at end returning attempts into n;
 delete from product_request_limits where reset_at<now()-interval '1 day';
 return n<=10;
end $$;
revoke all on function limit_product_request(text) from public,anon,authenticated;
grant execute on function limit_product_request(text) to service_role;
create function public.prepare_product_parent(full_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); mail text; pid uuid;
begin
 select lower(btrim(email)) into mail from auth.users where id=uid and email_confirmed_at is not null;
 if uid is null or mail is null or length(btrim(full_name))<2 or length(full_name)>160 then raise exception 'Bestätigte Anmeldung und Elternname erforderlich';end if;
 perform pg_advisory_xact_lock(hashtext('family:'||mail));
 if exists(select 1 from profiles where id=uid and role<>'parent') then raise exception 'Teamkonten nicht als Elternkonto verwenden';end if;
 select id into pid from parents where auth_user_id=uid and archived_at is null;
 if pid is not null then return pid;end if;
 -- An email match is a reason to request explicit identity review, never a merge.
 if exists(select 1 from parents where lower(btrim(contact_email))=mail) then raise exception 'Bestehende Familienzuordnung bitte durch die Verwaltung prüfen lassen';end if;
 insert into profiles(id,full_name,role) values(uid,full_name,'parent') on conflict(id) do nothing;
 insert into parents(auth_user_id,full_name,contact_email,notifications_held) values(uid,full_name,mail,true) returning id into pid;
 return pid;
end $$;
revoke all on function prepare_product_parent(text) from public,anon;
grant execute on function prepare_product_parent(text) to authenticated;

notify pgrst,'reload schema';
commit;
