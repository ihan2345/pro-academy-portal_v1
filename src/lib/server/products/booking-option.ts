import "server-only";
import { createHash } from "node:crypto";
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
  const key =
    "camp-option-" +
    createHash("sha256")
      .update(
        `${product.price.product_id}:${option.amount}:${product.price.currency}`,
      )
      .digest("hex")
      .slice(0, 40);
  const existing = await stripe.prices.list({ lookup_keys: [key], limit: 1 });
  const price =
    existing.data[0] ??
    (await stripe.prices.create(
      {
        product: product.price.product_id,
        currency: product.price.currency,
        unit_amount: option.amount,
        lookup_key: key,
        nickname: "Camp-Buchungsoption",
      },
      { idempotencyKey: key },
    ));
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
