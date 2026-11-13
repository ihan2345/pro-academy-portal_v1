import "server-only";
import { createHash } from "node:crypto";
import type Stripe from "stripe";
export async function findCampOptionPrice(
  stripe: Stripe,
  productId: string,
  amount: number,
  currency: string,
) {
  const key =
    "camp-option-inclusive-" +
    createHash("sha256")
      .update(`${productId}:${amount}:${currency}`)
      .digest("hex")
      .slice(0, 40);
  const existing = await stripe.prices.list({ lookup_keys: [key], limit: 1 });
  return (
    existing.data[0] ??
    (await stripe.prices.create(
      {
        product: productId,
        currency,
        unit_amount: amount,
        tax_behavior: "inclusive",
        lookup_key: key,
        nickname: "Camp-Buchungsoption",
      },
      { idempotencyKey: key },
    ))
  );
}
