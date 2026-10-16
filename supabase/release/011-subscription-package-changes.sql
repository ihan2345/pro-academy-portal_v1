-- Local implementation; apply deliberately after review. No Stripe mutations.
begin;
create table public.entitlement_package_revisions (
 id uuid primary key default gen_random_uuid(),
 period_id uuid not null references public.entitlement_periods(id),
 before_state jsonb not null,
 after_state jsonb not null,
 transaction_id bigint not null default txid_current(),
 created_at timestamptz not null default now()
);
alter table public.entitlement_package_revisions enable row level security;
revoke all on public.entitlement_package_revisions from public,anon,authenticated,service_role;
grant select on public.entitlement_package_revisions to service_role;

create table public.subscription_assignment_reviews (
 id uuid primary key default gen_random_uuid(),
 subscription_id uuid not null references public.subscriptions(id),
 stripe_item_id text not null,
 item jsonb not null,
 previous_item_ids text[] not null default '{}',
 suggested_player_ids uuid[] not null default '{}',
 signature text not null,
 status text not null default 'pending' check(status in ('pending','resolved','superseded')),
 resolved_player_id uuid references public.players(id),
 resolved_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 unique(subscription_id,stripe_item_id)
);
alter table public.subscription_assignment_reviews enable row level security;
revoke all on public.subscription_assignment_reviews from public,anon,authenticated,service_role;
grant select on public.subscription_assignment_reviews to service_role;
create trigger audit_change after insert or update on public.subscription_assignment_reviews for each row execute function public.audit_change();

-- Only the exact, transaction-local revision prepared by the restricted routine
-- can change a live entitlement. Direct and historical edits remain forbidden.
create or replace function public.freeze_period() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (to_jsonb(new)-'updated_at'-'status') is distinct from (to_jsonb(old)-'updated_at'-'status') then
  if old.ends_at<=now() or not exists (
   select 1 from entitlement_package_revisions r
   where r.id::text=current_setting('app.package_revision',true)
    and r.period_id=old.id and r.transaction_id=txid_current()
    and r.before_state-'updated_at'-'status'=to_jsonb(old)-'updated_at'-'status'
    and r.after_state-'updated_at'-'status'=to_jsonb(new)-'updated_at'-'status'
  ) then raise exception 'Historical entitlement periods are immutable'; end if;
 end if;
 return new;
end $$;

