begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Synchronise only after a booking has passed payment and ownership checks.
-- No historical profile rewrite and no new family matching by email.
create function public.camp_sync_paid_profiles() returns trigger
language plpgsql set search_path=public as $$
declare family parents; kid players; born date; submitted_gender text; size text; telephone text; submitted_at timestamptz;
begin
 if new.status<>'paid' or new.parent_id is null or new.player_id is null
 or new.booking_origin not in ('checkout','portal_checkout','api_checkout') then return new;end if;
 if TG_OP='UPDATE' then if old.status='paid' then return new;end if;end if;
 select p.* into family from parents p join parent_players pp on pp.parent_id=p.id
 where p.id=new.parent_id and pp.player_id=new.player_id and p.archived_at is null for update of p,pp;
 if not found then return new;end if;
 select * into kid from players where id=new.player_id and archived_at is null for update;
 if not found then return new;end if;
 -- A confirmed family association does not authorize replacing its email or identity.
 if lower(btrim(family.contact_email)) is distinct from lower(btrim(new.parent_data->>'email')) then return new;end if;
 submitted_at:=coalesce((select created_at from product_purchase_intents where id=new.product_intent_id),new.created_at);
 telephone:=nullif(btrim(new.parent_data->>'phone'),'');
 if telephone is not null and length(telephone)<=50
 and (family.updated_at<=submitted_at or family.created_at>=submitted_at)
 and (family.profile_self_service_updated_at is null or family.profile_self_service_updated_at<=submitted_at) then
  update parents set phone=telephone where id=family.id and phone is distinct from telephone;
 end if;
 if lower(btrim(kid.first_name)) is distinct from lower(btrim(new.child_data->>'first_name'))
 or lower(btrim(kid.last_name)) is distinct from lower(btrim(new.child_data->>'last_name')) then return new;end if;
 begin born:=nullif(new.child_data->>'birth_date','')::date;
 exception when invalid_datetime_format or datetime_field_overflow then return new;end;
 if born is not null and (born>current_date or extract(year from born) not between 1990 and 2100
  or kid.camp_birth_date is not null and kid.camp_birth_date<>born
  or kid.birth_year is not null and kid.birth_year<>extract(year from born)) then return new;end if;
 -- A delayed payment must not overwrite a profile edited after Checkout began.
 if kid.updated_at>submitted_at and kid.created_at<submitted_at then return new;end if;
 submitted_gender:=case when new.child_data->>'gender' in ('männlich','weiblich','divers') then new.child_data->>'gender' end;
 size:=nullif(btrim(new.child_data->>'clothing_size'),'');
 if length(size)>20 then size:=null;end if;
 update players set camp_birth_date=coalesce(kid.camp_birth_date,born),
  birth_year=coalesce(kid.birth_year,extract(year from coalesce(kid.camp_birth_date,born))::int),
  gender=coalesce(submitted_gender,kid.gender),camp_gender=coalesce(submitted_gender,kid.camp_gender),
  camp_clothing_size=coalesce(size,kid.camp_clothing_size)
 where id=kid.id and (camp_birth_date,birth_year,gender,camp_gender,camp_clothing_size) is distinct from
 (coalesce(kid.camp_birth_date,born),coalesce(kid.birth_year,extract(year from coalesce(kid.camp_birth_date,born))::int),
 coalesce(submitted_gender,kid.gender),coalesce(submitted_gender,kid.camp_gender),coalesce(size,kid.camp_clothing_size));
 return new;
end $$;
revoke all on function public.camp_sync_paid_profiles() from public,anon,authenticated;
create trigger camp_sync_paid_profiles after insert or update of status on public.camp_bookings
 for each row execute function public.camp_sync_paid_profiles();
-- Keep the existing proof/identity/materialisation logic. Replace its incomplete
-- early update with the shared post-confirmation synchronisation above.
do $$ declare original text; changed text; begin
 original:=pg_get_functiondef('public.camp_confirm_payment(jsonb)'::regprocedure);
 changed:=replace(original,$s$update public.players set camp_birth_date=coalesce(camp_birth_date,(b.child_data->>'birth_date')::date),camp_gender=b.child_data->>'gender',camp_clothing_size=b.child_data->>'clothing_size' where id=kid;$s$,
 'null; -- camp_sync_paid_profiles runs after the confirmed status transition.');
 if changed=original then raise exception 'Unexpected Camp profile confirmation baseline';end if;execute changed;
 original:=pg_get_functiondef('public.fulfill_product_purchase_before_guest(jsonb)'::regprocedure);
 changed:=replace(original,$s$jsonb_build_object('name',parent.full_name,'email',parent.contact_email),jsonb_build_object$s$,
 $s$jsonb_build_object('name',parent.full_name,'email',parent.contact_email,'phone',coalesce(nullif(btrim(i.camp_details->>'phone'),''),nullif(btrim(i.guest_data->>'phone'),''),parent.phone)),jsonb_build_object$s$);
 if changed=original then raise exception 'Unexpected Camp parent snapshot baseline';end if;execute changed;
end $$;
notify pgrst,'reload schema';
commit;
