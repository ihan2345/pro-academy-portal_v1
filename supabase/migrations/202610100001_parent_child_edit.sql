begin;
-- Limited self-service RPC; no general UPDATE policy for parents.
create function public.update_own_child_profile(target_parent uuid, target_child uuid, new_first_name text, new_last_name text, new_birth_year integer, new_team text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or public.current_role() is distinct from 'parent'::public.app_role then
  raise exception 'Keine Berechtigung.' using errcode='42501';
 end if;
 -- Keep the link valid throughout the update, including concurrent unlinking.
 perform pp.id from public.parent_players pp join public.parents p on p.id=pp.parent_id
 where pp.parent_id=target_parent and pp.player_id=target_child
 and p.auth_user_id=auth.uid() and p.archived_at is null for share of pp,p;
 if not found then raise exception 'Kind nicht verfügbar.' using errcode='42501'; end if;
 new_first_name:=btrim(new_first_name); new_last_name:=btrim(new_last_name); new_team:=btrim(new_team);
 if new_first_name is null or length(new_first_name) not between 1 and 100
 or new_last_name is null or length(new_last_name) not between 1 and 100
 or new_team is null or length(new_team)>40
 or (new_birth_year is not null and new_birth_year not between 1990 and 2100) then
  raise exception 'Ungültige Kinderdaten.' using errcode='22023';
 end if;
 perform set_config('app.audit_reason','Kinderdaten durch verknüpften Elternteil aktualisiert',true);
 update public.players set first_name=new_first_name,last_name=new_last_name,birth_year=new_birth_year,team=new_team
 where id=target_child and archived_at is null;
 if not found then raise exception 'Kind nicht verfügbar.' using errcode='42501'; end if;
end $$;
revoke all on function public.update_own_child_profile(uuid,uuid,text,text,integer,text) from public,anon;
grant execute on function public.update_own_child_profile(uuid,uuid,text,text,integer,text) to authenticated;
commit;
