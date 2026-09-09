-- Safe catalog seed, no auth users or live Stripe prices. Idempotent.
insert into public.plans(id,name,included_units) values
 ('10000000-0000-0000-0000-000000000001','FirstTouch',4),
 ('10000000-0000-0000-0000-000000000002','GameChanger',8),
 ('10000000-0000-0000-0000-000000000003','Pro-Player',10) on conflict(id) do nothing;
insert into public.locations(id,name,address) values('20000000-0000-0000-0000-000000000001','Sportpark Gelsenkirchen','Auf der Reihe 59, 45884 Gelsenkirchen') on conflict(id) do nothing;
insert into public.system_settings(key,value) values('report_send_time','"08:00"'),('parent_cancellation_enabled','false') on conflict(key) do nothing;
