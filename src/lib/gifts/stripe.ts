import "server-only";
import { serviceDb } from "@/lib/server/service-db";
import { checked } from "@/lib/server/products/context";
import { productLiveMode } from "@/lib/server/products/runtime";
import {
  productStripe,
  validateProductPrice,
} from "@/lib/server/products/stripe";
import { HttpError } from "@/lib/server/security";
import { requireGifts } from "./runtime";
import { giftMoney } from "./domain";
export async function ensureGiftValue(amount: number) {
  requireGifts();
  const db = serviceDb(),
    live = productLiveMode(),
    currency = "eur";
  const settings = checked<any>(
    await db.from("gift_settings").select("*").eq("id", true).single(),
  );
  if (
    !Number.isInteger(amount) ||
    amount < settings.min_amount ||
    amount > settings.max_amount
  )
    throw new HttpError(
      400,
      `Bitte einen Betrag zwischen ${giftMoney(settings.min_amount)} und ${giftMoney(settings.max_amount)} wählen.`,
    );
  const cached = checked<any>(
    await db
      .from("gift_stripe_values")
      .select("*")
      .eq("livemode", live)
      .eq("currency", currency)
      .eq("amount", amount)
      .maybeSingle(),
  );
  const stripe = productStripe(),
    productId = `prod_pa_gift_${live ? "live" : "test"}_${currency}_${amount}`;
  if (cached?.price_id) {
    const actual = await validateProductPrice(
      cached.price_id,
      "gift",
      cached.product_id,
    );
    if (actual.amount !== amount)
      throw new HttpError(409, "Geschenkbetrag stimmt nicht überein.");
    return actual;
  }
  // Deterministic product IDs also prevent duplicates after Stripe's idempotency window.
  let product;
  try {
    product = await stripe.products.retrieve(productId);
  } catch (e: any) {
    if (e?.code !== "resource_missing") throw e;
  }
  if (!product) {
    try {
      product = await stripe.products.create(
        {
          id: productId,
          name: `ProAcademy Geschenkkarte · ${giftMoney(amount)}`,
          metadata: {
            pa_gift_amount: String(amount),
            pa_gift_currency: currency,
          },
        },
        { idempotencyKey: `${productId}:create` },
      );
    } catch (e: any) {
      if (
        e?.code !== "resource_already_exists" &&
        e?.code !== "idempotency_key_in_use"
      )
        throw e;
      product = await stripe.products.retrieve(productId);
    }
  }
  if (
    product.deleted ||
    !product.active ||
    product.livemode !== live ||
    product.metadata.pa_gift_amount !== String(amount) ||
    product.metadata.pa_gift_currency !== currency
  )
    throw new HttpError(409, "Stripe-Geschenkartikel passt nicht zum Betrag.");
  checked(
    await db
      .from("gift_stripe_values")
      .upsert(
        { livemode: live, currency, amount, product_id: productId },
        { onConflict: "livemode,currency,amount", ignoreDuplicates: true },
      ),
  );
  // Reuse a price even if a previous process stopped after creating it at Stripe.
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    type: "one_time",
    limit: 100,
  });
  let price = prices.data.find(
    (p) =>
      p.unit_amount === amount &&
      p.currency === currency &&
      !p.transform_quantity &&
      p.billing_scheme === "per_unit",
  );
  if (!price)
    price = await stripe.prices.create(
      {
        product: productId,
        unit_amount: amount,
        currency,
        tax_behavior: "inclusive",
        metadata: { pa_gift_amount: String(amount) },
      },
      { idempotencyKey: `${productId}:price` },
    );
  const actual = await validateProductPrice(price.id, "gift", productId);
  if (actual.amount !== amount)
    throw new HttpError(409, "Geschenkbetrag stimmt nicht überein.");
  checked(
    await db
      .from("gift_stripe_values")
      .update({ price_id: price.id })
      .eq("product_id", productId),
  );
  return actual;
}

/** Prepare several denominations with bounded Stripe concurrency; each mapping stays globally unique. */
export async function ensureGiftValues(amounts: number[]) {
  const remaining = [...new Set(amounts)];
  await Promise.all(
    Array.from({ length: Math.min(4, remaining.length) }, async () => {
      for (;;) {
        const amount = remaining.shift();
        if (amount == null) return;
        await ensureGiftValue(amount);
      }
    }),
  );
}
