-- A single admin approval for 1–100% special discounts, including direct Stripe links.
-- Apply with the matching portal AND jobs runner. This migration approves no booking and sends no mail.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Resolve regular ABO benefits from the child's actual active assignments, never browser input.
create function public.camp_regular_benefit(player uuid) returns int language sql stable security definer set search_path=public as $$
 select coalesce(max(p.camp_benefit_percent),0)::int from plans p where not coalesce(p.is_camp,false)
 and p.camp_benefit_percent in (10,15,20) and p.stripe_price_id in (
  select item->>'price_id' from subscription_players sp join subscriptions s on s.id=sp.subscription_id
   cross join lateral jsonb_array_elements(coalesce(s.stripe_data->'items','[]'::jsonb)) item
   where sp.player_id=player and s.status='active' and item->>'id'=sp.stripe_item_id
  union select ep.stripe_price_id from entitlement_periods ep join subscriptions s on s.id=ep.subscription_id
   where ep.player_id=player and ep.status='active' and s.status='active' and ep.starts_at<=now() and ep.ends_at>now()
 )
$$;
revoke all on function public.camp_regular_benefit(uuid) from public,anon,authenticated;

-- Gate both automatic and ordinary manual imports, after identity resolution but before insertion.
-- Raising here also rolls back any newly created family/child in the enclosing import transaction.
do $$ declare definition text; original text; begin
 select pg_get_functiondef('public.camp_import_paid_booking(jsonb)'::regprocedure) into original;
 definition:=replace(original,'if not found then raise exception ''Child missing''; end if;', $new$if not found then raise exception 'Child missing'; end if;
 if coalesce((input->>'subtotal')::int,0)<=0 or (input->>'amount')::int>(input->>'subtotal')::int
  or coalesce((input->'evidence'->>'discount')::int,0)<>(input->>'subtotal')::int-(input->>'amount')::int then raise exception 'Invalid verified payment'; end if;
 if (input->>'subtotal')::int>(input->>'amount')::int and not exists(
  select 1 from unnest(array[10,15,20]) pct where pct<=public.camp_regular_benefit(player)
   and abs(((input->>'subtotal')::numeric*pct/100)-((input->>'subtotal')::int-(input->>'amount')::int))<=1
 ) then raise exception 'Sonderrabatt benötigt eine ausdrückliche Admin-Freigabe.'; end if;$new$);
 if definition=original then raise exception 'Unexpected import validation'; end if;
 original:=definition;
 definition:=replace(definition,
  'and s.product_id=input->>''product_id'') then raise exception ''Unknown source''; end if;',
  'and s.product_id=input->>''product_id'') and not exists(select 1 from public.camp_offers o where o.camp_id=c.id and o.stripe_payment_link_id=input->>''payment_link_id'' and o.stripe_price_id=input->>''price_id'' and o.stripe_product_id=input->>''product_id'' and o.amount=(input->>''subtotal'')::int) then raise exception ''Unknown source''; end if;');
 if definition=original then raise exception 'Unexpected import source'; end if;
 execute definition;
end $$;

-- Stripe may report a completed 100% checkout as no_payment_required instead of paid.
do $$ declare definition text; original text; begin
 select pg_get_functiondef('public.camp_confirm_payment(jsonb)'::regprocedure) into original;
 definition:=replace(original,'if input->>''payment_status'' is distinct from ''paid'' or',
  'if (input->>''payment_status'' is distinct from ''paid'' and not (input->>''payment_status''=''no_payment_required'' and input->>''proof_kind''=''no_cost_checkout'' and (input->>''total'')::int=0)) or');
 if definition=original then raise exception 'Unexpected confirmation status'; end if;
 execute definition;
end $$;

