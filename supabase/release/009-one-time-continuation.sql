-- One-time, explicitly authorized continuations. Funding/beneficiary records are
-- inserted separately, never inferred from a late payment or an invoice retry.
begin;
create table public.entitlement_continuation_exceptions (
 id uuid primary key default gen_random_uuid(),
 period_id uuid not null unique references public.entitlement_periods(id),
 player_id uuid not null references public.players(id),
 funding_invoice_id text not null,
 reason text not null check(length(trim(reason))>=3),
 created_at timestamptz not null default now(),
 replacement_period_id uuid references public.entitlement_periods(id),
 replacement_invoice_id text,
 replaced_at timestamptz,
 check ((replaced_at is null and replacement_period_id is null and replacement_invoice_id is null)
     or (replaced_at is not null and replacement_period_id is not null and replacement_invoice_id is not null))
);
alter table public.entitlement_continuation_exceptions enable row level security;
revoke all on public.entitlement_continuation_exceptions from public,anon,authenticated;
grant select,insert,update on public.entitlement_continuation_exceptions to service_role;
create trigger audit_change after insert or update on public.entitlement_continuation_exceptions
 for each row execute function public.audit_change();

-- A cancelled source subscription must not suspend a separately granted exception.
create function public.protect_continuation_status() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if exists (select 1 from entitlement_continuation_exceptions x where x.period_id=old.id and x.replaced_at is not null) then
  new.status:='void';
 elsif old.status='active' and new.status<>'active' and exists (
  select 1 from entitlement_continuation_exceptions x where x.period_id=old.id and x.replaced_at is null
 ) then new.status:='active'; end if;
 return new;
end $$;
revoke all on function public.protect_continuation_status() from public,anon,authenticated;
create trigger protect_continuation_status before update of status on public.entitlement_periods
 for each row execute function public.protect_continuation_status();

-- Only a successfully processed, actually paid subscription invoice can replace
-- an exception. Exact beneficiary, customer, item and invoice window must agree.
create function public.resolve_entitlement_continuation(beneficiary uuid) returns void
language plpgsql security definer set search_path=public as $$
declare exception_row record; replacement record;
begin
 for exception_row in
  select x.*, p.starts_at manual_start from entitlement_continuation_exceptions x
  join entitlement_periods p on p.id=x.period_id
  where x.player_id=beneficiary and x.replaced_at is null for update of x
 loop
  select p.id period_id, w.payload#>>'{data,object,id}' invoice_id into replacement
  from entitlement_periods p
  join subscriptions s on s.id=p.subscription_id
  join subscription_players m on m.subscription_id=s.id and m.player_id=p.player_id and m.stripe_item_id=p.stripe_item_id
  join stripe_webhook_events w on w.type='invoice.paid' and w.status='processed'
  cross join lateral jsonb_array_elements(coalesce(w.payload#>'{data,object,lines,data}','[]'::jsonb)) line
  where p.player_id=beneficiary and p.id<>exception_row.period_id
   and p.status='active' and p.ends_at>exception_row.manual_start
   and w.stripe_created>=extract(epoch from exception_row.created_at)
   and w.payload#>>'{data,object,status}'='paid'
   and coalesce((w.payload#>>'{data,object,amount_paid}')::bigint,0)>0
   and w.payload#>>'{data,object,id}'<>exception_row.funding_invoice_id
   and coalesce(w.payload#>>'{data,object,parent,subscription_details,subscription,id}',w.payload#>>'{data,object,parent,subscription_details,subscription}',w.payload#>>'{data,object,subscription}')=s.stripe_subscription_id
   and coalesce(w.payload#>>'{data,object,customer,id}',w.payload#>>'{data,object,customer}')=s.stripe_customer_id
   and coalesce(line#>>'{parent,subscription_item_details,subscription_item,id}',line#>>'{parent,subscription_item_details,subscription_item}',line->>'subscription_item')=p.stripe_item_id
   and coalesce(line#>>'{pricing,price_details,price,id}',line#>>'{pricing,price_details,price}',line#>>'{price,id}')=p.stripe_price_id
   and coalesce((line#>>'{parent,subscription_item_details,proration}')::boolean,false)=false
   and p.starts_at>=to_timestamp((line#>>'{period,start}')::double precision)
   and p.ends_at<=to_timestamp((line#>>'{period,end}')::double precision)
  order by w.stripe_created desc, p.starts_at desc limit 1;
  if replacement.period_id is null then continue; end if;
  perform set_config('app.audit_reason','Einmalige Fortführung durch neue bezahlte Aboperiode abgelöst',true);
  update entitlement_continuation_exceptions set replacement_period_id=replacement.period_id,
   replacement_invoice_id=replacement.invoice_id,replaced_at=now() where id=exception_row.id;
  -- Historical/confirmed participation remains on its original period. Only future,
  -- planned appointments fitting the new paid period are moved automatically.
  update event_participants ep set period_id=p.id,revision=ep.revision+1
  from entitlement_periods p, training_events e
  where p.id=replacement.period_id and e.id=ep.event_id
   and ep.period_id=exception_row.period_id and ep.status='planned' and not ep.removed_from_event
   and e.status='scheduled' and e.starts_at>now()
   and e.starts_at>=p.starts_at and e.starts_at<p.ends_at
   and (case when e.event_type='Athletiktraining' then p.athletics_units>0 else p.included_units-p.athletics_units>0 end);
  update entitlement_periods set status='void' where id=exception_row.period_id;
 end loop;
end $$;
revoke all on function public.resolve_entitlement_continuation(uuid) from public,anon,authenticated;
grant execute on function public.resolve_entitlement_continuation(uuid) to service_role;

create function public.continuation_invoice_processed() returns trigger
language plpgsql security definer set search_path=public as $$
declare beneficiary uuid;
begin
 if new.type='invoice.paid' and new.status='processed' and (tg_op='INSERT' or old.status is distinct from new.status) then
  for beneficiary in select distinct player_id from entitlement_continuation_exceptions where replaced_at is null loop
   perform public.resolve_entitlement_continuation(beneficiary);
  end loop;
 end if;
 return new;
end $$;
revoke all on function public.continuation_invoice_processed() from public,anon,authenticated;
create trigger continuation_invoice_processed after insert or update of status on public.stripe_webhook_events
 for each row execute function public.continuation_invoice_processed();

-- Also handle later manual assignment after an invoice was already processed.
create function public.continuation_period_created() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status='active' then perform public.resolve_entitlement_continuation(new.player_id); end if;
 return new;
end $$;
revoke all on function public.continuation_period_created() from public,anon,authenticated;
create trigger continuation_period_created after insert on public.entitlement_periods
 for each row execute function public.continuation_period_created();
notify pgrst, 'reload schema';
commit;
