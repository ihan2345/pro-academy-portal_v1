-- Local preparation only; publish explicitly before the matching portal version.
begin;
alter table public.players
 add column gender text check(gender in ('männlich','weiblich','divers')),
 add column club text check(length(club)<=120),
 add column position text check(length(position)<=80),
 add column strong_foot text check(strong_foot in ('rechts','links','beidfüßig')),
 add column height_cm integer check(height_cm between 50 and 250),
 add column development_goals text check(length(development_goals)<=2000);

-- Existing RPC remains available for older clients. Both updates are one transaction.
create function public.update_own_child_profile_details(
 target_parent uuid, target_child uuid, new_first_name text, new_last_name text,
 new_birth_year integer, new_team text, details jsonb default '{}'
) returns void language plpgsql security definer set search_path=public as $$
begin
 if details is null or jsonb_typeof(details)<>'object' then raise exception 'Ungültige Zusatzangaben.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_each(details) item where
  item.key not in ('gender','club','position','strong_foot','height_cm','development_goals')
  or (item.key<>'height_cm' and jsonb_typeof(item.value) not in ('string','null'))
  or (item.key='height_cm' and jsonb_typeof(item.value) not in ('number','null'))
 ) then raise exception 'Ungültige Zusatzangaben.' using errcode='22023'; end if;
 perform public.update_own_child_profile(target_parent,target_child,new_first_name,new_last_name,new_birth_year,new_team);
 update public.players set
 gender=case when details ? 'gender' then nullif(btrim(details->>'gender'),'') else gender end,
 club=case when details ? 'club' then nullif(btrim(details->>'club'),'') else club end,
 position=case when details ? 'position' then nullif(btrim(details->>'position'),'') else position end,
 strong_foot=case when details ? 'strong_foot' then nullif(btrim(details->>'strong_foot'),'') else strong_foot end,
 height_cm=case when details ? 'height_cm' then (details->>'height_cm')::integer else height_cm end,
 development_goals=case when details ? 'development_goals' then nullif(btrim(details->>'development_goals'),'') else development_goals end
 where id=target_child;
end $$;
revoke all on function public.update_own_child_profile_details(uuid,uuid,text,text,integer,text,jsonb) from public,anon;
grant execute on function public.update_own_child_profile_details(uuid,uuid,text,text,integer,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
