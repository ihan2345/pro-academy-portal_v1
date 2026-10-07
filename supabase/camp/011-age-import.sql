-- Age is a dated observation, never a fabricated date/year of birth.
-- Apply before deploying the updated portal and processing worker.
begin;
alter table public.players add column camp_age_at_booking int check(camp_age_at_booking between 0 and 99);
alter table public.players add column camp_age_recorded_on date;
alter table public.players add constraint camp_age_observation check((camp_age_at_booking is null)=(camp_age_recorded_on is null));

create function public.camp_import_authorized(input jsonb) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles where id=nullif(input->>'actor_id','')::uuid and role in ('admin','staff'))
 or (coalesce((input->>'automatic')::boolean,false) and exists(select 1 from camp_processing_lease where token=nullif(input->>'processing_token','')::uuid and expires_at>now()))
$$;

create function public.camp_name(value text) returns text language sql immutable as $$
 select lower(regexp_replace(btrim(value),'\s+',' ','g'))
$$;

-- A similarly aged child can be a typo/twin, not a provable new sibling.
create function public.camp_age_may_match(kid public.players, child jsonb) returns boolean language plpgsql stable set search_path=public as $$
declare observed date:=(child->>'age_recorded_on')::date; years int:=(child->>'age_at_booking')::int; earliest date; latest date;
begin
 if observed is null or years is null then return true; end if;
 if kid.camp_birth_date is not null then return extract(year from age(observed,kid.camp_birth_date))::int=years; end if;
 earliest:=(observed-make_interval(years=>years+1))::date+1;
 latest:=(observed-make_interval(years=>years))::date;
 if kid.birth_year is not null then return kid.birth_year between extract(year from earliest)::int and extract(year from latest)::int; end if;
 if kid.camp_age_recorded_on is not null then
  return earliest<=(kid.camp_age_recorded_on-make_interval(years=>kid.camp_age_at_booking))::date
   and latest>=(kid.camp_age_recorded_on-make_interval(years=>kid.camp_age_at_booking+1))::date+1;
 end if;
 return true;
end $$;

-- Validate against the known birthday, or all possible birthdays consistent with
-- the age observation. Only a team member may explicitly confirm a boundary case.
create function public.camp_import_child(input jsonb, kid public.players, c public.camps) returns jsonb language plpgsql set search_path=public as $$
declare child jsonb:=input->'child'; born date:=kid.camp_birth_date; observed date; years int; camp_start date; earliest date; latest date; youngest int; oldest int;
begin
 if born is not null and nullif(child->>'birth_date','')::date is not null and born<> (child->>'birth_date')::date then raise exception 'Bekanntes Geburtsdatum widerspricht den Angaben.'; end if;
 born:=coalesce(born,nullif(child->>'birth_date','')::date);
 observed:=nullif(child->>'age_recorded_on','')::date;
 years:=nullif(child->>'age_at_booking','')::int;
 select min((d->>'starts_at')::timestamptz at time zone 'Europe/Berlin')::date into camp_start from jsonb_array_elements(c.days) d;
 if camp_start is null then raise exception 'Campbeginn fehlt.'; end if;
 if born is null and years is null then raise exception 'Alter bei Buchung fehlt.'; end if;
 if years is not null then
  if years not between 0 and 99 or observed is null or observed>current_date then raise exception 'Alter oder Buchungsdatum ungültig.'; end if;
  if born is not null and extract(year from age(observed,born))::int<>years then raise exception 'Alter bei Buchung widerspricht dem bekannten Geburtsdatum.'; end if;
  earliest:=(observed-make_interval(years=>years+1))::date+1;
  latest:=(observed-make_interval(years=>years))::date;
  if born is null and kid.birth_year is not null then
   earliest:=greatest(earliest,make_date(kid.birth_year,1,1));
   latest:=least(latest,make_date(kid.birth_year,12,31));
   if earliest>latest then raise exception 'Alter bei Buchung widerspricht dem bekannten Geburtsjahr.'; end if;
  end if;
  if born is null and kid.camp_age_at_booking is not null then
   earliest:=greatest(earliest,(kid.camp_age_recorded_on-make_interval(years=>kid.camp_age_at_booking+1))::date+1);
   latest:=least(latest,(kid.camp_age_recorded_on-make_interval(years=>kid.camp_age_at_booking))::date);
   if earliest>latest then raise exception 'Alter widerspricht der bisherigen Altersangabe.'; end if;
  end if;
 end if;
 if born is not null then
  youngest:=extract(year from age(camp_start,born)); oldest:=youngest;
  if born>current_date then raise exception 'Geburtsdatum liegt in der Zukunft.'; end if;
 else
  youngest:=extract(year from age(camp_start,latest)); oldest:=extract(year from age(camp_start,earliest));
 end if;
 if oldest<c.min_age or youngest>c.max_age then raise exception 'Alter passt nicht zum Altersbereich des Camps.'; end if;
 if (youngest<c.min_age or oldest>c.max_age) and (coalesce((input->>'automatic')::boolean,false) or not coalesce((input->>'age_range_confirmed')::boolean,false)) then
  raise exception 'Altersgrenze zum Campbeginn unklar. Bitte prüfen und bestätigen.';
 end if;
 if kid.camp_gender is not null and child->>'gender'='keine Angabe' then child:=child||jsonb_build_object('gender',kid.camp_gender); end if;
 return (child-'birth_date') || case when born is not null then jsonb_build_object('birth_date',born) else '{}'::jsonb end;
