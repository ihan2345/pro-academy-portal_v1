import "server-only";
import { giftsEnabled } from "@/lib/gifts/runtime";
import {
  requireProductPayments,
  productsEnabled,
} from "@/lib/server/products/runtime";
import { serviceDb } from "@/lib/server/service-db";
import { listProducts } from "@/lib/server/products/catalog";
import { HttpError } from "@/lib/server/security";
import type { ProfileSession } from "@/lib/server/parent-profile";
export async function campShopBooking(
  campId: string,
  offerIds: string[],
  session: ProfileSession | null,
  productId?: string,
  channel = "catalog",
) {
  if (!productsEnabled()) {
    if (productId)
      throw new HttpError(
        503,
        "Die Campbuchung ist vorübergehend nicht verfügbar.",
      );
    return null;
  }
  const result = await serviceDb()
    .from("catalog_products")
    .select("id,camp_checkout_for")
    .eq("published->>kind", "camp")
    .in("published->>camp_offer_id", offerIds)
    .order("published_priority", { ascending: false })
    .order("id");
  if (result.error)
    throw new HttpError(503, "Das Campangebot konnte nicht geladen werden.");
  const candidates = (result.data ?? [])
    .sort(
      (a, b) => Number(!!a.camp_checkout_for) - Number(!!b.camp_checkout_for),
    )
    .filter((row) => !productId || row.id === productId);
  for (const candidate of candidates) {
    const catalog = await listProducts(
      session,
      new URLSearchParams({
        product: candidate.id,
        new_child: "true",
        channel,
      }),
    );
    const product = catalog.rows.find(
      (row: any) =>
        row.id === candidate.id &&
        row.kind === "camp" &&
        row.camp_booking_url?.startsWith(`/camp/buchung/${campId}?`),
    );
    if (product)
      return {
        product,
        gifts_enabled: catalog.gifts_enabled,
        payments_enabled: catalog.payments_enabled,
      };
  }
  if (productId)
    throw new HttpError(
      404,
      "Das Campangebot ist nicht verfügbar oder gehört nicht zu diesem Camp.",
    );
  return {
    product: null,
    gifts_enabled: giftsEnabled(),
    payments_enabled: process.env.PRODUCT_PAYMENTS_ENABLED === "true",
  };
}

export async function prepareCampShopBooking(campId: string) {
  requireProductPayments();
  const r = await serviceDb().rpc("camp_ensure_checkout_product", {
    camp: campId,
  });
  if (r.error || typeof r.data !== "string")
    throw new HttpError(
      409,
      "Das Campangebot ist nicht mehr verfügbar. Bitte neu laden.",
    );
  return { id: r.data };
}
