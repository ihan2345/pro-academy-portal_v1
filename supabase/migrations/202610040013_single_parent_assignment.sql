-- One parent account per child. Existing access must be explicitly unlinked first.
create unique index parent_players_one_parent_per_player on public.parent_players(player_id);

create or replace function public.enforce_single_parent_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and (new.parent_id is distinct from old.parent_id or new.player_id is distinct from old.player_id) then
  raise exception 'Bitte zuerst die bestehende Eltern-Kind-Zuordnung aufheben.' using errcode='23514';
 end if;
 -- Serialize competing assignments, including imports using ON CONFLICT DO NOTHING.
 perform 1 from public.players where id=new.player_id for update;
 if exists(select 1 from public.parent_players where player_id=new.player_id and parent_id<>new.parent_id) then
  raise exception 'Dieses Kind ist bereits einem Elternkonto zugeordnet. Bitte zuerst die bestehende Zuordnung aufheben.' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function public.enforce_single_parent_assignment() from public,anon,authenticated;
create trigger single_parent_assignment before insert or update on public.parent_players
for each row execute function public.enforce_single_parent_assignment();