end $$;

-- Keep all existing payment, capacity, retry and source checks in the importer.
do $$
declare definition text; original text;
begin
 select pg_get_functiondef('public.camp_import_paid_booking(jsonb)'::regprocedure) into definition;
 original:=definition;
 definition:=replace(definition,
  'if not exists(select 1 from public.profiles where id=(input->>''actor_id'')::uuid and role in (''admin'',''staff'')) then raise exception ''Academy team required''; end if;',
  'if not public.camp_import_authorized(input) then raise exception ''Academy team required''; end if;');
 if definition=original then raise exception 'Unexpected import authorization; migration aborted'; end if;
 original:=definition;
 definition:=replace(definition,$old$ born:=nullif(input->'child'->>'birth_date','')::date;
 if born is null then raise exception 'Birth date required'; end if;
 select min((value->>'starts_at')::timestamptz at time zone 'Europe/Berlin')::date into camp_start from jsonb_array_elements(c.days);
 age_years:=extract(year from age(camp_start,born));
 if born>current_date or age_years<c.min_age or age_years>c.max_age then raise exception 'Birth date outside Camp age range'; end if;$old$,
 $new$ input:=jsonb_set(input,'{child}',public.camp_import_child(input,kid,c));
 born:=nullif(input->'child'->>'birth_date','')::date;$new$);
 if definition=original then raise exception 'Unexpected import age validation; migration aborted'; end if;
 original:=definition;
 definition:=replace(definition,'update public.players set camp_birth_date=born,camp_gender=input->''child''->>''gender'',camp_clothing_size=input->''child''->>''clothing_size'' where id=player;',
 $new$update public.players set camp_birth_date=coalesce(camp_birth_date,born),
 camp_age_at_booking=case when nullif(input->'child'->>'age_at_booking','') is not null and (camp_age_recorded_on is null or camp_age_recorded_on<=(input->'child'->>'age_recorded_on')::date) then (input->'child'->>'age_at_booking')::int else camp_age_at_booking end,
 camp_age_recorded_on=case when nullif(input->'child'->>'age_at_booking','') is not null and (camp_age_recorded_on is null or camp_age_recorded_on<=(input->'child'->>'age_recorded_on')::date) then (input->'child'->>'age_recorded_on')::date else camp_age_recorded_on end,
 camp_gender=case when input->'child'->>'gender'='keine Angabe' then coalesce(camp_gender,'keine Angabe') else input->'child'->>'gender' end,
 camp_clothing_size=input->'child'->>'clothing_size' where id=player;
 insert into audit_log(actor_id,actor_type,action,table_name,record_id,new_value) values(nullif(input->>'actor_id','')::uuid,case when coalesce((input->>'automatic')::boolean,false) then 'system' else 'user' end,'CAMP_STRIPE_IMPORT','camp_bookings',result,jsonb_build_object('automatic',coalesce((input->>'automatic')::boolean,false),'player_id',player,'parent_id',pid));$new$);
 if definition=original then raise exception 'Unexpected import child update; migration aborted'; end if;
 execute definition;
end $$;

