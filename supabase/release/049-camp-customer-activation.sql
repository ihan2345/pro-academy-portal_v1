-- Existing Camp families may activate their existing parent profile.
-- A confirmed (paid) Camp booking is now an activation basis next to the
-- Stripe customer mapping. Self-activation, invitation release and invitation
-- acceptance use the same check. Linking still happens only after a confirmed
-- email login. No user, invitation, notification job or mail is created here.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function public.parent_activation_basis_kind(pid uuid) returns text
language sql stable security definer set search_path=public as $$
 select case
  when exists(select 1 from parent_stripe_customers s where s.parent_id=pid) then 'stripe'
  when exists(select 1 from camp_bookings b where b.parent_id=pid and b.status='paid' and b.paid_at is not null) then 'paid_camp'
 end
$$;
create function public.parent_activation_basis(pid uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select parent_activation_basis_kind(pid) is not null
$$;
revoke all on function public.parent_activation_basis_kind(uuid),public.parent_activation_basis(uuid) from public,anon,authenticated;
grant execute on function public.parent_activation_basis_kind(uuid),public.parent_activation_basis(uuid) to service_role;
do $patch$
declare d text; changed text;
begin
 -- 1. Code request: unique, active family with Stripe mapping OR paid Camp booking.
 d:=pg_get_functiondef('public.parent_self_activation_available(text)'::regprocedure);
 changed:=replace(d,'and exists(select 1 from parent_stripe_customers s where s.parent_id=p.id)','and parent_activation_basis(p.id)');
 if changed=d then raise exception 'Unexpected self-activation availability baseline';end if;
 execute changed;
 -- 2. Linking after the confirmed login, with the basis recorded in the audit log.
 d:=pg_get_functiondef('public.activate_verified_parent()'::regprocedure);
 changed:=replace(d,'if not exists(select 1 from parent_stripe_customers where parent_id=p.id) then raise exception','if not parent_activation_basis(p.id) then raise exception');
 if changed=d then raise exception 'Unexpected self-activation baseline';end if;
 d:=changed;
 changed:=replace(d,$s$jsonb_build_object('method','verified_email')$s$,$s$jsonb_build_object('method','verified_email','basis',parent_activation_basis_kind(p.id))$s$);
 if changed=d then raise exception 'Unexpected self-activation audit baseline';end if;
 execute changed;
 -- 3. Invitation acceptance supports the same families as self-activation.
 d:=pg_get_functiondef('public.accept_invitation(text)'::regprocedure);
 changed:=replace(d,$s$if not exists(select 1 from parent_stripe_customers where parent_id=p.id) then raise exception 'Stripe-Zuordnung fehlt'; end if;$s$,
  $s$if not parent_activation_basis(p.id) then raise exception 'Aktivierungsgrundlage fehlt'; end if;$s$);
 if changed=d then raise exception 'Unexpected invitation acceptance baseline';end if;
 execute changed;
 -- 4. Manual invitation release accepts the same families. It stays behind the
 --    existing admin, recipient release and MANUAL_INVITATIONS_ENABLED gates.
 d:=pg_get_functiondef('public.release_parent_invitation(jsonb)'::regprocedure);
 changed:=replace(d,$s$or not exists(select 1 from parent_stripe_customers where parent_id=p.id) then raise exception 'Valid family and Stripe mapping required'$s$,
  $s$or not parent_activation_basis(p.id) then raise exception 'Valid family and activation basis required'$s$);
 if changed=d then raise exception 'Unexpected invitation release baseline';end if;
 execute changed;
end $patch$;
notify pgrst,'reload schema';
commit;
