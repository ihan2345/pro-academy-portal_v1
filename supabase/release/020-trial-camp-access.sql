-- Existing camp access plus a temporary trial section. Apply after 019 and camp 013.
-- Does not enable payments, jobs or the trial feature.
begin;
alter table trial_players add column camp_player_id uuid references players(id);

-- Camp membership alone never means that a recurring training subscription was assigned.
create or replace function trial_account_state() returns text language sql stable security definer set search_path=public as $$
 with family as(select f.* from trial_families f join parents p on p.id=f.parent_id where p.auth_user_id=auth.uid()),
 normal as(select exists(select 1 from parent_players pp join parents p on p.id=pp.parent_id where p.auth_user_id=auth.uid() and (
 exists(select 1 from subscription_players s where s.player_id=pp.player_id) or exists(select 1 from entitlement_periods e where e.player_id=pp.player_id)))
 or exists(select 1 from trial_players t join family f on f.id=t.family_id where t.converted_at is not null) regular)
 select case when exists(select 1 from trial_players t join family f on f.id=t.family_id where t.converted_at is null and f.stopped_at is null and f.created_at+interval '180 days'>now())
 then case when normal.regular then 'mixed' else 'trial' end
 when exists(select 1 from family) and normal.regular then 'subscriber' else 'none' end from normal
$$;

create view trial_camp_children with(security_invoker=true) as
 select p.id,f.parent_id,p.first_name,p.last_name,extract(year from p.birth_date)::int birth_year,p.birth_date camp_birth_date,
 coalesce(k.camp_gender,p.gender,'keine Angabe') camp_gender,coalesce(k.camp_clothing_size,'') camp_clothing_size,
 null::timestamptz archived_at,true trial
 from trial_players p join trial_families f on f.id=p.family_id left join players k on k.id=p.camp_player_id
 where p.converted_at is null and f.stopped_at is null and f.created_at+interval '180 days'>now();
revoke all on trial_camp_children from public,anon,authenticated;
grant select on trial_camp_children to service_role;

-- The legacy camp module references players. Reuse the SAME UUID only when a camp
-- booking is created; this is a camp identity bridge, never an Abo conversion.
create function prepare_trial_camp_player(parent uuid,child uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare p trial_players; f trial_families;
begin
 select * into p from trial_players where id=child for update;
 if p.id is null then raise exception 'Probetraining-Kind fehlt';end if;
 select * into f from trial_families where id=p.family_id for update;
 if f.parent_id is distinct from parent or f.stopped_at is not null or f.created_at+interval '180 days'<=now() then raise exception 'Probetraining-Familie passt nicht';end if;
 if exists(select 1 from players where id=p.id) then
  if not exists(select 1 from parent_players where parent_id=parent and player_id=p.id) or (p.camp_player_id is distinct from p.id and p.converted_player_id is distinct from p.id) then raise exception 'Kinderidentität bereits anders verknüpft';end if;
  return p.id;
 end if;
 insert into players(id,first_name,last_name,birth_year,camp_birth_date,team,gender,club,position,strong_foot,height_cm,development_goals)
 values(p.id,p.first_name,p.last_name,extract(year from p.birth_date),p.birth_date,p.team,p.gender,p.club,p.position,p.strong_foot,p.height_cm,p.development_goals);
 insert into parent_players(parent_id,player_id) values(parent,p.id);
 update trial_players set camp_player_id=p.id where id=p.id;
 return p.id;
end $$;
revoke all on function prepare_trial_camp_player(uuid,uuid) from public,anon,authenticated;
grant execute on function prepare_trial_camp_player(uuid,uuid) to service_role;

create function trial_camp_booking_identity() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.player_id is not null and exists(select 1 from trial_players where id=new.player_id and converted_at is null) then
  if not exists(select 1 from players k join parent_players pp on pp.player_id=k.id where k.id=new.player_id and pp.parent_id=new.parent_id) then
   perform prepare_trial_camp_player(new.parent_id,new.player_id);
  end if;
 end if;
 return new;
end $$;
create trigger trial_camp_identity before insert or update of player_id,parent_id on camp_bookings for each row execute function trial_camp_booking_identity();

create function sync_trial_camp_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.camp_player_id is not null and new.converted_at is null then
  update players set first_name=new.first_name,last_name=new.last_name,birth_year=extract(year from new.birth_date),camp_birth_date=new.birth_date,
  team=new.team,gender=new.gender,club=new.club,position=new.position,strong_foot=new.strong_foot,height_cm=new.height_cm,development_goals=new.development_goals
  where id=new.camp_player_id and (first_name,last_name,birth_year,camp_birth_date,team,gender,club,position,strong_foot,height_cm,development_goals)
  is distinct from (new.first_name,new.last_name,extract(year from new.birth_date)::int,new.birth_date,new.team,new.gender,new.club,new.position,new.strong_foot,new.height_cm,new.development_goals);
 end if;
 return new;
end $$;
create trigger trial_camp_profile_sync after update of first_name,last_name,birth_date,team,gender,club,position,strong_foot,height_cm,development_goals on trial_players for each row execute function sync_trial_camp_profile();

-- Changes made through the ordinary camp-family profile keep the same trial identity current.
create function sync_camp_trial_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from trial_players where camp_player_id=new.id and converted_at is null) then
  if new.camp_birth_date is null or new.birth_year is distinct from extract(year from new.camp_birth_date)::int then raise exception 'Geburtsjahr und Geburtsdatum müssen übereinstimmen. Bitte Datum im Probetraining-Profil prüfen.';end if;
  update trial_players set first_name=new.first_name,last_name=new.last_name,birth_date=new.camp_birth_date,team=new.team,gender=new.gender,
  club=coalesce(new.club,''),position=new.position,strong_foot=new.strong_foot,height_cm=new.height_cm,development_goals=new.development_goals,updated_at=now()
  where camp_player_id=new.id and converted_at is null and (first_name,last_name,birth_date,team,gender,club,position,strong_foot,height_cm,development_goals)
  is distinct from (new.first_name,new.last_name,new.camp_birth_date,new.team,new.gender,coalesce(new.club,''),new.position,new.strong_foot,new.height_cm,new.development_goals);
 end if;
 return new;
