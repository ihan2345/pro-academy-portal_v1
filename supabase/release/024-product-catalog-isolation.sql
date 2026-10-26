begin;
-- Draft edits must never influence the public search, filters or ordering.
alter table catalog_products add column published_sort_order int not null default 0;
alter table catalog_products add column published_search_document tsvector generated always as (to_tsvector('simple',coalesce(published->>'name','')||' '||coalesce(published->>'short_description','')||' '||coalesce(published->>'category',''))) stored;
update catalog_products set published_sort_order=coalesce((published->>'sort_order')::int,0);
create index product_public_order on catalog_products(published_sort_order,id) where published is not null;
create index product_public_search on catalog_products using gin(published_search_document);
do $$ declare d text; begin
 d:=pg_get_functiondef('public.publish_catalog_product(jsonb)'::regprocedure);
 d:=replace(d,' data:=p.draft;', ' if p.published_revision=p.revision then return;end if;'||chr(10)||' data:=p.draft;');
 d:=replace(d,$a$data->'price'->>'livemode' is distinct from 'false'$a$,$a$data->'price'->>'livemode' is distinct from 'false' or data->'price'->>'source' is distinct from 'stripe'$a$);
 d:=replace(d,'published=data,published_revision=revision,','published=data,published_sort_order=(data->>''sort_order'')::int,published_revision=revision,');
 execute d;
 d:=pg_get_functiondef('public.fulfill_product_purchase(jsonb)'::regprocedure);
 if position('#variable_conflict use_variable' in d)=0 then
  d:=replace(d,'declare i product_purchase_intents;', '#variable_conflict use_variable'||chr(10)||'declare i product_purchase_intents;');
  execute d;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
