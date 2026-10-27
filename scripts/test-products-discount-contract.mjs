// Real Stripe TEST contract only. No portal database, actual card charge, auth email or deployment.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import Stripe from "stripe";
import assert from "node:assert/strict";
if (process.env.PRODUCT_DISCOUNT_TEST_CONFIRM !== "synthetic-stripe-test-only")
  throw Error("Explicit TEST confirmation required");
const source = process.env.PRODUCT_TEST_ENV_FILE;
if (!source)
  throw Error(
    "Explicit isolated TEST env file required; repository production env is never loaded",
  );
const env = parseEnv(readFileSync(source, "utf8"));
if (
  env.APP_MODE !== "test" ||
  !/^(sk|rk)_test_/.test(env.PRODUCT_STRIPE_SECRET_KEY ?? "")
)
  throw Error("Only a dedicated Stripe TEST key is allowed");
const stripe = new Stripe(env.PRODUCT_STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
  maxNetworkRetries: 1,
});
const run = Date.now().toString(36),
  coupons = [],
  promotions = [],
  sessions = [],
  prices = [];
let product, customer, subscription, schedule;
const results = [];
try {
  product = await stripe.products.create({
    name: `TEST Gastkauf Rabatt ${run}`,
    metadata: { synthetic_guest_contract: run },
  });
  customer = await stripe.customers.create({
    name: "TEST Gastfamilie",
    metadata: { synthetic_guest_contract: run },
  });
  assert.equal(product.livemode, false);
  assert.equal(customer.livemode, false);
  for (const spec of [
    { name: "percent", percent_off: 20, total: 7920 },
    { name: "fixed", amount_off: 2000, currency: "eur", total: 7900 },
    { name: "free", percent_off: 100, total: 0 },
    { name: "subscription-free", percent_off: 100, total: 0 },
  ]) {
    const { name, total, ...discount } = spec;
    const recurring = name.startsWith("subscription");
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 9900,
      currency: "eur",
      ...(recurring ? { recurring: { interval: "month" } } : {}),
    });
    prices.push(price.id);
    const coupon = await stripe.coupons.create({
      duration: "once",
      applies_to: { products: [product.id] },
      ...discount,
    });
    coupons.push(coupon.id);
    const promo = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: `PAG${run}${results.length}`,
    });
    promotions.push(promo.id);
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: recurring ? "subscription" : "payment",
      line_items: [{ price: price.id, quantity: 1 }],
      discounts: [{ promotion_code: promo.id }],
      success_url: "http://127.0.0.1:3110/produkte",
      cancel_url: "http://127.0.0.1:3110/produkte",
      payment_method_types: ["card"],
      locale: "de",
      metadata: { synthetic_guest_contract: run },
    });
    sessions.push(session.id);
    const stored = await stripe.checkout.sessions.retrieve(session.id);
    assert.equal(stored.livemode, false);
    assert.equal(stored.amount_total, total);
    assert.equal(stored.amount_subtotal, 9900);
    assert.equal(stored.discounts.length, 1);
    assert.equal(stored.discounts[0].promotion_code, promo.id);
    results.push({
      case: name,
      subtotal: stored.amount_subtotal,
      total: stored.amount_total,
      promotion_identity: true,
      mode: stored.mode,
      charged: false,
    });
  }
  const current = await stripe.prices.create({
    product: product.id,
    unit_amount: 15900,
    currency: "eur",
    recurring: { interval: "month" },
  });
  prices.push(current.id);
  const target = await stripe.prices.create({
    product: product.id,
    unit_amount: 9900,
    currency: "eur",
    recurring: { interval: "month" },
  });
  prices.push(target.id);
  const recurringCoupon = await stripe.coupons.create({
    percent_off: 100,
    duration: "repeating",
    duration_in_months: 3,
    applies_to: { products: [product.id] },
  });
  coupons.push(recurringCoupon.id);
  subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: current.id }],
    discounts: [{ coupon: recurringCoupon.id }],
  });
  assert.equal(subscription.status, "active");
  const refs = subscription.discounts.map((d) => ({
    discount: typeof d === "string" ? d : d.id,
  }));
  schedule = await stripe.subscriptionSchedules.create({
    from_subscription: subscription.id,
  });
  const updated = await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    proration_behavior: "none",
    phases: [
      {
        start_date: schedule.current_phase.start_date,
        end_date: subscription.items.data[0].current_period_end,
        items: [{ price: current.id, quantity: 1 }],
        discounts: refs,
        proration_behavior: "none",
      },
      {
        start_date: subscription.items.data[0].current_period_end,
        duration: { interval: "month", interval_count: 1 },
        items: [{ price: target.id, quantity: 1 }],
        discounts: refs,
        proration_behavior: "none",
      },
    ],
  });
  assert.equal(updated.phases.length, 2);
  for (const phase of updated.phases)
    assert.equal(
      typeof phase.discounts[0].discount === "string"
        ? phase.discounts[0].discount
        : phase.discounts[0].discount.id,
      refs[0].discount,
    );
  results.push({
    case: "scheduled-downgrade-retains-discount",
    original_discount_identity: true,
    charged: false,
  });
} finally {
  if (schedule)
    await stripe.subscriptionSchedules.release(schedule.id).catch(() => {});
  if (subscription)
    await stripe.subscriptions.cancel(subscription.id).catch(() => {});
  for (const id of sessions)
    await stripe.checkout.sessions.expire(id).catch(() => {});
  for (const id of promotions)
    await stripe.promotionCodes.update(id, { active: false });
  for (const id of coupons) await stripe.coupons.del(id);
  for (const id of prices) await stripe.prices.update(id, { active: false });
  if (customer) await stripe.customers.del(customer.id);
  if (product) await stripe.products.update(product.id, { active: false });
}
mkdirSync("output/product-guest-stripe", { recursive: true });
writeFileSync(
  "output/product-guest-stripe/contract.json",
  JSON.stringify({ run, results, cleanup: true }, null, 2),
);
console.log(JSON.stringify({ results, cleanup: true }));
