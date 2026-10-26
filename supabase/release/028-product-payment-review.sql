begin;
alter table product_payment_links add column charge_state text not null default '';
alter table product_payment_links add column review_resolved_at timestamptz;
alter table product_payment_links add column review_resolved_by uuid references profiles(id);
create function resolve_product_payment_review(input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare payment product_payment_links; sub subscriptions;
begin
 if not is_admin() or length(btrim(coalesce(input->>'reason',''))) < 5 then raise exception 'Admin und Prüfgrund erforderlich';end if;
 select * into payment from product_payment_links where id=(input->>'id')::uuid for update;
 if payment.id is null or payment.status not in('refunded','review') then raise exception 'Zahlungsprüfung fehlt';end if;
 perform set_config('app.audit_reason',input->>'reason',true);
 update product_payment_links set review_resolved_at=now(),review_resolved_by=auth.uid(),reason=coalesce(reason,'')||' · Adminprüfung: '||(input->>'reason'),updated_at=now() where id=payment.id;
 if payment.subscription_id is not null then
  select * into sub from subscriptions where stripe_subscription_id=payment.subscription_id for update;
  if sub.id is not null and not exists(select 1 from product_payment_links where subscription_id=payment.subscription_id and status in('review','refunded') and review_resolved_at is null)
   and not exists(select 1 from subscription_assignment_reviews where subscription_id=sub.id and status='pending')
   and (sub.status not in('active','trialing') or not exists(
     select 1 from jsonb_array_elements(sub.stripe_data->'items') item where not exists(
      select 1 from subscription_players m join plans t on t.stripe_price_id=item->>'price_id'
       cross join lateral allowance_windows((item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz,t.billing_interval) w
       join entitlement_periods e on e.subscription_id=m.subscription_id and e.player_id=m.player_id and e.stripe_item_id=m.stripe_item_id
      where m.subscription_id=sub.id and m.stripe_item_id=item->>'id' and w.starts_at<=now() and w.ends_at>now()
       and e.starts_at=w.starts_at and e.ends_at=w.ends_at and e.status=sub.status and e.stripe_price_id=t.stripe_price_id and e.included_units=t.included_units and e.athletics_units=t.athletics_units
     )))
   and jsonb_array_length(sub.stripe_data->'items')>0
   and not exists(select 1 from jsonb_array_elements(sub.stripe_data->'items') item where coalesce((item->>'quantity')::int,1)<>1 or not exists(select 1 from plans where stripe_price_id=item->>'price_id' and active) or not exists(select 1 from subscription_players where subscription_id=sub.id and stripe_item_id=item->>'id')) then
    update subscriptions set needs_review=false where id=sub.id;
    update product_purchase_intents set status='fulfilled',reason='Zahlungsprüfung dokumentiert: '||(input->>'reason'),updated_at=now() where subscription_id=payment.subscription_id and product->>'kind'='subscription' and status='review' and proof is not null;
  end if;
 end if;
end $$;
revoke all on function resolve_product_payment_review(jsonb) from public,anon,service_role;
grant execute on function resolve_product_payment_review(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
