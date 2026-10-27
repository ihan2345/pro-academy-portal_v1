-- Guest purchase capture and verified account claims. No production switches or mail flags are changed.
begin;
alter table public.product_purchase_intents alter column parent_id drop not null, alter column auth_id drop not null;
alter table public.product_purchase_intents add column guest_data jsonb, add column guest_token_hash text, add column discount jsonb;
alter table public.product_purchase_intents add constraint product_intent_identity check (
 (parent_id is not null and auth_id is not null) or
 (guest_data is not null and guest_token_hash is not null and guest_token_hash ~ '^[a-f0-9]{64}$')
);
create index product_guest_email on public.product_purchase_intents(lower(guest_data->>'email')) where guest_data is not null;
-- Only families created by a proven guest order may be claimed by verified email.
create table public.product_guest_families (
 parent_id uuid primary key references parents(id), email text not null, claimed_at timestamptz,
 created_at timestamptz not null default now()
);
create unique index product_guest_family_email on public.product_guest_families(lower(email));
create table public.product_guest_messages (
 intent_id uuid primary key references product_purchase_intents(id),
 status text not null default 'pending' check(status in('pending','processing','sent','failed')),
 attempts int not null default 0, available_at timestamptz not null default now(),
 lease_token uuid, locked_at timestamptz, sent_at timestamptz, last_error text
);
do $$ declare t text; begin
 foreach t in array array['product_guest_families','product_guest_messages'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
-- Adapt the current canonical reservation, keeping camp capacity and subscription conflict locks.
do $$ declare d text; begin
 d:=pg_get_functiondef('public.reserve_product_purchase(jsonb)'::regprocedure);
 d:=replace(d, $a$if prior.parent_id<>family or prior.player_id<>child or prior.product_id<>(input->>'product_id')::uuid$a$,
 $a$if prior.parent_id is distinct from family or prior.player_id<>child or prior.product_id<>(input->>'product_id')::uuid or prior.auth_id is distinct from (input->>'auth_id')::uuid or prior.guest_token_hash is distinct from input->>'guest_token_hash' or prior.guest_data is distinct from nullif(input->'guest_data','null'::jsonb) or prior.discount is distinct from nullif(input->'discount','null'::jsonb)$a$);
 d:=replace(d, $a$ if not exists(select 1 from parents where id=family$a$, $a$ if nullif(input->'guest_data','null'::jsonb) is not null then
  if family is not null or nullif(input->>'auth_id','') is not null or coalesce(input->>'guest_token_hash','') !~ '^[a-f0-9]{64}$' or coalesce(length(input->'guest_data'->>'full_name'),0)<2 or coalesce(input->'guest_data'->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or nullif(input->'player_data','null'::jsonb) is null then raise exception 'Gastdaten unvollständig';end if;
 elsif not exists(select 1 from parents where id=family$a$);
 d:=replace(d, $a$ if not exists(select 1 from parent_players pp$a$, $a$ if nullif(input->'guest_data','null'::jsonb) is null and not exists(select 1 from parent_players pp$a$);
 d:=replace(d, ' data:=p.published;', $a$ data:=p.published;
 if (input->>'amount')::int<0 or (input->>'amount')::int>(data->'price'->>'amount')::int or (nullif(input->'discount','null'::jsonb) is not null and (input->'discount'->>'amount')::int is distinct from (input->>'amount')::int) then raise exception 'Rabattbetrag passt nicht';end if;$a$);
 d:=replace(d, 'customer_id,expected_amount,expected_subtotal,benefit_percent,currency,channel,camp_details)', 'customer_id,expected_amount,expected_subtotal,benefit_percent,currency,channel,camp_details,guest_data,guest_token_hash,discount)');
 d:=replace(d, $a$nullif(input->'camp_details','null'::jsonb)) returning * into prior;$a$, $a$nullif(input->'camp_details','null'::jsonb),nullif(input->'guest_data','null'::jsonb),input->>'guest_token_hash',nullif(input->'discount','null'::jsonb)) returning * into prior;$a$);
 if position('guest_token_hash,discount)' in d)=0 then raise exception 'Unexpected reservation baseline';end if;
 execute d;
end $$;
-- Preserve the existing fulfillment core; a wrapper adds paid guest materialisation atomically.
alter function public.fulfill_product_purchase(jsonb) rename to fulfill_product_purchase_before_guest;
revoke all on function public.fulfill_product_purchase_before_guest(jsonb) from public,anon,authenticated,service_role;
do $$ declare d text; begin
 d:=pg_get_functiondef('public.fulfill_product_purchase_before_guest(jsonb)'::regprocedure);
 d:=replace(d, 'auth_user_id=i.auth_id and archived_at', 'auth_user_id is not distinct from i.auth_id and archived_at');
 d:=replace(d, $a$proof->>'payment_status' is distinct from 'paid'$a$, $a$(proof->>'payment_status' is distinct from 'paid' and not coalesce(i.expected_amount=0 and i.discount is not null and proof->>'payment_status'='no_payment_required',false))$a$);
 -- The existing shared Camp routine already accepts a verified no-cost Checkout proof.
 d:=replace(d, $a$'payment_id',proof->>'payment_id','refunded',false$a$, $a$'payment_id',proof->>'payment_id','refunded',false,'proof_kind',case when i.expected_amount=0 and i.discount is not null then 'no_cost_checkout' else 'payment_intent' end$a$);
 execute d;
end $$;
create function public.fulfill_product_purchase(input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
declare i product_purchase_intents; proof jsonb:=input->'proof'; pid uuid; result jsonb; mail text;
begin
 select * into i from product_purchase_intents where id=(input->>'id')::uuid;
 if i.guest_data is null then return fulfill_product_purchase_before_guest(input);end if;
 perform pg_advisory_xact_lock(hashtext('family:'||lower(btrim(i.guest_data->>'email'))));
 select * into i from product_purchase_intents where id=(input->>'id')::uuid for update;
 if i.status='fulfilled' then return jsonb_build_object('id',i.id,'status','fulfilled');end if;
 -- Validate before creating a family, and again in the canonical core before granting any rights.
 if i.session_id is null or i.status not in('checkout','paid','reserved','failed') or
 proof->>'session_id' is distinct from i.session_id or (proof->>'livemode')::boolean is distinct from product_payment_livemode() or
 (i.product->'price'->>'livemode')::boolean is distinct from product_payment_livemode() or
 (proof->>'payment_status' is distinct from 'paid' and not coalesce(i.expected_amount=0 and i.discount is not null and proof->>'payment_status'='no_payment_required',false)) or
 proof->>'price_id' is distinct from i.product->'price'->>'id' or proof->>'product_id' is distinct from i.product->'price'->>'product_id' or
 proof->>'currency' is distinct from i.currency or (proof->>'total')::int is distinct from i.expected_amount or
 (proof->>'subtotal')::int is distinct from i.expected_subtotal or (proof->>'quantity')::int is distinct from 1 or
 coalesce(proof->>'payment_id','')='' or coalesce(proof->>'customer_id','')='' or proof->>'customer_id' is distinct from i.customer_id then raise exception 'Zahlungsnachweis passt nicht';end if;
 if i.parent_id is null then
  mail:=lower(btrim(i.guest_data->>'email'));
  perform pg_advisory_xact_lock(hashtext('family:'||mail));
  if exists(select 1 from parents where lower(btrim(contact_email))=mail) then
   update product_purchase_intents set status='review',proof=proof,payment_id=proof->>'payment_id',subscription_id=input->>'subscription_id',item_id=input->>'item_id',reason='Gastkauf: E-Mail bestätigen oder Familienzuordnung prüfen',updated_at=now() where id=i.id;
   insert into product_guest_messages(intent_id) values(i.id) on conflict do nothing;
   return jsonb_build_object('id',i.id,'status','review');
  end if;
  insert into parents(full_name,contact_email,phone,notifications_held) values(i.guest_data->>'full_name',mail,nullif(i.guest_data->>'phone',''),true) returning id into pid;
  insert into product_guest_families(parent_id,email) values(pid,mail);
  update product_purchase_intents set parent_id=pid where id=i.id;
  input:=input||jsonb_build_object('context_version',product_family_version(pid));
 end if;
 result:=fulfill_product_purchase_before_guest(input);
 if result->>'status' in('fulfilled','review') then
  insert into product_guest_messages(intent_id) values(i.id) on conflict do nothing;
 end if;
 return result;
end $$;
revoke all on function public.fulfill_product_purchase(jsonb) from public,anon,authenticated;
grant execute on function public.fulfill_product_purchase(jsonb) to service_role;
-- The verified session, not a browser email parameter, controls which purchases can be claimed.
create function public.claim_product_guest_orders() returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); mail text; pid uuid; f product_guest_families; i product_purchase_intents; kid uuid; matches int; ids jsonb:='[]';
begin
 select lower(btrim(email)) into mail from auth.users where id=uid and email_confirmed_at is not null;
 if uid is null or mail is null then raise exception 'Bestätigte Anmeldung erforderlich';end if;
 perform pg_advisory_xact_lock(hashtext('family:'||mail));
 if exists(select 1 from profiles where id=uid and role<>'parent') then return ids;end if;
 select id into pid from parents where auth_user_id=uid and archived_at is null;
 if pid is null then
  select g.* into f from product_guest_families g join parents p on p.id=g.parent_id where g.email=mail and p.auth_user_id is null and p.archived_at is null for update of p;
  if f.parent_id is not null then
   if exists(select 1 from parents where lower(btrim(contact_email))=mail and id<>f.parent_id and archived_at is null) then return ids;end if;
   insert into profiles(id,role,full_name) select uid,'parent',full_name from parents where id=f.parent_id on conflict(id) do nothing;
   update parents set auth_user_id=uid where id=f.parent_id and auth_user_id is null;
   update product_guest_families set claimed_at=now() where parent_id=f.parent_id;
   pid:=f.parent_id;
  end if;
 end if;
 if pid is null then return ids;end if;
 for i in select * from product_purchase_intents where lower(guest_data->>'email')=mail and auth_id is null and (status='fulfilled' or status='review' and reason='Gastkauf: E-Mail bestätigen oder Familienzuordnung prüfen') order by created_at for update loop
  if i.parent_id is not null and i.parent_id<>pid then continue;end if;
  kid:=null;
  if i.parent_id is null then
   select case when count(distinct candidate)=1 then min(candidate::text)::uuid end,count(distinct candidate) into kid,matches from (
    select k.id candidate from players k join parent_players pp on pp.player_id=k.id where pp.parent_id=pid and k.archived_at is null and lower(btrim(k.first_name))=lower(btrim(i.player_data->>'first_name')) and lower(btrim(k.last_name))=lower(btrim(i.player_data->>'last_name')) and k.camp_birth_date=(i.player_data->>'birth_date')::date
    union select t.id from trial_players t join trial_families tf on tf.id=t.family_id where tf.parent_id=pid and t.converted_at is null and lower(btrim(t.first_name))=lower(btrim(i.player_data->>'first_name')) and lower(btrim(t.last_name))=lower(btrim(i.player_data->>'last_name')) and t.birth_date=(i.player_data->>'birth_date')::date
   ) candidates;
   if matches>1 then continue;end if;
   -- Same-name ambiguous records need an explicit review; never create a silent duplicate.
   if kid is null and (
    exists(select 1 from players k join parent_players pp on pp.player_id=k.id where pp.parent_id=pid and lower(btrim(k.first_name))=lower(btrim(i.player_data->>'first_name')) and lower(btrim(k.last_name))=lower(btrim(i.player_data->>'last_name')))
    or exists(select 1 from trial_players t join trial_families tf on tf.id=t.family_id where tf.parent_id=pid and lower(btrim(t.first_name))=lower(btrim(i.player_data->>'first_name')) and lower(btrim(t.last_name))=lower(btrim(i.player_data->>'last_name')))
   ) then continue;end if;
  end if;
  update product_purchase_intents set parent_id=pid,auth_id=uid,player_id=coalesce(kid,player_id),player_data=case when kid is not null then null else player_data end,
   status=case when status='review' then 'checkout' else status end,reason=null,updated_at=now() where id=i.id;
  ids:=ids||jsonb_build_array(i.id);
 end loop;
 return ids;
end $$;
revoke all on function public.claim_product_guest_orders() from public,anon;
grant execute on function public.claim_product_guest_orders() to authenticated;
create function public.queue_product_guest_access(purchase uuid) returns void language sql security definer set search_path=public as $$
 insert into product_guest_messages(intent_id)
 select id from product_purchase_intents where id=purchase and guest_data is not null and proof is not null and status in('fulfilled','review')
 on conflict(intent_id) do update set status='pending',attempts=0,available_at=now()
 where product_guest_messages.status in('sent','failed') and coalesce(product_guest_messages.sent_at,product_guest_messages.available_at)<now()-interval '1 minute'
$$;
revoke all on function public.queue_product_guest_access(uuid) from public,anon,authenticated;
grant execute on function public.queue_product_guest_access(uuid) to service_role;
create function public.claim_product_guest_messages() returns setof product_guest_messages language sql security definer set search_path=public as $$
 update product_guest_messages set status='processing',attempts=attempts+1,locked_at=now(),lease_token=gen_random_uuid()
 where intent_id in(select intent_id from product_guest_messages where (status in('pending','failed') and available_at<=now() and attempts<8) or (status='processing' and locked_at<now()-interval '10 minutes') order by available_at limit 10 for update skip locked) returning *
$$;
revoke all on function public.claim_product_guest_messages() from public,anon,authenticated;
grant execute on function public.claim_product_guest_messages() to service_role;
-- Temporary capture data and browser secrets do not belong in permanent audit snapshots.
create function public.product_intent_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into audit_log(actor_id,actor_type,action,table_name,record_id,old_value,new_value,reason)
 values(auth.uid(),case when auth.uid() is null then 'systemjob' else 'user' end,TG_OP,TG_TABLE_NAME,coalesce(new.id,old.id),
 case when TG_OP<>'INSERT' then to_jsonb(old)-array['guest_data','guest_token_hash','player_data','camp_details'] end,
 case when TG_OP<>'DELETE' then to_jsonb(new)-array['guest_data','guest_token_hash','player_data','camp_details'] end,current_setting('app.audit_reason',true));
 return coalesce(new,old);
end $$;
revoke all on function public.product_intent_audit() from public,anon,authenticated,service_role;
drop trigger product_audit on public.product_purchase_intents;
create trigger product_audit after insert or update or delete on public.product_purchase_intents for each row execute function product_intent_audit();
-- Temporary, abandoned guest details have a limited lifetime; paid financial records are retained.
create function public.cleanup_product_guest_orders() returns int language plpgsql security definer set search_path=public as $$
declare n int; begin
 update product_purchase_intents set guest_data=jsonb_build_object('email','removed@expired.invalid','full_name','Abgebrochene Gastbestellung'),player_data=null,camp_details=null,guest_token_hash=repeat('0',64),status='expired'
 where guest_data is not null and guest_token_hash<>repeat('0',64) and proof is null and (status='expired' or status='reserved' and session_id is null) and created_at<now()-interval '2 days';
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.cleanup_product_guest_orders() from public,anon,authenticated;
grant execute on function public.cleanup_product_guest_orders() to service_role;
notify pgrst,'reload schema';
commit;
