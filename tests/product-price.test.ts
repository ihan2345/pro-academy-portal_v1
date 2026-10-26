import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { emptyProduct } from "../src/lib/products/domain";
const state = vi.hoisted(() => ({ price: null as any, product: null as any }));
vi.mock("stripe", () => ({
  default: class {
    static createFetchHttpClient() {
      return {};
    }
    prices = { retrieve: async () => state.price };
    products = { retrieve: async () => state.product };
  },
}));
import {
  validateProductPrice,
  verifyStoredPrice,
  productStripe,
} from "../src/lib/server/products/stripe";
beforeEach(() => {
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3110");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
  vi.stubEnv("PRODUCT_MANAGEMENT_ENABLED", "true");
  vi.stubEnv("PRODUCT_STRIPE_SECRET_KEY", "sk_test_local_fixture");
  state.product = {
    id: "prod_valid",
    active: true,
    livemode: false,
    name: "Stripe fixture",
  };
  state.price = {
    id: "price_valid",
    product: state.product,
    active: true,
    livemode: false,
    billing_scheme: "per_unit",
    unit_amount: 9900,
    currency: "eur",
    type: "recurring",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  };
});
afterEach(() => vi.unstubAllEnvs());
it("takes amount, currency, product and billing interval only from the retrieved test Price", async () => {
  const p = await validateProductPrice("price_valid", "subscription");
  expect(p).toMatchObject({
    id: "price_valid",
    product_id: "prod_valid",
    amount: 9900,
    currency: "eur",
    interval: "month",
    livemode: false,
    source: "stripe",
  });
});
it.each([
  "live_price",
  "inactive_price",
  "live_product",
  "inactive_product",
  "weekly",
  "metered",
  "wrong_product",
  "wrong_kind",
] as const)(
  "rejects %s without a compatible verified result",
  async (fault) => {
    if (fault === "live_price") state.price.livemode = true;
    if (fault === "inactive_price") state.price.active = false;
    if (fault === "live_product") state.product.livemode = true;
    if (fault === "inactive_product") state.product.active = false;
    if (fault === "weekly") state.price.recurring.interval = "week";
    if (fault === "metered") state.price.recurring.usage_type = "metered";
    await expect(
      validateProductPrice(
        "price_valid",
        fault === "wrong_kind" ? "camp" : "subscription",
        fault === "wrong_product" ? "prod_foreign" : undefined,
      ),
    ).rejects.toThrow();
  },
);
it("always rejects live credentials even if the generic application configuration is changed", () => {
  vi.stubEnv("PRODUCT_STRIPE_SECRET_KEY", "sk_live_forbidden_fixture");
  expect(() => productStripe()).toThrow(/Stripe-Schlüssel/);
});
it("distinguishes local example data from a real Stripe validation", async () => {
  const p = emptyProduct();
  p.price = {
    id: "price_fixture",
    product_id: "prod_fixture",
    amount: 100,
    currency: "eur",
    interval: null,
    interval_count: 1,
    livemode: false,
    checked_at: new Date().toISOString(),
    product_name: "Example",
    source: "fixture",
  };
  await expect(verifyStoredPrice(p)).rejects.toThrow(/lokales Beispiel/);
});
it("production accepts only live prices and can reuse the installed server credential", async () => {
  vi.stubEnv("APP_MODE", "production");
  vi.stubEnv("APP_URL", "https://portal.example.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.invalid");
  vi.stubEnv("PRODUCT_STRIPE_SECRET_KEY", "");
  vi.stubEnv("STRIPE_SECRET_KEY", "rk_live_fixture");
  state.price.livemode = true;
  state.product.livemode = true;
  expect(
    await validateProductPrice("price_valid", "subscription"),
  ).toMatchObject({ livemode: true });
  state.price.livemode = false;
  await expect(
    validateProductPrice("price_valid", "subscription"),
  ).rejects.toThrow();
  vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_fixture");
  expect(() => productStripe()).toThrow(/Stripe-Schlüssel/);
});
