-- Read-only check for Release 049. Changes nothing, sends nothing.
-- Lists every active family with a paid Camp booking and no Stripe mapping,
-- with the result the code request would give after Release 049.
select p.full_name,
       lower(btrim(p.contact_email)) as email,
       (select count(*) from parents x where x.archived_at is null
         and lower(btrim(x.contact_email))=lower(btrim(p.contact_email))) as profiles_with_email,
       p.auth_user_id is not null as already_linked,
       (select count(*) from camp_bookings b where b.parent_id=p.id and b.status='paid' and b.paid_at is not null) as paid_camp_bookings,
       (select max(b.paid_at) from camp_bookings b where b.parent_id=p.id and b.status='paid') as last_paid_at,
       (select count(*) from parent_players pp where pp.parent_id=p.id) as children,
       exists(select 1 from auth.users u where lower(btrim(u.email))=lower(btrim(p.contact_email))) as auth_user_exists,
       case when to_regprocedure('public.parent_self_activation_available(text)') is not null
            then parent_self_activation_available(p.contact_email) end as code_request_allowed
from parents p
where p.archived_at is null
  and not exists(select 1 from parent_stripe_customers s where s.parent_id=p.id)
  and exists(select 1 from camp_bookings b where b.parent_id=p.id and b.status='paid' and b.paid_at is not null)
order by last_paid_at desc;
