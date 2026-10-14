-- Admin-only approval of an existing, independently verified, fully discounted checkout.
-- Apply with the matching portal. No approval, payment, invitation or mail is triggered by this migration.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.camp_bookings add column manual_notifications_held boolean not null default false;
create function public.camp_approve_free_booking(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare b camp_bookings; c camps; family parents; kid players; pid uuid:=nullif(input->>'parent_id','')::uuid;
 player uuid:=nullif(input->>'player_id','')::uuid; actor uuid:=(input->>'actor_id')::uuid; proof jsonb:=input->'proof'; child jsonb;
 customer text:=nullif(proof->>'customer_id',''); rid uuid; email text; seats int;
begin
 if not exists(select 1 from profiles where id=actor and role='admin') then raise exception 'Admin required'; end if;
 if coalesce((input->>'special_discount_approved')::boolean,false) is not true or length(btrim(coalesce(input->>'notes','')))<3 then raise exception 'Sonderrabatt ausdrücklich bestätigen und begründen.'; end if;
 select * into b from camp_bookings where id=(input->>'booking_id')::uuid for update;
 if not found or b.status<>'review' or b.booking_origin<>'checkout' or b.paid_amount is distinct from 0 or b.camp_id<>(input->>'camp_id')::uuid then raise exception 'Buchung nicht zur Freigabe verfügbar.'; end if;
 select * into c from camps where id=b.camp_id for update;
 if c.payment_mode<>'live' or c.status not in ('open','closed') then raise exception 'Live-Camp nicht verfügbar.'; end if;
 if proof->>'session_id' is distinct from b.stripe_session_id or proof->>'session_status' is distinct from 'complete'
  or proof->>'payment_status' not in ('paid','no_payment_required') or proof->>'payment_status' is null
  or (proof->>'livemode')::boolean is distinct from true or proof->>'payment_intent' is not null
  or (proof->>'total')::int is distinct from 0 or (proof->>'subtotal')::int is distinct from b.expected_amount
  or (proof->>'discount')::int is distinct from b.expected_amount or b.expected_amount<=0
  or proof->>'currency' is distinct from 'eur' or (proof->>'quantity')::int is distinct from 1
  or proof->>'payment_link_id' is distinct from b.stripe_payment_link_id or proof->>'price_id' is distinct from b.stripe_price_id
  or (b.stripe_customer_id is not null and customer is distinct from b.stripe_customer_id)
  or not exists(select 1 from camp_offers o where o.id=b.offer_id and o.camp_id=b.camp_id and o.stripe_product_id=proof->>'product_id' and o.stripe_price_id=b.stripe_price_id and o.stripe_payment_link_id=b.stripe_payment_link_id and o.amount=b.expected_amount)
 then raise exception 'Invalid verified no-cost checkout'; end if;
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
  child_data=child,stripe_customer_id=customer,stripe_payment_id=b.stripe_session_id,paid_amount=0,paid_at=coalesce(paid_at,(proof->>'created_at')::timestamptz),
  payment_details=coalesce(payment_details,'{}')||jsonb_build_object('special_discount_approval',jsonb_build_object('actor_id',actor,'approved_at',now(),'reason',input->>'notes','session_id',b.stripe_session_id,'percent',100,'proof',proof)) where id=b.id;
 insert into audit_log(actor_id,actor_type,action,table_name,record_id,old_value,new_value,reason)
 values(actor,'user','CAMP_FREE_BOOKING_APPROVED','camp_bookings',b.id,to_jsonb(b),jsonb_build_object('status','paid','parent_id',pid,'player_id',player,'session_id',b.stripe_session_id,'discount_percent',100,'amount',0,'notifications_held',true),input->>'notes');
 if seats+1>=c.capacity+floor(c.capacity*c.buffer_percent/100.0)::int then update camps set status='closed' where id=c.id; end if;
 return b.id;
end $$;
revoke all on function public.camp_approve_free_booking(jsonb) from public,anon,authenticated;
grant execute on function public.camp_approve_free_booking(jsonb) to service_role;
-- All automatic Camp mail stays blocked until a separate explicit release.
do $$ declare definition text; original text; begin
 select pg_get_functiondef('public.camp_notification_allowed(text,text,jsonb)'::regprocedure) into original;
 definition:=replace(original, 'if not found or b.status<>''paid''', 'if not found or b.manual_notifications_held or b.status<>''paid''');
 if definition=original then raise exception 'Unexpected Camp notification gate'; end if;
 execute definition;
end $$;
do $$ declare definition text; begin
 select pg_get_functiondef('public.camp_reset_v0()'::regprocedure) into definition;
 definition:=replace(definition,'drop function public.camp_confirm_payment(jsonb);','drop function if exists public.camp_approve_free_booking(jsonb);
 drop function public.camp_confirm_payment(jsonb);');
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
