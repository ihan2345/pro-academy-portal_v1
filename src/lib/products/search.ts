import type { Product } from "./domain";

// Keep in sync with normalize_product_shop_search in migration 040.
export function normalizeProductSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]/gu, "");
}
export function productSearchTerms(value: string) {
  if (!value.trim()) return [];
  const terms = [
    ...new Set(
      value.trim().split(/\s+/u).map(normalizeProductSearch).filter(Boolean),
    ),
  ];
  // A punctuation-only query must not become an unrestricted catalogue request.
  return terms.length ? terms : ["~"];
}
const aliases: Record<Product["kind"], string> = {
  subscription: "Abonnement Abo",
  camp: "Camp",
  gift: "Geschenk Geschenkkarte Gutschein Guthabenkarte",
  other: "Sonstiges",
};
export function productShopSearchText(
  product: Pick<
    Product,
    "name" | "short_description" | "description" | "category" | "kind"
  >,
) {
  return normalizeProductSearch(
    [
      product.name,
      product.short_description,
      product.description,
      product.category,
      aliases[product.kind],
    ].join(" "),
  );
}
export function matchesProductSearch(
  product: Parameters<typeof productShopSearchText>[0],
  terms: string[],
) {
  if (!terms.length) return true;
  const text = productShopSearchText(product);
  return terms.every((term) => text.includes(term));
}
