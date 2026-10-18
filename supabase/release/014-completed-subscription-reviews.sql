-- Close stale review notices only when the mapping AND matching current allowance exist.
begin;
create function public.close_completed_subscription_reviews(sid uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
 update subscription_assignment_reviews r set status='resolved',resolved_player_id=m.player_id,resolved_at=now()
 from subscriptions s,subscription_players m,players child,plans tariff
 where r.subscription_id=sid and r.status='pending' and cardinality(r.previous_item_ids)=0
  and s.id=r.subscription_id and s.status in ('active','trialing')
  and m.subscription_id=s.id and m.stripe_item_id=r.stripe_item_id
  and child.id=m.player_id and child.archived_at is null
  and tariff.stripe_price_id=r.item->>'price_id' and tariff.active
  and coalesce((r.item->>'quantity')::int,1)=1
  and exists(select 1 from jsonb_array_elements(s.stripe_data->'items') i where i=r.item)
  and (r.item->>'starts_at')::timestamptz<=now() and (r.item->>'ends_at')::timestamptz>now()
  and exists(select 1 from entitlement_periods p where p.subscription_id=s.id and p.stripe_item_id=r.stripe_item_id
   and p.player_id=m.player_id and p.status='active' and p.stripe_price_id=tariff.stripe_price_id
   and p.included_units=tariff.included_units and p.starts_at<=now() and p.ends_at>now());
 get diagnostics affected=row_count;
 return affected;
end $$;
revoke all on function public.close_completed_subscription_reviews(uuid) from public,anon,authenticated,service_role;

create or replace function public.apply_stripe_package_sync(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare sid uuid; sub subscriptions; v_item jsonb; orphan_items text[]; suggested uuid[]; missing jsonb; old_mapping subscription_players;
begin
 perform pg_advisory_xact_lock(hashtext(input->>'stripe_subscription_id'));
 select * into sub from subscriptions where stripe_subscription_id=input->>'stripe_subscription_id' for update;
 if found and sub.synced_at>(input->>'retrieved_at')::timestamptz then return sub.id; end if;
 sid:=apply_stripe(input);
 select * into sub from subscriptions where id=sid;
 update subscription_assignment_reviews r set status='superseded',resolved_at=now()
  where r.subscription_id=sid and r.status='pending' and (sub.status not in ('active','trialing') or not exists(select 1 from jsonb_array_elements(input->'items') i where i->>'id'=r.stripe_item_id));
 if sub.status not in ('active','trialing') then return sid; end if;
 select coalesce(array_agg(m.stripe_item_id order by m.stripe_item_id),'{}'),coalesce(array_agg(m.player_id order by m.stripe_item_id),'{}') into orphan_items,suggested
  from subscription_players m where m.subscription_id=sid and not exists(select 1 from jsonb_array_elements(input->'items') i where i->>'id'=m.stripe_item_id);
 select coalesce(jsonb_agg(i),'[]') into missing from jsonb_array_elements(input->'items') i
  where not exists(select 1 from subscription_players m where m.subscription_id=sid and m.stripe_item_id=i->>'id');
 if cardinality(orphan_items)=1 and jsonb_array_length(missing)=1 and coalesce((missing->0->>'quantity')::int,1)=1
  and (missing->0->>'starts_at')::timestamptz<=now()
  and exists(select 1 from players where id=suggested[1] and archived_at is null) then
  v_item:=missing->0;
  update subscription_players set stripe_item_id=v_item->>'id' where subscription_id=sid and stripe_item_id=orphan_items[1];
  perform import_stripe_allowance(jsonb_build_object('subscription_id',sub.stripe_subscription_id,'item_id',v_item->>'id',
   'previous_item_id',orphan_items[1],'price_id',v_item->>'price_id','starts_at',v_item->>'starts_at','ends_at',v_item->>'ends_at'));
  update subscription_assignment_reviews set status='resolved',resolved_player_id=suggested[1],resolved_at=now()
   where subscription_id=sid and stripe_item_id=v_item->>'id' and status='pending';
 else
  for v_item in select value from jsonb_array_elements(missing) loop
   insert into subscription_assignment_reviews(subscription_id,stripe_item_id,item,previous_item_ids,suggested_player_ids,signature)
   values(sid,v_item->>'id',v_item,orphan_items,suggested,md5(v_item::text||orphan_items::text))
   on conflict(subscription_id,stripe_item_id) do update set item=excluded.item,previous_item_ids=excluded.previous_item_ids,
    suggested_player_ids=excluded.suggested_player_ids,signature=excluded.signature,status='pending',resolved_at=null,resolved_by=null,resolved_player_id=null;
  end loop;
 end if;
 -- Do not reactivate obsolete annual windows or a former child's entitlement.
 update entitlement_periods p set status=case when p.starts_at>now() then 'void' else 'suspended' end
  where p.subscription_id=sid and p.ends_at>now() and not exists(select 1 from subscription_players m
   where m.subscription_id=sid and m.stripe_item_id=p.stripe_item_id and m.player_id=p.player_id);
 update entitlement_periods p set status='void' where p.subscription_id=sid and p.starts_at>now() and not exists(
  select 1 from jsonb_array_elements(input->'items') i where i->>'id'=p.stripe_item_id and i->>'price_id'=p.stripe_price_id);
 perform public.close_completed_subscription_reviews(sid);
 if exists(select 1 from subscription_assignment_reviews where subscription_id=sid and status='pending') then
  update subscriptions set needs_review=true where id=sid;
 end if;
 return sid;
end $$;
revoke all on function public.apply_stripe_package_sync(jsonb) from public,anon,authenticated;
grant execute on function public.apply_stripe_package_sync(jsonb) to service_role;

create or replace function public.resolve_subscription_assignment(input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare review subscription_assignment_reviews; sub subscriptions; selected_player uuid:=(input->>'player_id')::uuid;
 old_item text:=nullif(input->>'previous_item_id',''); old_player uuid; existing_player uuid; current_item jsonb; plan_row plans;
begin
 if not public.is_admin() then raise exception 'Keine Berechtigung' using errcode='42501'; end if;
 -- Match the sync lock order: subscription advisory lock, subscription row, review.
 select s.* into sub from subscriptions s join subscription_assignment_reviews r on r.subscription_id=s.id where r.id=(input->>'review_id')::uuid;
 if not found then raise exception 'Prüfung nicht verfügbar'; end if;
 perform pg_advisory_xact_lock(hashtext(sub.stripe_subscription_id));
 select * into sub from subscriptions where id=sub.id for update;
 select * into review from subscription_assignment_reviews where id=(input->>'review_id')::uuid for update;
 if review.status='resolved' and review.signature=input->>'signature' and review.resolved_player_id=selected_player
  and exists(select 1 from subscription_players where subscription_id=sub.id and stripe_item_id=review.stripe_item_id and player_id=selected_player)
  and exists(select 1 from jsonb_array_elements(sub.stripe_data->'items') i where i=review.item)
  and sub.status in ('active','trialing') then return; end if;
 if review.status<>'pending' or review.signature is distinct from input->>'signature' then raise exception 'Die Zuordnung hat sich geändert. Bitte neu laden.'; end if;
 select value into current_item from jsonb_array_elements(sub.stripe_data->'items') where value->>'id'=review.stripe_item_id;
 if current_item is distinct from review.item or sub.status not in ('active','trialing') then raise exception 'Das Abo hat sich geändert. Bitte neu laden.'; end if;
 if (current_item->>'starts_at')::timestamptz>now() then raise exception 'Dieser Paketwechsel ist noch nicht wirksam.'; end if;
 if coalesce((current_item->>'quantity')::int,1)<>1 then raise exception 'Mehrere Plätze in einer Abo-Position müssen zuerst in Stripe getrennt werden.'; end if;
 select * into plan_row from plans where stripe_price_id=current_item->>'price_id' and active;
 if not found then raise exception 'Unbekannter Tarif. Bitte zuerst den Tarif zuordnen.'; end if;
 if plan_row.generation='legacy' and ((sub.stripe_data->>'subscription_created_at') is null or (sub.stripe_data->>'subscription_created_at')::timestamptz>=timestamptz '2026-09-01 00:00:00 Europe/Berlin') then raise exception 'Bestandstarif passt nicht zum Abobeginn.'; end if;
 if not exists(select 1 from players p where p.id=selected_player and p.archived_at is null and (
   p.id=any(review.suggested_player_ids) or exists(select 1 from parent_players pp where pp.player_id=p.id and (pp.parent_id=sub.parent_id or exists(select 1 from parent_stripe_customers c where c.parent_id=pp.parent_id and c.stripe_customer_id=sub.stripe_customer_id)))
 )) then raise exception 'Kind gehört nicht zur vorgeschlagenen Zuordnung oder Familie.'; end if;
 select player_id into existing_player from subscription_players where subscription_id=sub.id and stripe_item_id=review.stripe_item_id for update;
 if existing_player is not null then
  if existing_player<>selected_player then raise exception 'Diese Abo-Position ist bereits einem anderen Kind zugeordnet. Bitte die Liste neu laden und die bestehende Zuordnung prüfen.'; end if;
  if old_item is not null or cardinality(review.previous_item_ids)>0 then raise exception 'Die Zuordnung wurde bereits geändert. Bitte die Liste neu laden.'; end if;
 elsif old_item is not null then
  if not(old_item=any(review.previous_item_ids)) or exists(select 1 from jsonb_array_elements(sub.stripe_data->'items') i where i->>'id'=old_item) then raise exception 'Alte Abo-Position ist nicht ersetzbar.'; end if;
  select player_id into old_player from subscription_players where subscription_id=sub.id and stripe_item_id=old_item for update;
  if not found then raise exception 'Alte Zuordnung wurde bereits verändert.'; end if;
  update subscription_players set stripe_item_id=review.stripe_item_id,player_id=selected_player where subscription_id=sub.id and stripe_item_id=old_item;
 else
  if cardinality(review.previous_item_ids)>0 then raise exception 'Bitte die zu ersetzende Zuordnung auswählen.'; end if;
  insert into subscription_players(subscription_id,stripe_item_id,player_id) values(sub.id,review.stripe_item_id,selected_player);
 end if;
 perform import_stripe_allowance(jsonb_build_object('subscription_id',sub.stripe_subscription_id,'item_id',review.stripe_item_id,
  'previous_item_id',old_item,'price_id',current_item->>'price_id','starts_at',current_item->>'starts_at','ends_at',current_item->>'ends_at'));
 if old_player is not null and old_player<>selected_player then
  update entitlement_periods set status='suspended' where subscription_id=sub.id and player_id=old_player and stripe_item_id=old_item and ends_at>now();
 end if;
 update subscription_assignment_reviews set status='resolved',resolved_player_id=selected_player,resolved_by=auth.uid(),resolved_at=now() where id=review.id;
 -- Keep unrelated tariff/review flags intact. Further ambiguous rows remain open.
end $$;
revoke all on function public.resolve_subscription_assignment(jsonb) from public,anon,service_role;
grant execute on function public.resolve_subscription_assignment(jsonb) to authenticated;

-- One-time cleanup uses the same checks as future Stripe synchronization.
do $$ declare sid uuid; begin
 for sid in select distinct subscription_id from public.subscription_assignment_reviews where status='pending' loop
  perform pg_advisory_xact_lock(hashtext((select stripe_subscription_id from public.subscriptions where id=sid)));
  perform 1 from public.subscriptions where id=sid for update;
  perform public.close_completed_subscription_reviews(sid);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
