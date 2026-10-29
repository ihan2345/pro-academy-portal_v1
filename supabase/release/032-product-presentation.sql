-- Additive presentation fields live in the existing draft/published JSON.
-- Legacy sort_order values stay intact; priority defaults to 0 for old products.
alter table public.catalog_products
  add column priority int generated always as
    (coalesce((draft->>'priority')::int, 0)) stored,
  add column published_priority int generated always as
    (coalesce((published->>'priority')::int, 0)) stored;

create index catalog_product_priority
  on public.catalog_products(priority desc, created_at desc, id desc);
create index catalog_product_published_priority
  on public.catalog_products(published_priority desc, created_at desc, id desc)
  where published is not null;

notify pgrst, 'reload schema';
