-- Price variants preserve grandfathered subscriptions; annual billing grants monthly allowances.
alter table public.plans drop constraint plans_name_check;
alter table public.plans drop constraint plans_check;
alter table public.plans add column generation text not null default 'legacy' check (generation in ('legacy','current','special'));
alter table public.plans add column billing_interval text not null default 'month' check (billing_interval in ('month','year'));
alter table public.plans add column athletics_units int not null default 0;
alter table public.plans add column is_public boolean not null default false;
-- Correct the legacy catalog before installing the revised constraint; historical periods remain frozen.
update public.plans set included_units=10 where name='Pro-Player' and generation='legacy';
alter table public.plans add constraint plan_allowances check (
 (name='FirstTouch' and included_units=4 and athletics_units=0 and generation in ('legacy','current') and billing_interval='month') or
 (name='GameChanger' and included_units=8 and athletics_units=0 and generation in ('legacy','current') and billing_interval='month') or
 (name='Pro-Player' and athletics_units=0 and ((generation='legacy' and included_units=10) or (generation='current' and included_units=12 and billing_interval='month'))) or
 (name='NEXT LEVEL' and generation='special' and included_units=12 and athletics_units=4 and billing_interval='month')
);
alter table public.plans add constraint legacy_private check (generation<>'legacy' or not is_public);
drop policy read_plans on public.plans;
create policy read_plans on public.plans for select to authenticated using (is_public or public.is_team());
alter table public.entitlement_periods add column athletics_units int not null default 0 check (athletics_units>=0 and athletics_units<=included_units);
alter table public.entitlement_periods add column tariff_generation text not null default 'legacy';

-- Compute every boundary from the ORIGINAL anchor to avoid Jan 31 -> Feb 28 -> Mar 28 drift.
create function public.allowance_windows(period_start timestamptz, period_end timestamptz, billing text)
returns table(starts_at timestamptz,ends_at timestamptz) language plpgsql immutable set search_path=public as $$
declare anchor timestamp:=period_start at time zone 'Europe/Berlin'; i int;
begin
 if period_end<=period_start then raise exception 'Ungültiger Leistungszeitraum'; end if;
 if billing='month' then starts_at:=period_start; ends_at:=period_end; return next; return; end if;
 if billing<>'year' or period_end>(((anchor+interval '1 year') at time zone 'Europe/Berlin')+interval '1 day') then raise exception 'Ungültiger Jahreszeitraum'; end if;
 for i in 0..11 loop
 starts_at:=(anchor+make_interval(months=>i)) at time zone 'Europe/Berlin';
 ends_at:=least((anchor+make_interval(months=>i+1)) at time zone 'Europe/Berlin',period_end);
 if i=11 then ends_at:=period_end; end if;
 if starts_at>=period_end then exit; end if;
 return next;
 end loop;
end $$;

