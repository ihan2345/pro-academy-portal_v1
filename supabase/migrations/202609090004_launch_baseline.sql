-- Production-safe baseline. No families, auth users, locations or Stripe identifiers.
-- Fix helper search paths as well as the already restricted definer functions.
alter function public.touch_updated() set search_path = public;
alter function public.freeze_period() set search_path = public;
alter function public.calculate_auto_at(timestamptz,text) set search_path = public;
alter function public.event_deadline() set search_path = public;

insert into public.plans(id,name,included_units) values
 ('10000000-0000-0000-0000-000000000001','FirstTouch',4),
 ('10000000-0000-0000-0000-000000000002','GameChanger',8),
 ('10000000-0000-0000-0000-000000000003','Pro-Player',8)
on conflict(id) do nothing;
insert into public.system_settings(key,value) values
 ('report_send_time','"08:00"'),
 ('parent_cancellation_enabled','false')
on conflict(key) do nothing;
