-- Canonical paid-order routines after local integration checks. No legacy business logic is copied.
begin;
create or replace function public.product_context_version() returns text language sql stable security definer set search_path=public as $$
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
create or replace function public.reserve_product_purchase(input jsonb) returns product_purchase_intents language plpgsql security definer set search_path=public as $$
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
 insert into product_purchase_intents(id,product_id,product_revision,product,parent_id,auth_id,player_id,player_data,customer_id,expected_amount,expected_subtotal,benefit_percent,currency,channel,camp_details)
 values((input->>'id')::uuid,p.id,p.published_revision,data,family,(input->>'auth_id')::uuid,child,nullif(input->'player_data','null'::jsonb),nullif(input->>'customer_id',''),(input->>'amount')::int,(data->'price'->>'amount')::int,coalesce((input->>'benefit_percent')::int,0),data->'price'->>'currency',coalesce(input->>'channel','catalog'),nullif(input->'camp_details','null'::jsonb)) returning * into prior;
 return prior;
end $$;
create or replace function public.fulfill_product_purchase(input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
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
 if input->>'context_version' is distinct from product_context_version() then raise exception 'Berechtigungsdaten geändert; erneut prüfen';end if;
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
  perform camp_import_child(jsonb_build_object('child',coalesce(i.camp_details,i.player_data,to_jsonb(child))||jsonb_build_object('first_name',child.first_name,'last_name',child.last_name,'birth_date',coalesce(i.camp_details->>'birth_date',i.player_data->>'birth_date',child.camp_birth_date::text),'gender',coalesce(i.camp_details->>'gender',child.camp_gender,'keine Angabe'),'clothing_size',coalesce(i.camp_details->>'clothing_size',i.player_data->>'clothing_size',child.camp_clothing_size),'age_recorded_on',(now() at time zone 'Europe/Berlin')::date)),child,c);
  booking:=gen_random_uuid();
  insert into camp_bookings(id,camp_id,offer_id,parent_id,player_id,browser_token_hash,parent_data,child_data,customer_group,benefit_percent,expected_amount,currency,stripe_price_id,stripe_payment_link_id,booking_origin,product_intent_id)
  values(booking,c.id,offer.id,i.parent_id,child.id,'product:'||i.id,jsonb_build_object('name',parent.full_name,'email',parent.contact_email),jsonb_build_object('first_name',child.first_name,'last_name',child.last_name,'birth_date',coalesce(i.camp_details->>'birth_date',i.player_data->>'birth_date',child.camp_birth_date::text),'gender',coalesce(i.camp_details->>'gender',child.camp_gender,'keine Angabe'),'clothing_size',coalesce(i.camp_details->>'clothing_size',i.player_data->>'clothing_size',child.camp_clothing_size)),case when i.benefit_percent>0 then 'subscriber' else 'new' end,i.benefit_percent,i.expected_subtotal,i.currency,i.product->'price'->>'id',null,'api_checkout',i.id);
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

insert into system_settings(key,value) values('product_payment_schema_version','25'::jsonb) on conflict(key) do update set value=excluded.value;
notify pgrst,'reload schema';
commit;