end $$;
create trigger camp_trial_profile_sync after update of first_name,last_name,birth_year,camp_birth_date,team,gender,club,position,strong_foot,height_cm,development_goals on players for each row execute function sync_camp_trial_profile();

-- Manual/automatic payment imports resolve a known trial child before the old code
-- creates a new child. Existing payment, age, capacity and discount checks stay intact.
do $$ declare d text; before_text text; after_text text; begin
 select pg_get_functiondef('public.camp_import_review_booking(jsonb)'::regprocedure) into d;
 before_text:=$before$ if kid is null then
  if exists(select 1 from players p join parent_players pp$before$;
 after_text:=$after$ if kid is null then
  select array_agg(t.id) into children from trial_camp_children t where t.parent_id=pid and camp_name(t.first_name||' '||t.last_name)=full_name;
  if cardinality(children)>1 then raise exception 'Probetraining-Kind nicht eindeutig';end if;
  if cardinality(children)=1 then kid:=prepare_trial_camp_player(pid,children[1]);end if;
 elsif exists(select 1 from trial_camp_children where id=kid and parent_id=pid) then
  perform prepare_trial_camp_player(pid,kid);
 end if;
 if kid is null then
  if exists(select 1 from players p join parent_players pp$after$;
 if position(before_text in d)=0 then raise exception 'Unexpected Camp review importer';end if;
 execute replace(d,before_text,after_text);
 -- 100% and manually approved discounted checkouts use the same identity bridge.
 select pg_get_functiondef('public.camp_approve_free_booking(jsonb)'::regprocedure) into d;
 before_text:=$before$ if player is null then
  if exists(select 1 from players p join parent_players pp$before$;
 after_text:=$after$ if player is null then
  select t.id into player from trial_camp_children t where t.parent_id=pid and camp_name(t.first_name||' '||t.last_name)=camp_name((input->'child'->>'first_name')||' '||(input->'child'->>'last_name'));
  if player is not null then perform prepare_trial_camp_player(pid,player);end if;
 elsif exists(select 1 from trial_camp_children where id=player and parent_id=pid) then
  perform prepare_trial_camp_player(pid,player);
 end if;
 if player is null then
  if exists(select 1 from players p join parent_players pp$after$;
 if position(before_text in d)=0 then raise exception 'Unexpected Camp free-booking approval';end if;
 execute replace(d,before_text,after_text);
end $$;
create or replace function public.trial_convert_for_review(input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare p trial_players; f trial_families; sub subscriptions; review subscription_assignment_reviews;
begin
 if not is_admin() then raise exception 'Keine Berechtigung'; end if;
 select * into p from trial_players where id=(input->>'player_id')::uuid for update;
 if p.id is null or p.converted_player_id is not null then return; end if;
 select * into f from trial_families where id=p.family_id for update;
 select * into review from subscription_assignment_reviews where id=(input->>'review_id')::uuid for update;
 select * into sub from subscriptions where id=review.subscription_id for update;
 if review.signature is distinct from input->>'signature' or review.status<>'pending' or sub.status not in ('active','trialing') then raise exception 'Abo-Zuordnung hat sich geändert'; end if;
 if f.stopped_at is not null then raise exception 'Probefamilie beendet'; end if;
 if not (
  sub.parent_id=f.parent_id or exists(select 1 from parent_stripe_customers where parent_id=f.parent_id and stripe_customer_id=sub.stripe_customer_id)
  or exists(select 1 from stripe_customer_registry where id=sub.stripe_customer_id and lower(trim(email))=lower(trim(f.email)))
 ) and length(trim(coalesce(input->>'manual_trial_reason','')))<10 then raise exception 'Probefamilie passt nicht eindeutig zum Stripe-Kunden'; end if;
 if sub.parent_id is not null and sub.parent_id<>f.parent_id then raise exception 'Stripe-Kunde ist bereits einer anderen Familie zugeordnet'; end if;
 if exists(select 1 from parent_stripe_customers where stripe_customer_id=sub.stripe_customer_id and parent_id<>f.parent_id) then raise exception 'Stripe-Kunde gehört bereits zu einer anderen Familie'; end if;
 perform set_config('app.audit_reason','Probetraining übernehmen: '||coalesce(input->>'manual_trial_reason','Bestätigte Familienzuordnung'),true);
 if exists(select 1 from players where id=p.id) and p.camp_player_id is distinct from p.id then raise exception 'Vorhandenes Profil ist nicht eindeutig als Camp-Profil verknüpft';end if;
 insert into players(id,first_name,last_name,birth_year,camp_birth_date,team,gender,club,position,strong_foot,height_cm,development_goals)
 values(p.id,p.first_name,p.last_name,extract(year from p.birth_date),p.birth_date,p.team,p.gender,p.club,p.position,p.strong_foot,p.height_cm,p.development_goals)
 on conflict(id) do update set first_name=excluded.first_name,last_name=excluded.last_name,birth_year=excluded.birth_year,camp_birth_date=excluded.camp_birth_date,team=excluded.team,gender=excluded.gender,club=excluded.club,position=excluded.position,strong_foot=excluded.strong_foot,height_cm=excluded.height_cm,development_goals=excluded.development_goals;
 insert into parent_players(parent_id,player_id) values(f.parent_id,p.id) on conflict do nothing;
 insert into parent_stripe_customers(parent_id,stripe_customer_id) values(f.parent_id,sub.stripe_customer_id) on conflict do nothing;
 update subscriptions set parent_id=f.parent_id where id=sub.id;
 update parents set notifications_held=false where id=f.parent_id and f.email_verified_at is not null and exists(select 1 from auth.users u where u.id=parents.auth_user_id and u.email_confirmed_at is not null);
 update trial_players set converted_player_id=p.id,converted_at=now() where id=p.id;
end $$;
-- An abandoned unpaid checkout must not preserve an unsuccessful trial forever.
create function cleanup_trial_camp_drafts(family uuid) returns void language plpgsql security definer set search_path=public as $$
declare p trial_players; bookings uuid[]; links uuid[];
begin
 for p in select * from trial_players where family_id=family and camp_player_id is not null and converted_player_id is null and converted_at is null for update loop
  if exists(select 1 from camp_bookings where player_id=p.id and (status<>'draft' or paid_at is not null or stripe_session_id is not null or stripe_payment_id is not null))
   or exists(select 1 from subscription_players where player_id=p.id) or exists(select 1 from entitlement_periods where player_id=p.id)
   or exists(select 1 from event_participants where player_id=p.id) or exists(select 1 from training_backfills where player_id=p.id)
   or exists(select 1 from report_snapshots where player_id=p.id) then continue;end if;
  select array_agg(id) into bookings from camp_bookings where player_id=p.id;
  delete from camp_bookings where id=any(bookings);
  select array_agg(id) into links from parent_players where player_id=p.id;
  delete from parent_players where id=any(links);
  update trial_players set camp_player_id=null where id=p.id;
  delete from players where id=p.id;
  delete from audit_log where (table_name='camp_bookings' and record_id=any(bookings)) or (table_name='parent_players' and record_id=any(links)) or (table_name='players' and record_id=p.id);
 end loop;
end $$;
revoke all on function cleanup_trial_camp_drafts(uuid) from public,anon,authenticated;
grant execute on function cleanup_trial_camp_drafts(uuid) to service_role;
do $$ declare d text; marker text:=$marker$  select array_agg(id) into children from trial_players where family_id=f.id and converted_player_id is null;$marker$; begin
 select pg_get_functiondef('public.cleanup_trial_data()'::regprocedure) into d;
 if position(marker in d)=0 then raise exception 'Unexpected Trial retention function';end if;
 execute replace(d,marker,'  perform cleanup_trial_camp_drafts(f.id);'||chr(10)||marker);
end $$;

-- Closing the trial section must not remove a paying family's camp account/history.
-- Release 019's cleanup already preserves players/parents linked to camp bookings.
notify pgrst,'reload schema';
commit;
