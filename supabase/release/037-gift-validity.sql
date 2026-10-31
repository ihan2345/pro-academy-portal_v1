begin;
-- Existing cards retain their original expiry. New cards follow the agreed calendar-year rule.
alter table gift_settings add column validity_rule text not null default 'purchase_year_plus_three'
 check(validity_rule='purchase_year_plus_three');
alter table gift_settings alter column validity_months set default 36;
update gift_settings set validity_months=36;
create function gift_expiry(paid_at timestamptz) returns timestamptz
 language sql immutable strict set search_path=public as $$
 select make_timestamptz(extract(year from paid_at at time zone 'Europe/Berlin')::int+4,1,1,0,0,0,'Europe/Berlin')-interval '1 millisecond'
$$;
do $$declare d text;changed text;begin
 select pg_get_functiondef('gift_issue_paid_order(jsonb)'::regprocedure) into d;
 changed:=replace(d,$a$(input->>'paid_at')::timestamptz+make_interval(months=>months)$a$,$b$gift_expiry((input->>'paid_at')::timestamptz)$b$);
 if changed=d then raise exception 'Unexpected gift issuer';end if;execute changed;
end$$;
revoke all on function gift_expiry(timestamptz) from public,anon,authenticated;
grant execute on function gift_expiry(timestamptz) to service_role;
commit;
