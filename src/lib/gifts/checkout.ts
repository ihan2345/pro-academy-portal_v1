import "server-only";
import type Stripe from "stripe";
import { checked } from "@/lib/server/products/context";
import { serviceDb } from "@/lib/server/service-db";
import { requireGifts } from "./runtime";
/** Preparation: represents the wallet contribution separately in the ledger.
 * Live invoicing/tax treatment must be approved before enabling the live feature. */
export async function prepareGiftDiscount(
  intent: any,
  customerId: string,
  stripe: Stripe,
) {
  requireGifts();
  const reduction = intent.expected_subtotal - intent.expected_amount;
  if (reduction <= 0 || intent.gift_credit_amount <= 0)
    throw Error("Ungültige Guthabenreservierung");
  const coupon = await stripe.coupons.create(
    {
      amount_off: reduction,
      currency: intent.currency,
      duration: "once",
      max_redemptions: 1,
      name: "Preisvorteile und Geschenkguthaben",
      applies_to: { products: [intent.product.price.product_id] },
      metadata: {
        product_intent_id: intent.id,
        gift_credit_amount: String(intent.gift_credit_amount),
      },
    },
    { idempotencyKey: `gift-credit:${intent.id}:coupon` },
  );
  const promo = await stripe.promotionCodes.create(
    {
      coupon: coupon.id,
      customer: customerId,
      max_redemptions: 1,
      metadata: { product_intent_id: intent.id },
    },
    { idempotencyKey: `gift-credit:${intent.id}:promotion` },
  );
  checked(
    await serviceDb()
      .from("product_purchase_intents")
      .update({
        discount: {
          ...intent.discount,
          coupon_id: coupon.id,
          promotion_id: promo.id,
        },
      })
      .eq("id", intent.id),
  );
  return promo.id;
}
