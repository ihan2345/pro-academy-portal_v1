begin;
-- Read-only projection: existing records remain the source of truth.
create index if not exists audit_activity_lookup on public.audit_log(table_name,record_id,created_at desc,id desc);
create index if not exists audit_activity_time on public.audit_log(created_at desc,id desc);

-- Stripe processing errors were not previously audited. Store only status, never
-- webhook payloads, secrets, payment details or provider error messages.
create function public.audit_stripe_activity() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status is distinct from old.status and (new.status='failed' or old.status='failed') then
  insert into audit_log(actor_type,action,table_name,record_id,old_value,new_value)
  values('systemjob','UPDATE','stripe_webhook_events',new.id,jsonb_build_object('status',old.status),jsonb_build_object('status',new.status));
 end if;
 return new;
end $$;
revoke all on function public.audit_stripe_activity() from public,anon,authenticated;
create trigger stripe_activity_status after update of status on public.stripe_webhook_events for each row execute function public.audit_stripe_activity();
insert into public.audit_log(actor_type,action,table_name,record_id,new_value,created_at)
select 'systemjob','UPDATE','stripe_webhook_events',id,jsonb_build_object('status',status),updated_at from public.stripe_webhook_events where status='failed';

-- Mail job state is also recorded without recipient addresses or message bodies.
create function public.audit_mail_activity() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status in ('sent','failed','uncertain') and (tg_op='INSERT' or new.status is distinct from old.status) then
  insert into audit_log(actor_id,actor_type,action,table_name,record_id,old_value,new_value)
  values(auth.uid(),case when auth.uid() is null then 'systemjob' else 'user' end,tg_op,'notification_jobs',new.id,
   case when tg_op='UPDATE' then jsonb_build_object('status',old.status) end,
   jsonb_build_object('status',new.status,'kind',new.kind,'payload',jsonb_build_object('player_id',new.payload->>'player_id')));
 end if;
 return new;
end $$;
revoke all on function public.audit_mail_activity() from public,anon,authenticated;
create trigger mail_activity_status after insert or update of status on public.notification_jobs for each row execute function public.audit_mail_activity();
insert into public.audit_log(actor_type,action,table_name,record_id,new_value,created_at)
select 'systemjob','UPDATE','notification_jobs',id,
 jsonb_build_object('status',status,'kind',kind,'payload',jsonb_build_object('player_id',payload->>'player_id')),updated_at
from public.notification_jobs where status in ('sent','failed','uncertain');

