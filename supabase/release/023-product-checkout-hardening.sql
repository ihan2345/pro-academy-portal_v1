begin;
alter table product_purchase_intents add column channel text not null default 'catalog' check(channel in ('catalog','parents','trials','homepage'));
alter table product_purchase_intents add column camp_details jsonb;
alter table product_purchase_intents alter column expires_at set default now()+interval '45 minutes';
create unique index catalog_one_active_price on catalog_products((published->'price'->>'id')) where status in ('active','exclusive','internal');
-- Keep the order's original channel and explicit camp profile details.
do $$ declare d text; begin
 d:=pg_get_functiondef('public.reserve_product_purchase(jsonb)'::regprocedure);
 d:=replace(d,'currency)\n values(', 'currency,channel,camp_details)\n values(');
 d:=replace(d,$a$data->'price'->>'currency') returning * into prior;$a$, $a$data->'price'->>'currency',coalesce(input->>'channel','catalog'),nullif(input->'camp_details','null'::jsonb)) returning * into prior;$a$);
 -- pg_get_functiondef preserves function body newlines (not SQL string escapes).
 d:=replace(d,'currency)'||chr(10)||' values(', 'currency,channel,camp_details)'||chr(10)||' values(');
 execute d;
 d:=pg_get_functiondef('public.fulfill_product_purchase(jsonb)'::regprocedure);
 d:=replace(d,$a$coalesce(i.player_data,to_jsonb(child))$a$, $a$coalesce(i.camp_details,i.player_data,to_jsonb(child))$a$);
 d:=replace(d,$a$'birth_date',child.camp_birth_date,'gender',coalesce(child.camp_gender,'keine Angabe'),'clothing_size',coalesce(nullif(child.camp_clothing_size,''),'M')$a$, $a$'birth_date',coalesce(i.camp_details->>'birth_date',i.player_data->>'birth_date',child.camp_birth_date::text),'gender',coalesce(i.camp_details->>'gender',child.camp_gender,'keine Angabe'),'clothing_size',coalesce(i.camp_details->>'clothing_size',i.player_data->>'clothing_size',child.camp_clothing_size)$a$);
 d:=replace(d,' select * into parent from parents', $a$ if input->>'context_version' is distinct from product_context_version() then raise exception 'Berechtigungsdaten geändert; erneut prüfen';end if;$a$||chr(10)||' select * into parent from parents');
 execute d;
end $$;
notify pgrst,'reload schema';
commit;
