-- Local preparation only. Apply explicitly with the parent-profile release.
begin;
alter table public.parents add column phone text check(phone is null or length(phone)<=50);
alter table public.parents add column city text check(city is null or length(city)<=120);
alter table public.parents add column profile_self_service_updated_at timestamptz;

-- No new table UPDATE policy: direct REST writes by parents remain forbidden.
create function public.update_parent_profile(target uuid, new_phone text, new_city text)
returns timestamptz language plpgsql security definer set search_path=public as $$
declare p public.parents; actor_role public.app_role; next_edit timestamptz;
begin
 actor_role:=public.current_role();
 if auth.uid() is null or actor_role is null or actor_role not in ('parent','admin') then
  raise exception 'Keine Berechtigung.' using errcode='42501';
 end if;
 select * into p from public.parents where id=target and archived_at is null for update;
 if not found or (actor_role='parent' and p.auth_user_id is distinct from auth.uid()) then
  raise exception 'Profil nicht verfügbar.' using errcode='42501';
 end if;
 new_phone:=nullif(btrim(new_phone),''); new_city:=nullif(btrim(new_city),'');
 if length(new_phone)>50 or length(new_city)>120 then raise exception 'Kontaktangaben zu lang.' using errcode='22023'; end if;
 next_edit:=p.profile_self_service_updated_at + interval '168 hours';
 if p.phone is not distinct from new_phone and p.city is not distinct from new_city then return next_edit; end if;
 if actor_role='parent' and next_edit>clock_timestamp() then
  raise exception 'Profil kann nur einmal innerhalb von sieben Tagen geändert werden.' using errcode='P0001';
 end if;
 update public.parents set phone=new_phone,city=new_city,
  profile_self_service_updated_at=case when actor_role='parent' then clock_timestamp() else profile_self_service_updated_at end
 where id=target returning profile_self_service_updated_at + interval '168 hours' into next_edit;
 return next_edit;
end $$;
revoke all on function public.update_parent_profile(uuid,text,text) from public,anon;
grant execute on function public.update_parent_profile(uuid,text,text) to authenticated;
commit;
