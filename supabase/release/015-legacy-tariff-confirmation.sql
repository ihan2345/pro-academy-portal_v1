begin;
-- Permission is scoped to this subscription and price, never the whole catalogue.
create table public.subscription_legacy_approvals (
 id uuid primary key default gen_random_uuid(),
 subscription_id uuid not null references public.subscriptions(id),
 stripe_price_id text not null,
 approved_by uuid not null references public.profiles(id),
 approved_at timestamptz not null default now(),
 unique(subscription_id,stripe_price_id)
);
alter table public.subscription_legacy_approvals enable row level security;
revoke all on public.subscription_legacy_approvals from public,anon,authenticated,service_role;
grant select on public.subscription_legacy_approvals to service_role;
create trigger audit_change after insert on public.subscription_legacy_approvals for each row execute function public.audit_change();

-- Retain the existing import logic and replace only its date gate in both layers.
do $migration$
declare definition text; needle text; signature text;
begin
 foreach signature in array array['public.import_stripe_allowance(jsonb)','public.import_stripe_allowance_before_package_changes(jsonb)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if signature='public.import_stripe_allowance(jsonb)' then
   needle:=$s$if tariff.generation='legacy' and ((sub.stripe_data->>'subscription_created_at') is null or (sub.stripe_data->>'subscription_created_at')::timestamptz>=timestamptz '2026-09-01 00:00:00 Europe/Berlin') then$s$;
  else
   needle:=$s$if plan.generation='legacy' and (created is null or created>=timestamptz '2026-09-01 00:00:00 Europe/Berlin') then$s$;
  end if;
  if strpos(definition,needle)=0 then raise exception 'Unexpected allowance definition: %',signature; end if;
  definition:=replace(definition,needle,replace(needle,' then', $s$ and not exists(select 1 from public.subscription_legacy_approvals where subscription_id=sub.id and stripe_price_id=input->>'price_id') then$s$));
  execute definition;
 end loop;
 definition:=pg_get_functiondef('public.resolve_subscription_assignment(jsonb)'::regprocedure);
 needle:=$s$if plan_row.generation='legacy' and ((sub.stripe_data->>'subscription_created_at') is null or (sub.stripe_data->>'subscription_created_at')::timestamptz>=timestamptz '2026-09-01 00:00:00 Europe/Berlin') then raise exception 'Bestandstarif passt nicht zum Abobeginn.'; end if;$s$;
 if strpos(definition,needle)=0 then raise exception 'Unexpected review definition'; end if;
 definition:=replace(definition,needle,$s$if plan_row.generation='legacy' and ((sub.stripe_data->>'subscription_created_at') is null or (sub.stripe_data->>'subscription_created_at')::timestamptz>=timestamptz '2026-09-01 00:00:00 Europe/Berlin')
 and not exists(select 1 from public.subscription_legacy_approvals where subscription_id=sub.id and stripe_price_id=current_item->>'price_id') then
  if input->'confirm_legacy_tariff' is distinct from 'true'::jsonb then raise exception 'Bitte ausdrücklich bestätigen, dass dieses neue Abo den günstigeren Bestandstarif erhalten darf.'; end if;
  insert into public.subscription_legacy_approvals(subscription_id,stripe_price_id,approved_by) values(sub.id,current_item->>'price_id',auth.uid());
 end if;$s$);
 execute definition;
 -- A mapped child can still need tariff approval (e.g. a later package switch).
 definition:=pg_get_functiondef('public.apply_stripe_package_sync(jsonb)'::regprocedure);
 needle:=' perform public.close_completed_subscription_reviews(sid);';
 if strpos(definition,needle)=0 then raise exception 'Unexpected sync definition'; end if;
 definition:=replace(definition,needle,$s$
 for v_item in select i from jsonb_array_elements(input->'items') i
  join public.plans p on p.stripe_price_id=i->>'price_id' and p.active and p.generation='legacy'
  where ((sub.stripe_data->>'subscription_created_at') is null or (sub.stripe_data->>'subscription_created_at')::timestamptz>=timestamptz '2026-09-01 00:00:00 Europe/Berlin')
   and exists(select 1 from subscription_players m where m.subscription_id=sid and m.stripe_item_id=i->>'id')
   and not exists(select 1 from public.subscription_legacy_approvals a where a.subscription_id=sid and a.stripe_price_id=i->>'price_id')
 loop
  insert into subscription_assignment_reviews(subscription_id,stripe_item_id,item,previous_item_ids,suggested_player_ids,signature)
   values(sid,v_item->>'id',v_item,'{}','{}',md5(v_item::text||'{}'))
   on conflict(subscription_id,stripe_item_id) do update set item=excluded.item,signature=excluded.signature,status='pending',previous_item_ids='{}',suggested_player_ids='{}',resolved_at=null,resolved_by=null,resolved_player_id=null;
 end loop;
 perform public.close_completed_subscription_reviews(sid);$s$);
 execute definition;
 -- Existing entitlement data alone is not an explicit approval.
 definition:=pg_get_functiondef('public.close_completed_subscription_reviews(uuid)'::regprocedure);
 needle:='and tariff.stripe_price_id=r.item->>''price_id'' and tariff.active';
 if strpos(definition,needle)=0 then raise exception 'Unexpected cleanup definition'; end if;
 definition:=replace(definition,needle,needle||$s$
  and (tariff.generation<>'legacy' or (s.stripe_data->>'subscription_created_at')::timestamptz<timestamptz '2026-09-01 00:00:00 Europe/Berlin'
   or exists(select 1 from public.subscription_legacy_approvals a where a.subscription_id=s.id and a.stripe_price_id=tariff.stripe_price_id))$s$);
 execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