-- Resolve identity and create the family/child atomically with payment import.
create or replace function public.camp_import_review_booking(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare pid uuid:=nullif(input->>'parent_id','')::uuid; kid uuid:=nullif(input->>'player_id','')::uuid; rid uuid; result uuid;
 email text:=lower(btrim(coalesce(input->'new_parent'->>'email',input->'parent'->>'email'))); customer text:=nullif(input->>'customer_id','');
 prior camp_bookings; family parents; candidates uuid[]; customer_families uuid[]; email_families uuid[]; children uuid[];
 automatic boolean:=coalesce((input->>'automatic')::boolean,false); full_name text:=camp_name((input->'child'->>'first_name')||' '||(input->'child'->>'last_name'));
begin
 if not camp_import_authorized(input) then raise exception 'Academy team required'; end if;
 perform 1 from camps where id=(input->>'camp_id')::uuid for update;
 if not found then raise exception 'Camp missing'; end if;
 if automatic and not exists(select 1 from camps where id=(input->>'camp_id')::uuid and payment_mode='live') then raise exception 'Live Camp required'; end if;
 perform pg_advisory_xact_lock(hashtext('camp-import:'||(input->>'payment_id')));
 select * into prior from camp_bookings where stripe_payment_id=input->>'payment_id';
 if found then
  if prior.camp_id<>(input->>'camp_id')::uuid or prior.booking_origin<>'stripe_import' or prior.stripe_session_id<>input->>'session_id' then raise exception 'Payment already assigned differently'; end if;
  if not automatic and ((pid is not null and pid<>prior.parent_id) or (kid is not null and kid<>prior.player_id)) then raise exception 'Payment already assigned differently'; end if;
  return prior.id;
 end if;
 if automatic and exists(select 1 from camp_review_drafts where payment_id=input->>'payment_id') then raise exception 'Gespeicherter Prüfentwurf vorhanden. Bitte manuell übernehmen.'; end if;
 -- Serialize family creation and matching with ordinary inserts/updates as well.
 lock table parents in share row exclusive mode;
 lock table players in share row exclusive mode;
 if automatic then
  if coalesce(email,'') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' or coalesce(btrim(input->'parent'->>'name'),'')='' then raise exception 'Elternname oder E-Mail fehlt.'; end if;
  select array_agg(distinct id) into customer_families from (
   select id from parents where stripe_customer_id=customer
   union select parent_id from parent_stripe_customers where stripe_customer_id=customer
  ) x;
  select array_agg(id) into email_families from parents where lower(btrim(contact_email))=email;
  select array_agg(distinct id) into candidates from unnest(coalesce(customer_families,'{}'::uuid[])||coalesce(email_families,'{}'::uuid[])) id;
  if cardinality(candidates)>1 then raise exception 'Familie nicht eindeutig: Stripe-Kunde und E-Mail prüfen.'; end if;
  pid:=candidates[1];
  if pid is null and (exists(select 1 from parents where camp_name(parents.full_name)=camp_name(input->'parent'->>'name'))
    or exists(select 1 from players where camp_name(first_name||' '||last_name)=full_name)) then
   raise exception 'Familie nicht eindeutig erkannt. Bekannten Namen mit neuer E-Mail oder Stripe-Zuordnung prüfen.';
  end if;
  if pid is not null then
   select * into family from parents where id=pid;
   if family.archived_at is not null then raise exception 'Familie ist archiviert. Bitte Zuordnung prüfen.'; end if;
   select array_agg(p.id) into children from players p join parent_players pp on pp.player_id=p.id where pp.parent_id=pid and camp_name(p.first_name||' '||p.last_name)=full_name;
   if cardinality(children)>1 then raise exception 'Kindesname mehrfach vorhanden. Bitte Kind auswählen.'; end if;
   kid:=children[1];
   if kid is not null then
    if exists(select 1 from players where id=kid and archived_at is not null) then raise exception 'Kind ist archiviert. Bitte Zuordnung prüfen.'; end if;
    -- Preserve canonical spelling and compound first/last names on an exact full-name match.
    select jsonb_set(input,'{child}',input->'child'||jsonb_build_object('first_name',first_name,'last_name',last_name)) into input from players where id=kid;
   elsif exists(select 1 from players p join parent_players pp on pp.player_id=p.id where pp.parent_id=pid and (
    split_part(camp_name(p.first_name),' ',1)=split_part(full_name,' ',1)
    or left(camp_name(p.first_name),3)=left(full_name,3)
    or camp_age_may_match(p,input->'child')
    or (camp_name(p.last_name)<>camp_name(input->'child'->>'last_name'))
   )) then
    raise exception 'Kind nicht eindeutig erkannt. Neues Geschwisterkind oder abweichenden Namen prüfen.';
   end if;
  end if;
 elsif input->'new_parent' is not null and input->'new_parent'<>'null'::jsonb then
  if pid is not null or kid is not null then raise exception 'Choose existing or new family'; end if;
  if exists(select 1 from parents where lower(btrim(contact_email))=email) then raise exception 'Existing contact: select family instead'; end if;
  if customer is not null and (exists(select 1 from parent_stripe_customers where stripe_customer_id=customer) or exists(select 1 from parents where stripe_customer_id=customer)) then raise exception 'Stripe customer already assigned'; end if;
 elsif pid is null or (kid is null and not coalesce((input->>'new_child')::boolean,false)) then
  raise exception 'Vorhandene Familie und Kind auswählen.';
 end if;
 if pid is null then
  if coalesce(email,'') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'Parent details missing'; end if;
  insert into parents(full_name,contact_email,notifications_held) values(coalesce(input->'new_parent'->>'name',input->'parent'->>'name'),email,true) returning id into pid;
  insert into camp_owned_rows values('parents',pid);
 end if;
 select * into family from parents where id=pid and archived_at is null;
 if not found then raise exception 'Aktive Familie fehlt.'; end if;
 if kid is null then
  if exists(select 1 from players p join parent_players pp on pp.player_id=p.id where pp.parent_id=pid and camp_name(p.first_name||' '||p.last_name)=full_name) then raise exception 'Kind bereits vorhanden. Bitte vorhandenes Kind zuordnen.'; end if;
  insert into players(first_name,last_name,birth_year) values(input->'child'->>'first_name',input->'child'->>'last_name',extract(year from nullif(input->'child'->>'birth_date','')::date)::int) returning id into kid;
  insert into camp_owned_rows values('players',kid);
  insert into parent_players(parent_id,player_id) values(pid,kid) returning id into rid;
  insert into camp_owned_rows values('parent_players',rid);
 end if;
 if automatic then
  -- Classify the matched child without claiming that today's benefit was applied to this payment.
  input:=input||jsonb_build_object('customer_group',case
   when exists(select 1 from subscription_players sp join subscriptions s on s.id=sp.subscription_id where sp.player_id=kid and s.status='active')
    or exists(select 1 from entitlement_periods ep join subscriptions s on s.id=ep.subscription_id where ep.player_id=kid and ep.status='active' and s.status='active' and ep.starts_at<=now() and ep.ends_at>now()) then 'subscriber'
   when exists(select 1 from subscription_players where player_id=kid) then 'former' else 'new' end);
 end if;
 result:=camp_import_paid_booking(input || jsonb_build_object('parent_id',pid,'player_id',kid,'parent',jsonb_build_object('name',family.full_name,'email',family.contact_email,'phone',coalesce(input->'new_parent'->>'phone',input->'parent'->>'phone',''))));
 if customer is not null then
  if exists(select 1 from parent_stripe_customers where stripe_customer_id=customer and parent_id<>pid) or exists(select 1 from parents where stripe_customer_id=customer and id<>pid) then raise exception 'Stripe customer already assigned'; end if;
  insert into parent_stripe_customers(parent_id,stripe_customer_id) values(pid,customer) on conflict do nothing returning id into rid;
  if rid is not null then insert into camp_owned_rows values('parent_stripe_customers',rid); end if;
 end if;
 return result;
end $$;
revoke all on function public.camp_import_authorized(jsonb),public.camp_import_child(jsonb,public.players,public.camps),public.camp_age_may_match(public.players,jsonb),public.camp_import_review_booking(jsonb),public.camp_import_paid_booking(jsonb) from public,anon,authenticated;
grant execute on function public.camp_import_review_booking(jsonb),public.camp_import_paid_booking(jsonb) to service_role;
-- Local reset only; its existing prohibition on real bookings remains in force.
do $$ declare definition text; begin
 select pg_get_functiondef('public.camp_reset_v0()'::regprocedure) into definition;
 definition:=replace(definition,'drop function if exists public.camp_import_review_booking(jsonb);','drop function if exists public.camp_age_may_match(public.players,jsonb);
 drop function if exists public.camp_import_child(jsonb,public.players,public.camps);
 drop function if exists public.camp_import_authorized(jsonb);
 drop function if exists public.camp_name(text);
 alter table public.players drop column camp_age_at_booking,drop column camp_age_recorded_on;
 drop function if exists public.camp_import_review_booking(jsonb);');
 execute definition;
end $$;
commit;