-- Preserve the established renewal / annual allowance implementation.
alter function public.import_stripe_allowance(jsonb) rename to import_stripe_allowance_before_package_changes;
revoke all on function public.import_stripe_allowance_before_package_changes(jsonb) from public,anon,authenticated,service_role;
create function public.import_stripe_allowance(input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare sub subscriptions; mapping subscription_players; tariff plans; current_period entitlement_periods;
 win record; next_state jsonb; revision_id uuid; latest_item jsonb; source_item text; applicable boolean;
begin
 select * into sub from subscriptions where stripe_subscription_id=input->>'subscription_id' for update;
 if not found then raise exception 'Abonnement nicht synchronisiert'; end if;
 select * into mapping from subscription_players where subscription_id=sub.id and stripe_item_id=input->>'item_id';
 if not found then return; end if;
 select * into tariff from plans where stripe_price_id=input->>'price_id' and active;
 if not found then update subscriptions set needs_review=true where id=sub.id; return; end if;
 if tariff.generation='legacy' and ((sub.stripe_data->>'subscription_created_at') is null or (sub.stripe_data->>'subscription_created_at')::timestamptz>=timestamptz '2026-09-01 00:00:00 Europe/Berlin') then
  update subscriptions set needs_review=true where id=sub.id; return;
 end if;
 select value into latest_item from jsonb_array_elements(sub.stripe_data->'items') where value->>'id'=input->>'item_id';
 if coalesce((latest_item->>'quantity')::int,1)<>1 then update subscriptions set needs_review=true where id=sub.id; return; end if;
 source_item:=coalesce(input->>'previous_item_id',input->>'item_id');
 applicable:=sub.status in ('active','trialing') and latest_item->>'price_id'=input->>'price_id';
 for win in select * from allowance_windows((input->>'starts_at')::timestamptz,(input->>'ends_at')::timestamptz,tariff.billing_interval) loop
  current_period:=null;
  if applicable and win.ends_at>now() then
   select * into current_period from entitlement_periods where subscription_id=sub.id and player_id=mapping.player_id
    and stripe_item_id in (source_item,input->>'item_id') and ends_at>now()
    and ((win.starts_at<=now() and starts_at<=now()) or (win.starts_at>now() and starts_at=win.starts_at))
    and starts_at<win.ends_at and ends_at>win.starts_at
    order by (stripe_item_id=source_item) desc, starts_at desc limit 1 for update;
   if found then
    if current_period.stripe_item_id<>input->>'item_id' or current_period.stripe_price_id<>input->>'price_id' then
     next_state:=to_jsonb(current_period)||jsonb_build_object('stripe_item_id',input->>'item_id','stripe_price_id',input->>'price_id',
      'product_name',tariff.name,'included_units',tariff.included_units,'athletics_units',tariff.athletics_units,
      'tariff_generation',tariff.generation,'ends_at',win.ends_at);
     insert into entitlement_package_revisions(period_id,before_state,after_state) values(current_period.id,to_jsonb(current_period),next_state) returning id into revision_id;
     perform set_config('app.package_revision',revision_id::text,true);
     perform set_config('app.audit_reason','Sofortiger Paketwechsel; Einheiten bleiben dem Leistungszeitraum zugeordnet',true);
     update entitlement_periods set stripe_item_id=input->>'item_id',stripe_price_id=input->>'price_id',product_name=tariff.name,
      included_units=tariff.included_units,athletics_units=tariff.athletics_units,tariff_generation=tariff.generation,ends_at=win.ends_at,status=sub.status
      where id=current_period.id;
     perform set_config('app.package_revision','',true);
    elsif current_period.ends_at<>win.ends_at then
     update subscriptions set needs_review=true where id=sub.id;
    end if;
    continue;
   end if;
  end if;
  -- An old paid-invoice line must not undo a package revision. Historical
  -- slices of a switched yearly pass must not be granted a second time either.
  if exists(select 1 from entitlement_periods p where p.subscription_id=sub.id and p.player_id=mapping.player_id
   and p.starts_at<win.ends_at and p.ends_at>win.starts_at and (
    (win.ends_at<=now() and p.stripe_item_id in(source_item,input->>'item_id')) or
    exists(select 1 from entitlement_package_revisions r where r.period_id=p.id and
      (r.before_state->>'stripe_price_id'=input->>'price_id' or p.stripe_price_id=input->>'price_id'))
   )) then continue; end if;
  perform import_stripe_allowance_before_package_changes(input||jsonb_build_object('starts_at',win.starts_at,'ends_at',win.ends_at));
 end loop;
 -- Future windows from a replaced annual package no longer grant old quotas.
 -- They keep their identity/history; the original sync may reactivate them,
 -- so enforce this also on subsequent imports of the latest current package.
 if applicable then
  update entitlement_periods p set status='void' where p.subscription_id=sub.id and p.player_id=mapping.player_id
   and p.starts_at>now() and p.stripe_item_id in(source_item,input->>'item_id')
   and (p.stripe_item_id<>input->>'item_id' or p.stripe_price_id<>input->>'price_id');
 end if;
end $$;
revoke all on function public.import_stripe_allowance(jsonb) from public,anon,authenticated;
grant execute on function public.import_stripe_allowance(jsonb) to service_role;

create function public.apply_stripe_package_sync(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
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
 if exists(select 1 from subscription_assignment_reviews where subscription_id=sid and status='pending') then
  update subscriptions set needs_review=true where id=sid;
 end if;
 return sid;
end $$;
revoke all on function public.apply_stripe_package_sync(jsonb) from public,anon,authenticated;
grant execute on function public.apply_stripe_package_sync(jsonb) to service_role;

create function public.resolve_subscription_assignment(input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare review subscription_assignment_reviews; sub subscriptions; selected_player uuid:=(input->>'player_id')::uuid;
 old_item text:=nullif(input->>'previous_item_id',''); old_player uuid; current_item jsonb; plan_row plans;
begin
 if not public.is_admin() then raise exception 'Keine Berechtigung' using errcode='42501'; end if;
 -- Match the sync lock order: subscription advisory lock, subscription row, review.
 select s.* into sub from subscriptions s join subscription_assignment_reviews r on r.subscription_id=s.id where r.id=(input->>'review_id')::uuid;
 if not found then raise exception 'Prüfung nicht verfügbar'; end if;
 perform pg_advisory_xact_lock(hashtext(sub.stripe_subscription_id));
 select * into sub from subscriptions where id=sub.id for update;
 select * into review from subscription_assignment_reviews where id=(input->>'review_id')::uuid for update;
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
 if old_item is not null then
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
notify pgrst, 'reload schema';
commit;
