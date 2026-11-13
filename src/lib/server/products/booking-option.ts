import "server-only";
import { findCampOptionPrice } from "@/lib/camps/option-price";
import type { Product } from "@/lib/products/domain";
import { HttpError } from "../security";
import { productStripe, validateProductPrice } from "./stripe";

// The client sends only its selection. Amount and Stripe product always come
// from the published, server-validated camp snapshot.
export async function bookingOptionPrice(product: Product) {
  const option = product.booking_option;
  if (product.kind !== "camp" || !option || !product.price)
    throw new HttpError(400, "Diese Buchungsoption ist nicht verfügbar.");
  const stripe = productStripe();
  const price = await findCampOptionPrice(
    stripe,
    product.price.product_id,
    option.amount,
    product.price.currency,
  );
  const checked = await validateProductPrice(
    price.id,
    "camp",
    product.price.product_id,
  );
  if (
    checked.amount !== option.amount ||
    checked.currency !== product.price.currency
  )
    throw new HttpError(409, "Der Optionspreis konnte nicht bestätigt werden.");
  return checked;
}
