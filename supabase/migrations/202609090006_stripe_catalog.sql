-- Confirmed by owner on 2026-09-09. Prices read from acct_1RlAPDRoswKHkM76.
-- Owner's final correction: legacy 4/8/10, current 4/8/12; annual PRO grants 10 each month.
update public.plans set stripe_price_id='price_1RlBeSRoswKHkM76gM8jmUB5' where id='10000000-0000-0000-0000-000000000001';
update public.plans set stripe_price_id='price_1RlCyQRoswKHkM76WMvJa0zd' where id='10000000-0000-0000-0000-000000000002';
update public.plans set stripe_price_id='price_1RlD1TRoswKHkM7689gRCjfq' where id='10000000-0000-0000-0000-000000000003';
insert into public.plans(id,name,stripe_price_id,included_units,athletics_units,generation,billing_interval,is_public) values
('10000000-0000-0000-0000-000000000004','FirstTouch','price_1UAwRNRoswKHkM76bLnkqr4C',4,0,'current','month',true),
('10000000-0000-0000-0000-000000000005','GameChanger','price_1UAwPGRoswKHkM76ovSApzO6',8,0,'current','month',true),
('10000000-0000-0000-0000-000000000006','Pro-Player','price_1UAq5PRoswKHkM76YMnEB9T0',12,0,'current','month',true),
('10000000-0000-0000-0000-000000000007','Pro-Player','price_1SAEB2RoswKHkM76rG2O64pe',10,0,'legacy','year',false),
('10000000-0000-0000-0000-000000000008','NEXT LEVEL','price_1SyvxMRoswKHkM761z5XJzFl',12,4,'special','month',false);
