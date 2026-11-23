-- Release 060: Glocke/Aktivitäten aufschlussreicher (Wer, Was, Warum, Wie).
-- Nur Lesen: ersetzt die Ansicht activity_feed (Spalten unverändert) und legt
-- einen Index an. Keine Daten werden geändert.
--
-- Neu in details:
--   family / parentId   Elternprofil zum Abo bzw. zum betroffenen Kind
--   children  Kinder, die dem Abo zugeordnet sind (auch als subject)
--   reason / feedback / comment   Stripe cancellation_details (Kündigungsgrund,
--             Auswahl und Kommentar des Kunden im Kündigungsportal)
--   cancelAt / endedAt   Ende laut Stripe (Datum, Europe/Berlin)
-- Neue Art "cancellation": Kündigung vorgemerkt bzw. zurückgenommen, solange
-- das Abo noch läuft (bisher erschien dafür gar nichts).
-- Ohne diese Release funktioniert das Portal weiter, die Glocke zeigt dann nur
-- die bisherigen, knapperen Texte.
begin;
create index if not exists stripe_events_subscription on public.stripe_webhook_events((payload#>>'{data,object,id}'),stripe_created desc)
 where type like 'customer.subscription.%';
create or replace view public.activity_feed as
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
 when table_name='subscriptions' and action='UPDATE' and new_value->>'status' not in ('canceled','incomplete_expired') and
  (coalesce(new_value#>>'{stripe_data,cancel_at_period_end}','false')='true' or new_value#>>'{stripe_data,cancel_at}' is not null) is distinct from
  (coalesce(old_value#>>'{stripe_data,cancel_at_period_end}','false')='true' or old_value#>>'{stripe_data,cancel_at}' is not null) then 'cancellation'
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
  case when a.kind='parent' then a.v->>'full_name' end,
  kids.names) subject,
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
  'mailKind',case when a.kind='mail' then a.v->>'kind' end,
  -- Wer: Familie (Elternprofil) zum Abo bzw. zum betroffenen Kind.
  'family',case when a.kind<>'parent' then fam.full_name end,
  'parentId',fam.id::text,
  'children',case when a.kind in ('subscription','cancellation','review') then kids.names end,
  -- Warum/Wie: nur Stripes Codes und der Kundenkommentar aus dem Kündigungsportal,
  -- keine Beträge, Zahlungsdaten oder Fehlermeldungen.
  'reason',case when a.kind in ('subscription','cancellation') then ev.o#>>'{cancellation_details,reason}' end,
  'feedback',case when a.kind in ('subscription','cancellation') then ev.o#>>'{cancellation_details,feedback}' end,
  'comment',case when a.kind in ('subscription','cancellation') then left(ev.o#>>'{cancellation_details,comment}',300) end,
  'cancelAt',case when a.kind in ('subscription','cancellation') then coalesce(
   to_char(to_timestamp(nullif(ev.o->>'cancel_at','')::bigint) at time zone 'Europe/Berlin','YYYY-MM-DD'),
   case when ev.o->>'cancel_at_period_end'='true' then to_char(to_timestamp(nullif(ev.o->>'current_period_end','')::bigint) at time zone 'Europe/Berlin','YYYY-MM-DD') end,
   left(a.v#>>'{stripe_data,cancel_at}',10)) end,
  'endedAt',case when a.kind='subscription' then coalesce(
   to_char(to_timestamp(nullif(ev.o->>'ended_at','')::bigint) at time zone 'Europe/Berlin','YYYY-MM-DD'),
   left(a.v#>>'{stripe_data,ended_at}',10)) end,
  'scheduled',case when a.kind='cancellation' then
   case when coalesce(a.v#>>'{stripe_data,cancel_at_period_end}','false')='true' or a.v#>>'{stripe_data,cancel_at}' is not null then 'true' else 'false' end end
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
left join public.subscriptions sub on sub.id::text=case when a.kind in ('subscription','cancellation') then a.record_id::text
 when a.kind='review' then r.subscription_id::text else a.v->>'subscription_id' end
left join lateral (select par.id,par.full_name from public.parents par
 where par.id=coalesce(sub.parent_id,(select pp.parent_id from public.parent_players pp where pp.player_id=p.id order by pp.created_at limit 1))) fam on true
left join lateral (select string_agg(distinct pl.first_name||' '||pl.last_name,', ') names
 from public.subscription_players sp join public.players pl on pl.id=sp.player_id
 where a.kind in ('subscription','cancellation','review') and sp.subscription_id=sub.id) kids on true
left join lateral (select w.payload#>'{data,object}' o from public.stripe_webhook_events w
 where a.kind in ('subscription','cancellation') and w.type like 'customer.subscription.%'
  and w.payload#>>'{data,object,id}'=sub.stripe_subscription_id and w.created_at<=a.created_at+interval '10 minutes'
 order by w.stripe_created desc,w.created_at desc limit 1) ev on true
where a.kind not in ('period','package') or a.batch=1
union all
select 'j:'||j.id::text, j.updated_at,'processing',null,'Automatisch',jsonb_build_object('status',j.status),
 j.status='failed' and not exists(select 1 from public.job_runs newer where (newer.created_at,newer.id)>(j.created_at,j.id) and newer.status in ('completed','failed'))
from public.job_runs j where j.status='failed';
revoke all on public.activity_feed from public,anon,authenticated;
grant select on public.activity_feed to service_role;
notify pgrst,'reload schema';
commit;