-- Shared by subscription sync and paid-invoice recovery. Never rewrite a historical snapshot.
create function public.import_stripe_allowance(input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare sub public.subscriptions; plan public.plans; mapping public.subscription_players; win record; existing public.entitlement_periods; created timestamptz;
begin
 select * into sub from public.subscriptions where stripe_subscription_id=input->>'subscription_id' for update;
 if not found then raise exception 'Abonnement nicht synchronisiert'; end if;
 select * into mapping from public.subscription_players where subscription_id=sub.id and stripe_item_id=input->>'item_id';
 if not found then return; end if;
 select * into plan from public.plans where stripe_price_id=input->>'price_id' and active;
 if not found then update public.subscriptions set needs_review=true where id=sub.id; return; end if;
 created:=(sub.stripe_data->>'subscription_created_at')::timestamptz;
 if plan.generation='legacy' and (created is null or created>=timestamptz '2026-09-01 00:00:00 Europe/Berlin') then
 update public.subscriptions set needs_review=true where id=sub.id; return;
 end if;
 for win in select * from public.allowance_windows((input->>'starts_at')::timestamptz,(input->>'ends_at')::timestamptz,plan.billing_interval) loop
 select * into existing from public.entitlement_periods where subscription_id=sub.id and stripe_item_id=mapping.stripe_item_id and player_id=mapping.player_id and starts_at=win.starts_at;
 if found then
 if existing.stripe_price_id<>input->>'price_id' or existing.ends_at<>win.ends_at then update public.subscriptions set needs_review=true where id=sub.id; end if;
 elsif exists(select 1 from public.entitlement_periods where subscription_id=sub.id and stripe_item_id=mapping.stripe_item_id and player_id=mapping.player_id and starts_at<win.ends_at and ends_at>win.starts_at) then
 update public.subscriptions set needs_review=true where id=sub.id;
 else
 -- Recover ended invoice periods even for cancelled subscriptions; never grant future access after cancellation.
 if sub.status not in ('active','trialing') and win.ends_at>now() then continue; end if;
 if sub.status='canceled' and win.starts_at>=coalesce((sub.stripe_data->>'ended_at')::timestamptz,now()) then continue; end if;
 insert into public.entitlement_periods(player_id,subscription_id,stripe_customer_id,stripe_item_id,stripe_price_id,product_name,starts_at,ends_at,included_units,athletics_units,tariff_generation,status)
 values(mapping.player_id,sub.id,sub.stripe_customer_id,mapping.stripe_item_id,input->>'price_id',plan.name,win.starts_at,win.ends_at,plan.included_units,plan.athletics_units,plan.generation,case when sub.status='trialing' then 'trialing' else 'active' end) on conflict do nothing;
 end if;
 end loop;
end $$;

create or replace function public.apply_stripe(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare sid uuid; item jsonb;
begin
 perform pg_advisory_xact_lock(hashtext(input->>'stripe_subscription_id'));
 if exists(select 1 from public.subscriptions where stripe_subscription_id=input->>'stripe_subscription_id' and stripe_customer_id<>input->>'stripe_customer_id') then raise exception 'Stripe-Kunde stimmt nicht überein'; end if;
 insert into public.subscriptions(stripe_subscription_id,stripe_customer_id,status,billing_cycle_anchor,stripe_data,synced_at) values(input->>'stripe_subscription_id',input->>'stripe_customer_id',input->>'status',(input->>'billing_cycle_anchor')::timestamptz,input,(input->>'retrieved_at')::timestamptz)
 on conflict(stripe_subscription_id) do update set status=excluded.status,stripe_data=excluded.stripe_data,billing_cycle_anchor=excluded.billing_cycle_anchor,synced_at=excluded.synced_at where subscriptions.synced_at is null or subscriptions.synced_at<=excluded.synced_at returning id into sid;
 if sid is null then select id into sid from public.subscriptions where stripe_subscription_id=input->>'stripe_subscription_id'; return sid; end if;
 update public.entitlement_periods set status=case when input->>'status' in ('active','trialing') then input->>'status' when input->>'status'='canceled' and starts_at>=coalesce((input->>'ended_at')::timestamptz,now()) then 'void' else 'suspended' end where subscription_id=sid and ends_at>now();
 if input->>'status' in ('active','trialing') then
 for item in select value from jsonb_array_elements(input->'items') loop
 perform public.import_stripe_allowance(jsonb_build_object('subscription_id',input->>'stripe_subscription_id','item_id',item->>'id','price_id',item->>'price_id','starts_at',item->>'starts_at','ends_at',item->>'ends_at'));
 end loop;
 end if;
 return sid;
end $$;

create or replace function public.save_training(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare eid uuid; child uuid; selected_period uuid; old_event public.training_events; children uuid[]; event_start timestamptz; event_end timestamptz; r record;
begin
 if not public.is_team() then raise exception 'Forbidden' using errcode='42501'; end if;
 perform set_config('app.audit_reason',coalesce(input->>'reason','Terminplanung'),true);
 event_start:=(input->>'starts_at')::timestamptz; event_end:=(input->>'ends_at')::timestamptz;
 children:=array(select distinct jsonb_array_elements_text(input->'player_ids')::uuid);
 if cardinality(children)<1 then raise exception 'Mindestens ein Kind auswählen'; end if;
 if nullif(input->>'id','') is not null then
 eid:=(input->>'id')::uuid; select * into old_event from public.training_events where id=eid for update;
 if not found then raise exception 'Termin nicht gefunden'; end if;
 if old_event.revision<>coalesce((input->>'revision')::int,0) then raise exception 'Termin wurde zwischenzeitlich geändert'; end if;
 if exists(select 1 from public.event_participants where event_id=eid and status in ('attended_auto','attended_manual')) and (event_start<>old_event.starts_at or event_end<>old_event.ends_at or input->>'event_type'<>old_event.event_type) then raise exception 'Zuerst bestätigte Teilnahmen korrigieren, dann Terminzeit oder Trainingsart ändern'; end if;
 update public.training_events set title=input->>'title',starts_at=event_start,ends_at=event_end,location_id=(input->>'location_id')::uuid,trainer_id=(input->>'trainer_id')::uuid,event_type=input->>'event_type',notify_parents=coalesce((input->>'notify_parents')::boolean,true),revision=revision+1 where id=eid;
 else
 insert into public.training_events(title,starts_at,ends_at,location_id,trainer_id,event_type,auto_attendance_at,notify_parents,created_by) values(input->>'title',event_start,event_end,(input->>'location_id')::uuid,(input->>'trainer_id')::uuid,input->>'event_type',public.calculate_auto_at(event_end),coalesce((input->>'notify_parents')::boolean,true),auth.uid()) returning id into eid;
 end if;
 insert into public.event_private_notes(id,note) values(eid,coalesce(input->>'note','')) on conflict(id) do update set note=excluded.note;
 update public.event_participants set status='cancelled',reason='Aus Termin entfernt',revision=revision+1 where event_id=eid and not(player_id=any(children)) and status<>'cancelled';
 foreach child in array children loop
 select id into selected_period from public.entitlement_periods where player_id=child and event_start>=starts_at and event_start<ends_at and status in ('active','trialing') and (case when input->>'event_type'='Athletiktraining' then athletics_units>0 else included_units-athletics_units>0 end) order by starts_at desc limit 1;
 if selected_period is null then raise exception 'Kein aktiver Leistungszeitraum für Kind %',child; end if;
 insert into public.event_participants(event_id,player_id,period_id) values(eid,child,selected_period) on conflict(event_id,player_id) do update set period_id=excluded.period_id,status=case when event_participants.status='cancelled' then 'planned'::public.attendance_status else event_participants.status end,revision=event_participants.revision+1;
 end loop;
 if old_event.id is not null and coalesce((input->>'notify_parents')::boolean,true) then
 for r in select ep.id,p.contact_email,p.id parent_id,ep.player_id,ep.period_id from public.event_participants ep join public.parent_players pp on pp.player_id=ep.player_id join public.parents p on p.id=pp.parent_id where ep.event_id=eid loop
 insert into public.notification_jobs(idempotency_key,kind,recipient,payload) values('change:'||eid||':'||(old_event.revision+1)||':'||r.parent_id||':'||r.player_id,'change',r.contact_email,jsonb_build_object('event_id',eid,'player_id',r.player_id,'participant_id',r.id,'period_id',r.period_id,'starts_at',event_start,'ends_at',event_end)) on conflict do nothing;
 end loop; end if;
 return eid;
end $$;
create or replace function public.participant_validate() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.entitlement_periods p join public.training_events e on e.id=new.event_id where p.id=new.period_id and p.player_id=new.player_id and (new.status='cancelled' or (e.starts_at>=p.starts_at and e.starts_at<p.ends_at and (case when e.event_type='Athletiktraining' then p.athletics_units>0 else p.included_units-p.athletics_units>0 end)))) then raise exception 'Kein passender Leistungszeitraum'; end if;
 if new.status<>'cancelled' and exists(select 1 from public.training_events where id=new.event_id and status='cancelled') then raise exception 'Stornierte Termine können nicht erneut belegt werden'; end if;
 if new.status in ('attended_auto','attended_manual') and exists(select 1 from public.training_events where id=new.event_id and (status='cancelled' or ends_at>now())) then raise exception 'Zukünftige oder stornierte Termine können nicht bestätigt werden'; end if;
 return new;
end $$;
create or replace function public.capture_report(period uuid, force_version boolean default false, contact_number text default '') returns uuid language plpgsql security definer set search_path=public as $$
declare ent public.entitlement_periods; player public.players; report uuid; version_num int; events jsonb; completed int; minutes int;
begin
 select * into ent from public.entitlement_periods where id=period for update;
 if not found or ent.ends_at>now() then raise exception 'Leistungszeitraum noch nicht abgeschlossen'; end if;
 select id into report from public.report_snapshots where period_id=period order by version desc limit 1;
 if found and not force_version then return report; end if;
 select coalesce(max(version),0)+1 into version_num from public.report_snapshots where period_id=period;
 select * into player from public.players where id=ent.player_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'event_type',e.event_type,'starts_at',e.starts_at,'ends_at',e.ends_at,'status',ep.status) order by e.starts_at),'[]'), count(*) filter(where ep.status in ('attended_auto','attended_manual')),coalesce(sum(extract(epoch from(e.ends_at-e.starts_at))/60) filter(where ep.status in ('attended_auto','attended_manual')),0)::int into events,completed,minutes from public.event_participants ep join public.training_events e on e.id=ep.event_id where ep.period_id=period;
 insert into public.report_snapshots(period_id,player_id,version,snapshot) values(period,ent.player_id,version_num,jsonb_build_object('player_name',player.first_name||' '||player.last_name,'product_name',ent.product_name,'starts_at',ent.starts_at,'ends_at',ent.ends_at,'included_units',ent.included_units,'athletics_units',ent.athletics_units,'tariff_generation',ent.tariff_generation,'completed',completed,'minutes',minutes,'created_at',now(),'version',version_num,'whatsapp',contact_number,'events',events)) returning id into report;
 return report;
