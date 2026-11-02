begin;
-- Search uses only the published snapshot, never internal names or draft content.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create function public.normalize_product_shop_search(value text) returns text
language sql immutable parallel safe set search_path=pg_catalog as $$
 select regexp_replace(normalize(replace(replace(replace(lower(coalesce(value,'')),'ß','ss'),'æ','ae'),'œ','oe'),NFKD),'[^[:alnum:]]','','g');
$$;
alter table public.catalog_products add column published_shop_search text generated always as (
 public.normalize_product_shop_search(
  coalesce(published->>'name','') || ' ' || coalesce(published->>'short_description','') || ' ' ||
  coalesce(published->>'description','') || ' ' || coalesce(published->>'category','') || ' ' ||
  case published->>'kind' when 'subscription' then 'Abonnement Abo' when 'camp' then 'Camp'
   when 'gift' then 'Geschenk Geschenkkarte Gutschein Guthabenkarte' when 'other' then 'Sonstiges' else '' end
 )
) stored;
-- pg_trgm may already be installed in another schema on existing databases.
do $$ declare extension_schema text; begin
 select n.nspname into extension_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
 execute format('create index product_public_shop_search on public.catalog_products using gin (published_shop_search %I.gin_trgm_ops)', extension_schema);
end $$;
commit;
