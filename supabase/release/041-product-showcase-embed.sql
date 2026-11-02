begin;
-- One revocable, public showcase share. No catalogue management or family access.
create table public.product_showcase_share (
 singleton boolean primary key default true check(singleton),
 token text check(token ~ '^[a-f0-9]{64}$'),
 updated_at timestamptz not null default now()
);
insert into public.product_showcase_share(singleton) values(true);
alter table public.product_showcase_share enable row level security;
revoke all on public.product_showcase_share from public,anon,authenticated;
grant select on public.product_showcase_share to authenticated;
grant all on public.product_showcase_share to service_role;
create policy showcase_manager_read on public.product_showcase_share for select to authenticated using(public.can_manage_features());
create function public.rotate_product_showcase_share(candidate text, expected text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare current_token text;
begin
 if not can_manage_features() then raise exception 'Keine Berechtigung' using errcode='42501';end if;
 if candidate is null or candidate !~ '^[a-f0-9]{64}$' then raise exception 'Ungültiger Token';end if;
 select token into current_token from product_showcase_share where singleton for update;
 if current_token is distinct from expected then raise exception 'Einbettung wurde zwischenzeitlich geändert' using errcode='40001';end if;
 update product_showcase_share set token=candidate,updated_at=now() where singleton;
 insert into audit_log(actor_id,actor_type,action,table_name,record_id,new_value)
 values(auth.uid(),'admin','rotate','product_showcase_share',auth.uid(),jsonb_build_object('rotated',true));
 return jsonb_build_object('token',candidate);
end $$;
revoke all on function public.rotate_product_showcase_share(text,text) from public,anon;
grant execute on function public.rotate_product_showcase_share(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