end $$;
create or replace function public.participant_notify() returns trigger language plpgsql security definer set search_path=public as $$
declare kind_value text; e public.training_events; r record;
begin
 select * into e from public.training_events where id=new.event_id;
 if TG_OP='INSERT' and new.status='planned' and e.notify_parents then kind_value:='planning';
 elsif TG_OP='UPDATE' and new.status is distinct from old.status and new.status in ('attended_auto','attended_manual') and old.status not in ('attended_auto','attended_manual') then kind_value:='attendance';
 elsif TG_OP='UPDATE' and new.status is distinct from old.status and current_setting('app.correction_mail',true)='true' then kind_value:='correction';
 else return new; end if;
 for r in select p.id,p.contact_email from public.parents p join public.parent_players pp on pp.parent_id=p.id where pp.player_id=new.player_id and p.archived_at is null loop
 insert into public.notification_jobs(idempotency_key,kind,recipient,payload) values(kind_value||':'||new.id||':'||new.revision||':'||r.id,kind_value,r.contact_email,jsonb_build_object('participant_id',new.id,'player_id',new.player_id,'event_id',new.event_id,'period_id',new.period_id,'status',new.status,'starts_at',e.starts_at,'ends_at',e.ends_at,'title',e.title,'event_type',e.event_type,'location_id',e.location_id,'trainer_id',e.trainer_id)) on conflict(idempotency_key) do nothing;
 end loop; return new;
end $$;
revoke execute on function public.allowance_windows(timestamptz,timestamptz,text),public.import_stripe_allowance(jsonb) from public,anon,authenticated;
grant execute on function public.allowance_windows(timestamptz,timestamptz,text),public.import_stripe_allowance(jsonb) to service_role;
