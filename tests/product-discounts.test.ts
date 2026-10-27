import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveDiscount } from "../src/lib/server/products/discounts";
const price = { amount: 9900, currency: "eur", product_id: "prod_training" };
let promotion: any;
const stripe = {
  promotionCodes: { list: vi.fn(async () => ({ data: [promotion] })) },
} as any;
beforeEach(() => {
  vi.stubEnv("APP_MODE", "test");
  promotion = {
    id: "promo_test",
    code: "START",
    livemode: false,
    active: true,
    customer: null,
    expires_at: null,
    max_redemptions: null,
    times_redeemed: 0,
    restrictions: { first_time_transaction: false },
    coupon: {
      id: "coupon_test",
      valid: true,
      percent_off: 20,
      amount_off: null,
      duration: "once",
      duration_in_months: null,
    },
  };
});
afterEach(() => vi.unstubAllEnvs());
it("computes a public percentage discount and retains the actual recurring duration", async () => {
  expect(
    await resolveDiscount(stripe, "start", price, undefined, true),
  ).toMatchObject({
    promotion_id: "promo_test",
    amount: 7920,
    source: "code",
    duration: "once",
  });
  promotion.coupon.duration = "repeating";
  promotion.coupon.duration_in_months = 3;
  expect(
    await resolveDiscount(stripe, "START", price, "cus_owner", false),
  ).toMatchObject({ duration: "repeating", duration_in_months: 3 });
});
it("supports fixed amount and 100 percent codes, without negative totals", async () => {
  promotion.coupon = {
    ...promotion.coupon,
    percent_off: null,
    amount_off: 2000,
    currency: "eur",
  };
  expect(
    (await resolveDiscount(stripe, "START", price, undefined, true)).amount,
  ).toBe(7900);
  promotion.coupon.amount_off = 20000;
  expect(
    (await resolveDiscount(stripe, "START", price, undefined, true)).amount,
  ).toBe(0);
  promotion.coupon.percent_off = 100;
  promotion.coupon.amount_off = null;
  expect(
    (await resolveDiscount(stripe, "START", price, undefined, true)).amount,
  ).toBe(0);
});
it.each([
  "expired",
  "inactive",
  "live",
  "product",
  "currency",
  "minimum",
  "redeemed",
  "invalid_coupon",
])("rejects %s codes before starting checkout", async (fault) => {
  if (fault === "expired") promotion.expires_at = 1;
  if (fault === "inactive") promotion.active = false;
  if (fault === "live") promotion.livemode = true;
  if (fault === "product")
    promotion.coupon.applies_to = { products: ["prod_other"] };
  if (fault === "currency") {
    promotion.coupon.percent_off = null;
    promotion.coupon.amount_off = 2000;
    promotion.coupon.currency = "usd";
  }
  if (fault === "minimum")
    promotion.restrictions = {
      minimum_amount: 10000,
      minimum_amount_currency: "eur",
    };
  if (fault === "redeemed") {
    promotion.max_redemptions = 1;
    promotion.times_redeemed = 1;
  }
  if (fault === "invalid_coupon") promotion.coupon.valid = false;
  await expect(
    resolveDiscount(stripe, "START", price, undefined, true),
  ).rejects.toThrow(/nicht gültig/);
});
it("never applies another customer's code or an unauthenticated first-purchase benefit", async () => {
  promotion.customer = "cus_owner";
  await expect(
    resolveDiscount(stripe, "START", price, undefined, true),
  ).rejects.toThrow();
  expect(
    (await resolveDiscount(stripe, "START", price, "cus_owner", false)).amount,
  ).toBe(7920);
  promotion.customer = null;
  promotion.restrictions.first_time_transaction = true;
  await expect(
    resolveDiscount(stripe, "START", price, undefined, true),
  ).rejects.toThrow(/Anmeldung/);
});