create or replace function public.camp_approve_free_booking(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare b camp_bookings; c camps; family parents; kid players; pid uuid:=nullif(input->>'parent_id','')::uuid;
 player uuid:=nullif(input->>'player_id','')::uuid; actor uuid:=(input->>'actor_id')::uuid; proof jsonb:=input->'proof'; child jsonb;
 customer text:=nullif(proof->>'customer_id',''); rid uuid; email text; seats int; total int:=(proof->>'total')::int; discount int:=(proof->>'discount')::int; percent numeric;
begin
 if not exists(select 1 from profiles where id=actor and role='admin') then raise exception 'Admin required'; end if;
 if coalesce((input->>'special_discount_approved')::boolean,false) is not true or length(btrim(coalesce(input->>'notes','')))<3 then raise exception 'Sonderrabatt ausdrücklich bestätigen und begründen.'; end if;
 select * into c from camps where id=(input->>'camp_id')::uuid for update;
 select * into b from camp_bookings where id=(input->>'booking_id')::uuid for update;
 if not found or b.status<>'review' or b.camp_id<>(input->>'camp_id')::uuid then raise exception 'Buchung nicht zur Freigabe verfügbar.'; end if;
 if c.payment_mode<>'live' or c.status not in ('open','closed') then raise exception 'Live-Camp nicht verfügbar.'; end if;
 if proof->>'session_id' is distinct from b.stripe_session_id or proof->>'session_status' is distinct from 'complete'
  or proof->>'payment_status' not in ('paid','no_payment_required') or proof->>'payment_status' is null
  or (proof->>'livemode')::boolean is distinct from true
  or total is null or total<0
  or (total=0 and proof->>'payment_intent' is not null)
  or (total>0 and (coalesce(proof->>'payment_intent','') not like 'pi_%' or coalesce(proof->>'charge_id','') not like 'ch_%' or proof->>'payment_status'<>'paid'
    or (proof->>'refunded')::boolean is distinct from false or (proof->>'disputed')::boolean is distinct from false)) or (proof->>'subtotal')::int is distinct from b.expected_amount
  or discount is null or discount<=0 or discount>b.expected_amount or total+discount<>b.expected_amount or b.expected_amount<=0
  or proof->>'currency' is distinct from 'eur' or (proof->>'quantity')::int is distinct from 1
  or proof->>'payment_link_id' is distinct from b.stripe_payment_link_id or proof->>'price_id' is distinct from b.stripe_price_id
  or (b.stripe_customer_id is not null and customer is distinct from b.stripe_customer_id)
  or (b.booking_origin='checkout' and not exists(select 1 from camp_offers o where o.id=b.offer_id and o.camp_id=b.camp_id and o.stripe_product_id=proof->>'product_id' and o.stripe_price_id=b.stripe_price_id and o.stripe_payment_link_id=b.stripe_payment_link_id and o.amount=b.expected_amount))
  or (b.booking_origin='stripe_import' and not exists(select 1 from camp_stripe_sources s where s.camp_id=b.camp_id and s.payment_link_id=b.stripe_payment_link_id and s.price_id=b.stripe_price_id and s.product_id=proof->>'product_id') and not exists(select 1 from camp_offers o where o.camp_id=b.camp_id and o.stripe_payment_link_id=b.stripe_payment_link_id and o.stripe_price_id=b.stripe_price_id and o.stripe_product_id=proof->>'product_id' and o.amount=b.expected_amount))
 then raise exception 'Invalid verified discounted checkout'; end if;
 percent:=round(discount::numeric/b.expected_amount*100,2);
 if nullif(proof->>'created_at','')::timestamptz is null then raise exception 'Buchungsdatum fehlt.'; end if;
 -- Serialize identity creation, preserving existing families and explicit choices.
 lock table parents in share row exclusive mode;
 lock table players in share row exclusive mode;
 if input->'new_parent' is not null and input->'new_parent'<>'null'::jsonb then
  if pid is not null or player is not null or coalesce((input->>'new_child')::boolean,false) then raise exception 'Choose existing or new family'; end if;
  email:=lower(btrim(input->'new_parent'->>'email'));
  if coalesce(email,'') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' or length(btrim(coalesce(input->'new_parent'->>'name','')))<2 then raise exception 'Elternangaben fehlen.'; end if;
  if exists(select 1 from parents where lower(btrim(contact_email))=email) then raise exception 'Bestehendes Elternkonto auswählen.'; end if;
  insert into parents(full_name,contact_email,notifications_held) values(input->'new_parent'->>'name',email,true) returning id into pid;
  insert into camp_owned_rows values('parents',pid);
 elsif pid is null or (player is null and not coalesce((input->>'new_child')::boolean,false)) then raise exception 'Familie und Kind ausdrücklich auswählen.';
 end if;
 select * into family from parents where id=pid and archived_at is null for update;
 if not found then raise exception 'Aktive Familie fehlt.'; end if;
 if customer is not null and (exists(select 1 from parent_stripe_customers where stripe_customer_id=customer and parent_id<>pid) or exists(select 1 from parents where stripe_customer_id=customer and id<>pid)) then raise exception 'Stripe-Kunde gehört bereits zu einer anderen Familie.'; end if;
 if player is null then
  if exists(select 1 from players p join parent_players pp on pp.player_id=p.id where pp.parent_id=pid and camp_name(p.first_name||' '||p.last_name)=camp_name((input->'child'->>'first_name')||' '||(input->'child'->>'last_name'))) then raise exception 'Kind bereits vorhanden. Bitte zuordnen.'; end if;
  insert into players(first_name,last_name,birth_year) values(input->'child'->>'first_name',input->'child'->>'last_name',null) returning id into player;
  insert into camp_owned_rows values('players',player);
  insert into parent_players(parent_id,player_id) values(pid,player) returning id into rid;
  insert into camp_owned_rows values('parent_players',rid);
 elsif not exists(select 1 from parent_players where parent_id=pid and player_id=player) then raise exception 'Eltern-Kind-Zuordnung fehlt.';
 end if;
 if b.parent_id is not null and b.parent_id<>pid or b.player_id is not null and b.player_id<>player then raise exception 'Vorhandene Buchungszuordnung darf nicht geändert werden.'; end if;
 select * into kid from players where id=player and archived_at is null for update;
 if not found then raise exception 'Aktives Kind fehlt.'; end if;
 if exists(select 1 from camp_bookings where camp_id=b.camp_id and player_id=player and status in ('paid','review') and id<>b.id) then raise exception 'Kind bereits gebucht oder zur Prüfung vorgemerkt.'; end if;
 seats:=camp_occupied_seats(b.camp_id,coalesce(b.stripe_payment_id,b.stripe_session_id));
 if seats>=c.capacity+floor(c.capacity*c.buffer_percent/100.0)::int then raise exception 'Kapazität erreicht.'; end if;
 input:=jsonb_set(input,'{child,age_recorded_on}',to_jsonb(((proof->>'created_at')::timestamptz at time zone 'Europe/Berlin')::date));
 child:=camp_import_child(input,kid,c);
 if coalesce(btrim(child->>'first_name'),'')='' or coalesce(btrim(child->>'last_name'),'')='' or coalesce(btrim(child->>'clothing_size'),'')='' then raise exception 'Kindesangaben fehlen.'; end if;
 update players set camp_birth_date=coalesce(camp_birth_date,nullif(child->>'birth_date','')::date),
  camp_age_at_booking=case when camp_age_recorded_on is null or camp_age_recorded_on<=(child->>'age_recorded_on')::date then (child->>'age_at_booking')::int else camp_age_at_booking end,
  camp_age_recorded_on=case when camp_age_recorded_on is null or camp_age_recorded_on<=(child->>'age_recorded_on')::date then case when child->>'age_at_booking' is not null then (child->>'age_recorded_on')::date end else camp_age_recorded_on end,
  camp_gender=child->>'gender',camp_clothing_size=child->>'clothing_size' where id=player;
 if customer is not null then insert into parent_stripe_customers(parent_id,stripe_customer_id) values(pid,customer) on conflict do nothing; end if;
 update camp_bookings set parent_id=pid,player_id=player,status='paid',review_reason=null,manual_notifications_held=true,
  parent_data=jsonb_build_object('name',family.full_name,'email',family.contact_email,'phone',coalesce(input->'new_parent'->>'phone',b.parent_data->>'phone','')),
  child_data=child,stripe_customer_id=customer,stripe_payment_id=coalesce(proof->>'payment_intent',b.stripe_session_id),paid_amount=total,paid_at=coalesce(paid_at,(proof->>'created_at')::timestamptz),
  payment_details=coalesce(payment_details,'{}')||jsonb_build_object('special_discount_approval',jsonb_build_object('actor_id',actor,'approved_at',now(),'reason',input->>'notes','session_id',b.stripe_session_id,'percent',percent,'proof',proof)) where id=b.id;
 insert into audit_log(actor_id,actor_type,action,table_name,record_id,old_value,new_value,reason)
 values(actor,'user',case when total=0 then 'CAMP_FREE_BOOKING_APPROVED' else 'CAMP_DISCOUNT_BOOKING_APPROVED' end,'camp_bookings',b.id,to_jsonb(b),jsonb_build_object('status','paid','parent_id',pid,'player_id',player,'session_id',b.stripe_session_id,'discount_percent',percent,'amount',total,'notifications_held',true),input->>'notes');
 if seats+1>=c.capacity+floor(c.capacity*c.buffer_percent/100.0)::int then update camps set status='closed' where id=c.id; end if;
 return b.id;
end $$;
revoke all on function public.camp_approve_free_booking(jsonb) from public,anon,authenticated;
grant execute on function public.camp_approve_free_booking(jsonb) to service_role;

-- A direct-link payment is staged and approved in ONE transaction. A failed identity/payment/
-- capacity check leaves no booking, family or child behind. Existing portal bookings keep their ID.
create function public.camp_approve_discount_booking(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare proof jsonb:=input->'proof'; b camp_bookings; c camps; booking uuid; ref text:=coalesce(proof->>'payment_intent',proof->>'session_id');
begin
 if not exists(select 1 from profiles where id=(input->>'actor_id')::uuid and role='admin') then raise exception 'Admin required'; end if;
 if nullif(input->>'booking_id','') is not null then return camp_approve_free_booking(input); end if;
 select * into c from camps where id=(input->>'camp_id')::uuid for update;
 if not found or c.payment_mode<>'live' or c.status not in ('open','closed') then raise exception 'Live-Camp nicht verfügbar.'; end if;
 if coalesce(proof->>'session_id','') not like 'cs_live_%' or input->>'session_id' is distinct from proof->>'session_id'
  or nullif(proof->>'client_reference_id','') is not null
  or (not exists(select 1 from camp_stripe_sources s where s.camp_id=c.id and s.payment_link_id=proof->>'payment_link_id' and s.price_id=proof->>'price_id' and s.product_id=proof->>'product_id') and not exists(select 1 from camp_offers o where o.camp_id=c.id and o.stripe_payment_link_id=proof->>'payment_link_id' and o.stripe_price_id=proof->>'price_id' and o.stripe_product_id=proof->>'product_id' and o.amount=(proof->>'subtotal')::int)) then raise exception 'Unknown source'; end if;
 perform pg_advisory_xact_lock(hashtext('camp-import:'||ref));
 if exists(select 1 from camp_bookings where stripe_payment_id=ref or stripe_session_id=proof->>'session_id') then raise exception 'Buchung bereits vorhanden. Bitte gespeicherte Zuordnung prüfen.'; end if;
 insert into camp_bookings(id,camp_id,offer_id,booking_origin,browser_token_hash,parent_data,child_data,customer_group,benefit_percent,expected_amount,currency,stripe_price_id,stripe_payment_link_id,status,stripe_session_id,stripe_payment_id,stripe_customer_id,paid_amount,payment_details)
 values(gen_random_uuid(),c.id,null,'stripe_import','admin-discount:'||ref,'{}',input->'child','new',0,(proof->>'subtotal')::int,'eur',proof->>'price_id',proof->>'payment_link_id','review',proof->>'session_id',ref,nullif(proof->>'customer_id',''),(proof->>'total')::int,jsonb_build_object('source','stripe_import','livemode',true)) returning id into booking;
 return camp_approve_free_booking(input||jsonb_build_object('booking_id',booking));
end $$;
revoke all on function public.camp_approve_discount_booking(jsonb) from public,anon,authenticated;
grant execute on function public.camp_approve_discount_booking(jsonb) to service_role;

do $$ declare definition text; begin
 select pg_get_functiondef('public.camp_reset_v0()'::regprocedure) into definition;
 definition:=replace(definition,'drop function if exists public.camp_approve_free_booking(jsonb);','drop function if exists public.camp_approve_discount_booking(jsonb);
 drop function if exists public.camp_regular_benefit(uuid);
 drop function if exists public.camp_approve_free_booking(jsonb);');
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