create view public.activity_feed as
with candidates as (
 select a.*,coalesce(a.new_value,a.old_value,'{}'::jsonb) v,
 case
 when table_name='players' and action in ('INSERT','DELETE') then 'player'
 when table_name='players' and action='UPDATE' and
  (new_value-array['updated_at','private_note']) is distinct from (old_value-array['updated_at','private_note']) then 'player'
 when table_name='parents' and action in ('INSERT','DELETE') then 'parent'
 when table_name='parents' and action='UPDATE' and
  (new_value->>'full_name',new_value->>'archived_at') is distinct from (old_value->>'full_name',old_value->>'archived_at') then 'parent'
 when table_name='training_events' and (action in ('INSERT','DELETE') or
  (new_value->>'title',new_value->>'starts_at',new_value->>'ends_at',new_value->>'location_id',new_value->>'trainer_id',new_value->>'status') is distinct from
  (old_value->>'title',old_value->>'starts_at',old_value->>'ends_at',old_value->>'location_id',old_value->>'trainer_id',old_value->>'status')) then 'training'
 when table_name='event_participants' and (action in ('INSERT','DELETE') or
  (new_value->>'status',new_value->>'removed_from_event') is distinct from (old_value->>'status',old_value->>'removed_from_event')) then 'attendance'
 when table_name='training_backfills' and action='INSERT' then 'backfill'
 when table_name='subscription_players' and (action in ('INSERT','DELETE') or new_value->>'player_id' is distinct from old_value->>'player_id') then 'assignment'
 when table_name='entitlement_periods' and action='INSERT' then 'period'
 when table_name='entitlement_periods' and action='UPDATE' and
  (new_value->>'stripe_price_id',new_value->>'product_name',new_value->>'included_units') is distinct from
  (old_value->>'stripe_price_id',old_value->>'product_name',old_value->>'included_units') then 'package'
 when table_name='subscriptions' and action='UPDATE' and new_value->>'status' is distinct from old_value->>'status' then 'subscription'
 when table_name='subscription_assignment_reviews' and (action='INSERT' or
  (new_value->>'status',new_value->>'signature') is distinct from (old_value->>'status',old_value->>'signature')) then 'review'
 when table_name='notification_jobs' and new_value->>'status' in ('sent','failed','uncertain') and
  new_value->>'status' is distinct from old_value->>'status' then 'mail'
 when table_name='report_snapshots' and action='INSERT' then 'report'
 when table_name='stripe_webhook_events' and new_value->>'status' in ('failed','processed') then 'stripe'
 end kind
 from public.audit_log a
 where table_name in ('players','parents','training_events','event_participants','training_backfills','subscription_players','entitlement_periods','subscriptions','subscription_assignment_reviews','notification_jobs','report_snapshots','stripe_webhook_events')
), ranked as (
 select *,row_number() over(partition by table_name,record_id,kind order by created_at desc,id desc) latest,
 row_number() over(partition by kind,created_at,coalesce(v->>'subscription_id',id::text),coalesce(v->>'player_id',id::text) order by v->>'starts_at',id) batch
 from candidates where kind is not null
)
select 'a:'||a.id::text id,a.created_at occurred_at,a.kind,
 coalesce(nullif(p.first_name||' '||p.last_name,''),
  case when a.kind='player' then nullif((a.v->>'first_name')||' '||(a.v->>'last_name'),'') end,
  case when a.kind='parent' then a.v->>'full_name' end) subject,
 coalesce(nullif(actor.full_name,''),case when a.actor_id is null then 'Automatisch' else 'Teammitglied' end) actor,
 jsonb_strip_nulls(jsonb_build_object(
  'action',a.action,'status',a.v->>'status','previousStatus',a.old_value->>'status',
  'title',case when a.kind in ('training','backfill') then a.v->>'title' when a.kind='attendance' then e.title end,
  'product',case when a.kind in ('package','period') then a.v->>'product_name' end,
  'previousProduct',case when a.kind='package' then a.old_value->>'product_name' end,
  'units',case when a.kind in ('package','period') then a.v->>'included_units' end,
  'previousUnits',case when a.kind='package' then a.old_value->>'included_units' end,
  'archived',case when a.kind in ('player','parent') then a.v->>'archived_at' end,
  'removed',case when a.kind='attendance' then a.v->>'removed_from_event' end,
  'mailKind',case when a.kind='mail' then a.v->>'kind' end
 )) details,
 case
 when a.kind='review' then a.latest=1 and a.v->>'status'='pending' and r.status='pending'
 when a.kind='mail' then a.latest=1 and a.v->>'status' in ('failed','uncertain') and j.status in ('failed','uncertain')
 when a.kind='stripe' then a.latest=1 and a.v->>'status'='failed' and s.status='failed'
 else false end is_open
from ranked a
left join public.players p on p.id::text=case when a.kind='player' then a.record_id::text when a.kind='mail' then coalesce(a.v#>>'{payload,player_id}',a.v#>>'{payload,snapshot,player_id}') else a.v->>'player_id' end
left join public.profiles actor on actor.id=a.actor_id
left join public.training_events e on e.id::text=a.v->>'event_id' and a.kind='attendance'
left join public.subscription_assignment_reviews r on r.id=a.record_id and a.kind='review'
left join public.notification_jobs j on j.id=a.record_id and a.kind='mail'
left join public.stripe_webhook_events s on s.id=a.record_id and a.kind='stripe'
where a.kind not in ('period','package') or a.batch=1
union all
select 'j:'||j.id::text, j.updated_at,'processing',null,'Automatisch',jsonb_build_object('status',j.status),
 j.status='failed' and not exists(select 1 from public.job_runs newer where (newer.created_at,newer.id)>(j.created_at,j.id) and newer.status in ('completed','failed'))
from public.job_runs j where j.status='failed';
revoke all on public.activity_feed from public,anon,authenticated;
grant select on public.activity_feed to service_role;
notify pgrst,'reload schema';
commit;
