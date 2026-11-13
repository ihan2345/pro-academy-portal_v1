import "server-only";
import type { ProductPrice } from "@/lib/products/domain";
import { findCampOptionPrice } from "@/lib/camps/option-price";
import { productStripe, validateProductPrice } from "./stripe";
import { HttpError } from "../security";
export async function campMemberPrice(base: ProductPrice, percent: number) {
  if (![10, 15, 20].includes(percent))
    throw new HttpError(400, "Ungültiger Camp-Vorteil.");
  const amount = base.amount - Math.round((base.amount * percent) / 100);
  const raw = await findCampOptionPrice(
    productStripe(),
    base.product_id,
    amount,
    base.currency,
  );
  const checked = await validateProductPrice(raw.id, "camp", base.product_id);
  if (
    checked.amount !== amount ||
    checked.currency !== base.currency ||
    checked.livemode !== base.livemode
  )
    throw new HttpError(
      409,
      "Der persönliche Camppreis konnte nicht bestätigt werden.",
    );
  return checked;
}
