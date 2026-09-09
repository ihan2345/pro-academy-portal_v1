-- Multiple explicitly authorized guardians may share one billing customer.
alter table public.parents drop constraint parents_stripe_customer_id_key;
create index parents_stripe_customer on public.parents(stripe_customer_id);
drop policy own_subscription on public.subscriptions;
create policy own_subscription on public.subscriptions for select to authenticated using(stripe_customer_id in(select stripe_customer_id from public.parents where auth_user_id=auth.uid()));
create function public.apply_stripe(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare sid uuid; mapping record; item jsonb; existing public.entitlement_periods; mapped_plan public.plans;
begin
 perform pg_advisory_xact_lock(hashtext(input->>'stripe_subscription_id'));
 insert into public.subscriptions(stripe_subscription_id,stripe_customer_id,status,billing_cycle_anchor,stripe_data,synced_at) values(input->>'stripe_subscription_id',input->>'stripe_customer_id',input->>'status',(input->>'billing_cycle_anchor')::timestamptz,input,(input->>'retrieved_at')::timestamptz)
 on conflict(stripe_subscription_id) do update set status=excluded.status,stripe_data=excluded.stripe_data,billing_cycle_anchor=excluded.billing_cycle_anchor,synced_at=excluded.synced_at where subscriptions.synced_at is null or subscriptions.synced_at<=excluded.synced_at returning id into sid;
 if sid is null then select id into sid from public.subscriptions where stripe_subscription_id=input->>'stripe_subscription_id'; return sid; end if;
 for mapping in select * from public.subscription_players where subscription_id=sid loop
 for item in select value from jsonb_array_elements(input->'items') where value->>'id'=mapping.stripe_item_id loop
 select * into mapped_plan from public.plans where stripe_price_id=item->>'price_id' and active=true;
 if not found then update public.subscriptions set needs_review=true where id=sid; continue; end if;
 select * into existing from public.entitlement_periods where subscription_id=sid and stripe_item_id=mapping.stripe_item_id and player_id=mapping.player_id and starts_at=(item->>'starts_at')::timestamptz;
 if found then
 if existing.stripe_price_id<>item->>'price_id' or existing.ends_at<>(item->>'ends_at')::timestamptz then update public.subscriptions set needs_review=true where id=sid; end if;
 else
 insert into public.entitlement_periods(player_id,subscription_id,stripe_customer_id,stripe_item_id,stripe_price_id,product_name,starts_at,ends_at,included_units,status) values(mapping.player_id,sid,input->>'stripe_customer_id',mapping.stripe_item_id,item->>'price_id',mapped_plan.name,(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz,mapped_plan.included_units,case when input->>'status'='trialing' then 'trialing' else 'active' end) on conflict do nothing;
 end if;
 end loop; end loop; return sid;
end $$;
create function public.link_stripe_family(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare parent uuid; sub uuid; existing_customer text;
begin
 -- Caller is service role only, after request authentication and Stripe ownership checks.
 perform pg_advisory_xact_lock(hashtext(input->>'customer_id'));
 if nullif(input->>'parent_id','') is not null then
 parent:=(input->>'parent_id')::uuid;
 select stripe_customer_id into existing_customer from public.parents where id=parent for update;
 if not found then raise exception 'Elternkonto nicht gefunden'; end if;
 if existing_customer is not null and existing_customer<>input->>'customer_id' then raise exception 'Bestehende Stripe-Verknüpfung darf nicht ersetzt werden'; end if;
 update public.parents set stripe_customer_id=input->>'customer_id' where id=parent;
 else
 select id into parent from public.parents where stripe_customer_id=input->>'customer_id' and lower(contact_email)=lower(input->>'email') for update;
 if parent is null then insert into public.parents(full_name,contact_email,stripe_customer_id) values(input->>'parent_name',input->>'email',input->>'customer_id') returning id into parent; end if;
 end if;
 select id into sub from public.subscriptions where stripe_subscription_id=input->>'subscription_id' and stripe_customer_id=input->>'customer_id' for update;
 if sub is null then raise exception 'Abonnement nicht synchronisiert'; end if;
 insert into public.parent_players(parent_id,player_id) values(parent,(input->>'player_id')::uuid) on conflict do nothing;
 -- Never silently reassign an already linked item.
 if exists(select 1 from public.subscription_players where subscription_id=sub and stripe_item_id=input->>'item_id' and player_id<>(input->>'player_id')::uuid) then raise exception 'Abonnement-Item bereits einem anderen Kind zugeordnet'; end if;
 insert into public.subscription_players(subscription_id,stripe_item_id,player_id) values(sub,input->>'item_id',(input->>'player_id')::uuid) on conflict do nothing;
 update public.subscriptions set parent_id=coalesce(parent_id,parent) where id=sub;
 insert into public.audit_log(actor_id,actor_type,action,table_name,record_id,new_value) values((input->>'actor_id')::uuid,'user','STRIPE_LINK','parents',parent,input-'token');
 return parent;
end $$;
create function public.create_parent_invitation(input jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare p public.parents; invitation uuid;
begin
 select * into p from public.parents where id=(input->>'parent_id')::uuid for update;
 if not found or p.stripe_customer_id is null or p.archived_at is not null then raise exception 'Gültige Stripe-Zuordnung erforderlich'; end if;
 update public.parent_invitations set expires_at=now() where parent_id=p.id and consumed_at is null;
 insert into public.parent_invitations(parent_id,email,token_hash,expires_at,created_by) values(p.id,p.contact_email,input->>'token_hash',now()+interval '7 days',(input->>'actor_id')::uuid) returning id into invitation;
 insert into public.notification_jobs(idempotency_key,kind,recipient,payload) values('invitation:'||invitation,'invitation',p.contact_email,jsonb_build_object('url',input->>'url','parent_name',p.full_name,'invitation_id',invitation));
 return invitation;
end $$;
create function public.capture_report(period uuid, force_version boolean default false, contact_number text default '') returns uuid language plpgsql security definer set search_path=public as $$
declare ent public.entitlement_periods; player public.players; report uuid; version_num int; events jsonb; completed int; minutes int;
begin
 select * into ent from public.entitlement_periods where id=period for update;
 if not found or ent.ends_at>now() then raise exception 'Leistungszeitraum noch nicht abgeschlossen'; end if;
 select id into report from public.report_snapshots where period_id=period order by version desc limit 1;
 if found and not force_version then return report; end if;
 select coalesce(max(version),0)+1 into version_num from public.report_snapshots where period_id=period;
 select * into player from public.players where id=ent.player_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'starts_at',e.starts_at,'ends_at',e.ends_at,'status',ep.status) order by e.starts_at),'[]'), count(*) filter(where ep.status in ('attended_auto','attended_manual')),coalesce(sum(extract(epoch from(e.ends_at-e.starts_at))/60) filter(where ep.status in ('attended_auto','attended_manual')),0)::int into events,completed,minutes from public.event_participants ep join public.training_events e on e.id=ep.event_id where ep.period_id=period;
 insert into public.report_snapshots(period_id,player_id,version,snapshot) values(period,ent.player_id,version_num,jsonb_build_object('player_name',player.first_name||' '||player.last_name,'product_name',ent.product_name,'starts_at',ent.starts_at,'ends_at',ent.ends_at,'included_units',ent.included_units,'completed',completed,'minutes',minutes,'created_at',now(),'version',version_num,'whatsapp',contact_number,'events',events)) returning id into report;
 return report;
end $$;
create function public.register_report_file(snapshot uuid, path text, digest text) returns void language plpgsql security definer set search_path=public as $$
declare r public.report_snapshots; p record; job uuid;
begin
 select * into r from public.report_snapshots where id=$1 for update;
 if not found then raise exception 'Bericht nicht gefunden'; end if;
 insert into public.report_files(snapshot_id,storage_path,sha256) values(snapshot,path,digest) on conflict(snapshot_id) do nothing;
 for p in select parents.id,parents.contact_email from public.parents join public.parent_players pp on pp.parent_id=parents.id where pp.player_id=r.player_id and parents.archived_at is null loop
 insert into public.notification_jobs(idempotency_key,kind,recipient,payload) values('report:'||snapshot||':'||p.id,'report',p.contact_email,jsonb_build_object('snapshot_id',snapshot,'player_name',r.snapshot->>'player_name','storage_path',path)) on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into job;
 insert into public.report_deliveries(snapshot_id,parent_id,job_id) values(snapshot,p.id,job) on conflict(job_id) do nothing;
 end loop;
end $$;
create function public.resend_report(snapshot uuid, request_id uuid, actor uuid) returns void language plpgsql security definer set search_path=public as $$
declare r public.report_snapshots; path text; p record; job uuid;
begin
 select * into r from public.report_snapshots where id=$1;
 select storage_path into path from public.report_files where snapshot_id=snapshot;
 if path is null then raise exception 'PDF-Datei noch nicht verfügbar'; end if;
 for p in select parents.id,parents.contact_email from public.parents join public.parent_players pp on pp.parent_id=parents.id where pp.player_id=r.player_id and parents.archived_at is null loop
 insert into public.notification_jobs(idempotency_key,kind,recipient,payload) values('resend:'||request_id||':'||snapshot||':'||p.id,'report',p.contact_email,jsonb_build_object('snapshot_id',snapshot,'player_name',r.snapshot->>'player_name','storage_path',path)) on conflict do nothing returning id into job;
 if job is not null then insert into public.report_deliveries(snapshot_id,parent_id,job_id) values(snapshot,p.id,job); end if;
 end loop;
 insert into public.audit_log(actor_id,action,table_name,record_id,new_value) values(actor,'REPORT_RESEND','report_snapshots',snapshot,jsonb_build_object('request_id',request_id));
end $$;
create function public.finish_notification(input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare job public.notification_jobs;
begin
 select * into job from public.notification_jobs where id=(input->>'id')::uuid and lease_token=(input->>'lease_token')::uuid and status='processing' for update;
 if not found then raise exception 'Versandleasing ungültig'; end if;
 insert into public.notification_deliveries(job_id,attempt,recipient,provider,status,message_id,error) values(job.id,job.attempts,input->>'recipient',input->>'provider',input->>'status',input->>'message_id',input->>'error');
 update public.notification_jobs set payload=case when kind='invitation' and input->>'status'='sent' then payload-'url' else payload end,status=input->>'status',last_error=input->>'error',available_at=now()+make_interval(secs=>least(3600,60*power(2,attempts)::int)),locked_at=null where id=job.id;
end $$;
revoke execute on function public.apply_stripe(jsonb),public.link_stripe_family(jsonb),public.create_parent_invitation(jsonb),public.capture_report(uuid,boolean,text),public.register_report_file(uuid,text,text),public.resend_report(uuid,uuid,uuid),public.finish_notification(jsonb) from public,anon,authenticated;
grant execute on function public.apply_stripe(jsonb),public.link_stripe_family(jsonb),public.create_parent_invitation(jsonb),public.capture_report(uuid,boolean,text),public.register_report_file(uuid,text,text),public.resend_report(uuid,uuid,uuid),public.finish_notification(jsonb) to service_role;
