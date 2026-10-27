import "server-only";
import type Stripe from "stripe";
import { HttpError } from "../security";
import { productLiveMode } from "./runtime";
export type CheckoutDiscount = {
  promotion_id: string;
  code: string;
  coupon_id: string;
  amount: number;
  source: "code" | "membership";
  duration: string;
  duration_in_months: number | null;
};
/** Compute once before reservation. Stripe also enforces redemption limits at checkout. */
export async function resolveDiscount(
  stripe: Stripe,
  code: string,
  price: { amount: number; currency: string; product_id: string },
  customer: string | undefined,
  guest: boolean,
  source: CheckoutDiscount["source"] = "code",
): Promise<CheckoutDiscount> {
  const promos = await stripe.promotionCodes.list({
    code,
    active: true,
    limit: 100,
  });
  const ref = (v: string | { id: string } | null) =>
    typeof v === "string" ? v : v?.id;
  const matches = promos.data.filter(
    (p) =>
      p.code.toLowerCase() === code.toLowerCase() &&
      (!p.customer || ref(p.customer) === customer),
  );
  const promo = matches.find((p) => !!p.customer) ?? matches[0];
  const coupon = promo?.coupon;
  const now = Date.now() / 1000;
  if (
    !promo ||
    !coupon ||
    promo.livemode !== productLiveMode() ||
    !promo.active ||
    !coupon.valid ||
    (promo.expires_at && promo.expires_at <= now) ||
    (coupon.redeem_by && coupon.redeem_by <= now) ||
    (promo.max_redemptions != null &&
      promo.times_redeemed >= promo.max_redemptions) ||
    (coupon.max_redemptions != null &&
      coupon.times_redeemed >= coupon.max_redemptions) ||
    (coupon.applies_to?.products &&
      !coupon.applies_to.products.includes(price.product_id)) ||
    (coupon.amount_off != null && coupon.currency !== price.currency) ||
    (promo.restrictions.minimum_amount != null &&
      (promo.restrictions.minimum_amount_currency !== price.currency ||
        price.amount < promo.restrictions.minimum_amount))
  )
    throw new HttpError(
      400,
      "Dieser Rabattcode ist für dieses Angebot nicht gültig oder abgelaufen.",
    );
  if (guest && (promo.customer || promo.restrictions.first_time_transaction))
    throw new HttpError(
      400,
      "Dieser persönliche Rabattcode benötigt eine Anmeldung. Allgemeine Rabattcodes kannst du ohne Anmeldung verwenden.",
    );
  const reduction =
    coupon.percent_off != null
      ? Math.round((price.amount * coupon.percent_off) / 100)
      : (coupon.amount_off ?? 0);
  if (reduction <= 0)
    throw new HttpError(
      400,
      "Dieser Rabattcode enthält keinen passenden Rabatt.",
    );
  return {
    promotion_id: promo.id,
    code: promo.code,
    coupon_id: coupon.id,
    amount: Math.max(0, price.amount - reduction),
    source,
    duration: coupon.duration,
    duration_in_months: coupon.duration_in_months,
  };
}
