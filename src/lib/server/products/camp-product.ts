import "server-only";
import type { Product } from "@/lib/products/domain";
import { currentOffer } from "@/lib/camps/domain";
import { serviceDb } from "../service-db";
import { checked } from "./context";
import { HttpError } from "../security";
import { productLiveMode } from "./runtime";

export async function campProductSnapshots(products: Product[]) {
  const ids = [
    ...new Set(
      products
        .filter((p) => p.kind === "camp" && p.camp_offer_id)
        .map((p) => p.camp_offer_id!),
    ),
  ];
  const snapshots = new Map<string, { offer: any; camp: any }>();
  if (!ids.length) return snapshots;
  const rows = checked<any[]>(
    await serviceDb()
      .from("camp_offers")
      .select(
        "id,camps!inner(id,title,description,days,early_bird_until,payment_mode,camp_offers(*))",
      )
      .in("id", ids),
  );
  for (const row of rows) {
    const camp = row.camps;
    if (camp.payment_mode !== (productLiveMode() ? "live" : "test")) continue;
    const offer = currentOffer<any>(camp.camp_offers, camp.early_bird_until);
    if (offer) snapshots.set(row.id, { offer, camp });
  }
  return snapshots;
}
export function withCampSnapshot(
  product: Product,
  snapshot?: { offer: any; camp: any },
): Product {
  if (product.kind !== "camp" || !snapshot) return product;
  const { offer, camp } = snapshot;
  return {
    ...product,
    camp_offer_id: offer.id,
    price: product.price
      ? {
          ...product.price,
          id: offer.stripe_price_id,
          product_id: offer.stripe_product_id,
          amount: offer.amount,
          currency: offer.currency,
          product_name: camp.title,
        }
      : null,
  };
}
export async function activeCampProduct(product: Product) {
  if (product.kind !== "camp") return product;
  const snapshot = (await campProductSnapshots([product])).get(
    product.camp_offer_id!,
  );
  if (!snapshot)
    throw new HttpError(409, "Kein aktueller Camppreis verfügbar.");
  return withCampSnapshot(product, snapshot);
}

export async function campProductPrice(offerId: string) {
  const offer = checked<any>(
    await serviceDb()
      .from("camp_offers")
      .select("*,camps!inner(title,status,payment_mode)")
      .eq("id", offerId)
      .single(),
  );
  if (
    offer.kind !== "main" ||
    offer.camps.payment_mode !== (productLiveMode() ? "live" : "test")
  )
    throw new HttpError(
      400,
      "Bitte das Camp über sein Normalangebot auswählen.",
    );
  const { validateProductPrice } = await import("./stripe");
  const price = await validateProductPrice(
    offer.stripe_price_id,
    "camp",
    offer.stripe_product_id,
  );
  if (price.amount !== offer.amount || price.currency !== offer.currency)
    throw new HttpError(
      409,
      "Stripe-Preis und Campdaten stimmen nicht überein.",
    );
  return price;
}
