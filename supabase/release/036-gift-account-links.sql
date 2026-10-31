-- Local preparation only: durable profile associations; balances and redemption remain unchanged.
begin;
create table gift_account_links(
 auth_id uuid not null references profiles(id) on delete cascade,
 order_id uuid not null references gift_orders(id),scope text not null check(scope in('buyer','recipient')),
 created_at timestamptz not null default now(),primary key(auth_id,order_id,scope)
);
create unique index gift_account_recipient_owner on gift_account_links(order_id) where scope='recipient';
create index gift_account_owner on gift_account_links(auth_id,created_at desc);
create index gift_orders_buyer_email on gift_orders(livemode,lower(buyer->>'email'));
create index gift_orders_recipient_email on gift_orders(livemode,lower(recipient->>'email'));
create index gift_use_code_lookup on gift_code_uses(code_hash);
alter table gift_account_links enable row level security;
revoke all on gift_account_links from public,anon,authenticated;grant all on gift_account_links to service_role;
create function gift_account_email(uid uuid) returns text language plpgsql stable security definer set search_path=public as $$declare mail text;begin
 select lower(btrim(u.email)) into mail from auth.users u join profiles p on p.id=u.id where u.id=uid and u.email_confirmed_at is not null and p.role='parent';
 if mail is null then raise exception 'Bestätigtes Elternkonto erforderlich';end if;return mail;
end$$;
create function gift_account_state(input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=(input->>'auth_id')::uuid;mode boolean:=(input->>'livemode')::boolean;mail text;cards jsonb;
begin
 mail:=gift_account_email(uid);
 insert into gift_account_links(auth_id,order_id,scope)select uid,o.id,'buyer' from gift_orders o join gift_cards g on g.order_id=o.id where o.livemode=mode and (o.auth_id=uid or lower(btrim(o.buyer->>'email'))=mail) on conflict do nothing;
 insert into gift_account_links(auth_id,order_id,scope)select uid,o.id,'recipient' from gift_orders o join gift_cards g on g.order_id=o.id where o.livemode=mode and lower(btrim(o.recipient->>'email'))=mail on conflict do nothing;
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',o.id,'roles',r.roles,'initial_amount',o.amount,'status',o.status,'currency',o.currency,'created_at',o.created_at,'buyer_name',o.buyer->>'full_name',
 'recipient_name',concat_ws(' ',o.recipient->>'first_name',o.recipient->>'last_name'),'expires_at',g.expires_at,
 'remaining',case when r.received then g.remaining else null end,'reserved',case when r.received then g.reserved else null end,
 'available',case when r.received and o.status='issued' and g.status='issued' and g.expires_at>now() then g.remaining-g.reserved else 0 end,
 'gift_status',case when not r.received then o.status when g.status<>'issued' then g.status when g.remaining=0 then 'spent' when g.expires_at<=now() then 'expired' when g.reserved>0 then 'reserved' else 'issued' end,
 'code_cipher',case when r.received and o.status='issued' and g.status='issued' and g.remaining>0 and g.expires_at>now() then g.code_cipher else null end
 )order by o.created_at desc,o.id),'[]'::jsonb) into cards
 from(select order_id,jsonb_agg(scope order by scope) roles,bool_or(scope='recipient') received from gift_account_links where auth_id=uid group by order_id)r
 join gift_orders o on o.id=r.order_id join gift_cards g on g.order_id=o.id where o.livemode=mode;
 return jsonb_build_object('cards',cards,'available',(select coalesce(sum((x->>'available')::int),0)from jsonb_array_elements(cards)x),'has_cards',jsonb_array_length(cards)>0);
end$$;
create function gift_account_link(input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=(input->>'auth_id')::uuid;mode boolean:=(input->>'livemode')::boolean;mail text;o gift_orders;target_scope text;keyhash text:=input->>'status_hash';ch text:=input->>'code_hash';
begin
 mail:=gift_account_email(uid);
 if nullif(keyhash,'') is not null then
  select * into o from gift_orders where id=(input->>'order_id')::uuid and livemode=mode and (access_hash=keyhash or recipient_access_hash=keyhash) for update;
  target_scope:=case when o.recipient_access_hash=keyhash then 'recipient' else 'buyer' end;
 else
  select * into o from gift_orders where livemode=mode and id in(
   select order_id from gift_cards where code_hash=ch
   union select g.order_id from gift_code_uses u join gift_cards g on g.id=u.gift_id where u.code_hash=ch
  ) for update;
  if lower(btrim(o.recipient->>'email'))=mail then target_scope:='recipient';
  elsif o.auth_id=uid or lower(btrim(o.buyer->>'email'))=mail then target_scope:='buyer';end if;
 end if;
 if o.id is null or target_scope is null or not exists(select 1 from gift_cards where order_id=o.id) then raise exception 'Karte konnte nicht zugeordnet werden. Bitte nutze die bestätigte Empfängeradresse oder deinen persönlichen Statuslink.';end if;
 if target_scope='recipient' and exists(select 1 from gift_account_links l where l.order_id=o.id and l.scope='recipient' and l.auth_id<>uid) then raise exception 'Diese Geschenkkarte ist bereits mit einem anderen Elternkonto verknüpft.';end if;
 insert into gift_account_links(auth_id,order_id,scope)values(uid,o.id,target_scope)on conflict do nothing;
 return gift_account_state(input)||jsonb_build_object('linked_order',o.id,'linked_scope',target_scope);
end$$;
revoke all on function gift_account_email(uuid),gift_account_state(jsonb),gift_account_link(jsonb) from public,anon,authenticated;
grant execute on function gift_account_state(jsonb),gift_account_link(jsonb) to service_role;
commit;
