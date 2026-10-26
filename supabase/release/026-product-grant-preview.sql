begin;
create function public.apply_product_grant_change(input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare p catalog_products; change jsonb:=input->'change'; data jsonb:=change->'data';
begin
 if not exists(select 1 from profiles where id=(input->>'actor_id')::uuid and role='admin') then raise exception 'Admin erforderlich';end if;
 select * into p from catalog_products where id=(input->>'product_id')::uuid for update;
 if not found or p.revision is distinct from (input->>'revision')::int or input->>'context_version' is distinct from product_context_version() then raise exception 'Vorschau veraltet';end if;
 if change->>'action'='add' then
  if data->>'purpose' not in ('visibility','purchase','usage') or length(btrim(data->>'reason'))<3 then raise exception 'Freigabe unvollständig';end if;
  if not exists(select 1 from parents where id=(data->>'parent_id')::uuid and archived_at is null) then raise exception 'Familie fehlt';end if;
  if nullif(data->>'player_id','') is not null and not exists(select 1 from parent_players where parent_id=(data->>'parent_id')::uuid and player_id=(data->>'player_id')::uuid) and not exists(select 1 from trial_players t join trial_families f on f.id=t.family_id where t.id=(data->>'player_id')::uuid and f.parent_id=(data->>'parent_id')::uuid) then raise exception 'Kind passt nicht';end if;
  insert into catalog_product_grants(product_id,parent_id,player_id,purpose,expires_at,reason) values(p.id,(data->>'parent_id')::uuid,nullif(data->>'player_id','')::uuid,data->>'purpose',nullif(data->>'expires_at','')::timestamptz,data->>'reason');
 elsif change->>'action'='remove' then
  delete from catalog_product_grants where id=(change->>'grant_id')::uuid and product_id=p.id;
 else raise exception 'Freigabeaktion ungültig';end if;
end $$;
revoke all on function apply_product_grant_change(jsonb) from public,anon,authenticated;
grant execute on function apply_product_grant_change(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
