begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- An authenticated parent's explicit request is retained with the payment quote.
-- The child is still materialised only after the canonical verified payment.
alter table public.camp_bookings add column new_child_auth_id uuid references public.profiles(id);
alter table public.camp_bookings add constraint camp_new_child_origin check(new_child_auth_id is null or (parent_id is not null and booking_origin='portal_checkout'));
create function public.camp_check_new_child() returns trigger language plpgsql set search_path=public as $$
begin
 if new.new_child_auth_id is not null then
  if new.player_id is not null or new.status<>'draft' or not exists(select 1 from parents where id=new.parent_id and auth_user_id=new.new_child_auth_id and archived_at is null and exists(select 1 from profiles where id=new.new_child_auth_id and role='parent')) then
   raise exception 'Neues Kind benötigt den bestätigten Elternzugang';end if;
 end if;return new;
end $$;
revoke all on function public.camp_check_new_child() from public,anon,authenticated;
create trigger camp_check_new_child before insert on public.camp_bookings for each row execute function public.camp_check_new_child();
do $$ declare original text; changed text; begin
 original:=pg_get_functiondef('public.camp_confirm_payment(jsonb)'::regprocedure);
 changed:=replace(original,'if not found then raise exception ''Unknown booking''; end if;',
 $s$if not found then raise exception 'Unknown booking'; end if;
 -- Match the fulfillment core's parent-before-Camp lock order.
 if b.parent_id is not null then perform 1 from parents where id=b.parent_id for update;end if;$s$);
 if changed=original then raise exception 'Unexpected Camp payment lock baseline';end if;original:=changed;
 changed:=replace(original,'pid:=b.parent_id; kid:=b.player_id;',
 $s$pid:=b.parent_id; kid:=b.player_id;
 if b.new_child_auth_id is not null and (kid is not null or not exists(select 1 from parents where id=pid and auth_user_id=b.new_child_auth_id and archived_at is null and exists(select 1 from profiles where id=b.new_child_auth_id and role='parent'))) then
  reason:='Elternzugang für das neue Kind hat sich geändert; Zuordnung prüfen';end if;$s$);
 if changed=original then raise exception 'Unexpected Camp identity baseline';end if;original:=changed;
 changed:=replace(original,$s$if not exists(select 1 from public.camp_owned_rows where table_name='parents' and record_id=pid) then raise exception 'Guest family not owned by Camp'; end if;$s$,
 $s$if not exists(select 1 from public.camp_owned_rows where table_name='parents' and record_id=pid)
 and not (b.new_child_auth_id is not null and exists(select 1 from parents where id=pid and auth_user_id=b.new_child_auth_id and archived_at is null and exists(select 1 from profiles where id=b.new_child_auth_id and role='parent'))) then
 raise exception 'Guest family not owned by Camp';end if;$s$);
 if changed=original then raise exception 'Unexpected Camp family materialisation baseline';end if;original:=changed;
 changed:=replace(original,$s$k.first_name=b.child_data->>'first_name' and k.last_name=b.child_data->>'last_name' and k.camp_birth_date=(b.child_data->>'birth_date')::date$s$,
 $s$lower(btrim(k.first_name))=lower(btrim(b.child_data->>'first_name')) and lower(btrim(k.last_name))=lower(btrim(b.child_data->>'last_name'))
 and (k.camp_birth_date=(b.child_data->>'birth_date')::date or (k.camp_birth_date is null and k.birth_year=extract(year from (b.child_data->>'birth_date')::date)))$s$);
 if changed=original then raise exception 'Unexpected Camp duplicate baseline';end if;execute changed;
end $$;
notify pgrst,'reload schema';
commit;
