import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCampOffer, createCampCheckout } from "../src/lib/camps/stripe";
import { campTiming } from "../src/lib/camps/domain";
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: () => ({ upsert: async () => ({ error: null }) }),
  }),
}));
let calls: { path: string; method: string; body: URLSearchParams }[] = [];
beforeEach(() => {
  calls = [];
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("CAMP_LOCAL_ENABLED", "true");
  vi.stubEnv("CAMP_SIDE_EFFECTS_BLOCKED", "true");
  vi.stubEnv("CAMP_STRIPE_SECRET_KEY", "sk_test_fixture");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (raw: any, init: any) => {
      const url = new URL(String(raw)),
        body = new URLSearchParams(init?.body),
        method = init?.method ?? "GET";
      calls.push({ path: url.pathname, method, body });
      const product = {
        id: "prod_one",
        name: "Camp",
        active: true,
        livemode: false,
      };
      const data = url.pathname.endsWith("/products")
        ? product
        : url.pathname.endsWith("/prices")
          ? {
              id:
                body.get("unit_amount") === "20000"
                  ? "price_early"
                  : "price_main",
              livemode: false,
            }
          : url.pathname.includes("/prices/")
            ? {
                id: "price_early",
                product,
                active: true,
                livemode: false,
                type: "one_time",
                unit_amount: 20000,
                currency: "eur",
                billing_scheme: "per_unit",
                tax_behavior: "inclusive",
              }
            : url.pathname.endsWith("/coupons")
              ? { id: "coupon_" + body.get("percent_off") }
              : url.pathname.endsWith("/promotion_codes")
                ? method === "POST"
                  ? { id: "promo_created", code: body.get("code") }
                  : {
                      data: [
                        {
                          id: "promo_member",
                          code: "MEMBER10",
                          active: true,
                          coupon: {
                            valid: true,
                            percent_off: 10,
                            applies_to: { products: ["prod_one"] },
                          },
                        },
                      ],
                      has_more: false,
                    }
                : url.pathname.endsWith("/checkout/sessions")
                  ? {
                      id: "cs_test_one",
                      url: "https://checkout.stripe.com/c/pay/cs_test_one",
                      livemode: false,
                    }
                  : null;
      if (!data) throw Error("Unexpected Stripe operation: " + url.pathname);
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("creates one shared Stripe product, two reusable prices, and no Payment Links", async () => {
  const main = await createCampOffer(
    "a0000000-0000-4000-8000-000000000001",
    "Camp",
    "main",
    25000,
    "https://portal.example",
  );
  const early = await createCampOffer(
    "a0000000-0000-4000-8000-000000000001",
    "Camp",
    "early",
    20000,
    "https://portal.example",
    main.stripe_product_id,
  );
  expect(main.stripe_product_id).toBe(early.stripe_product_id);
  expect(calls.filter((c) => c.path === "/v1/products")).toHaveLength(1);
  expect(calls.filter((c) => c.path === "/v1/prices")).toHaveLength(2);
  expect(calls.some((c) => c.path.includes("payment_links"))).toBe(false);
  expect([main.stripe_payment_link_id, early.stripe_payment_link_id]).toEqual([
    null,
    null,
  ]);
});
it("creates a booking-specific Checkout with the current early price and an additional verified member discount", async () => {
  await createCampCheckout(
    {
      id: "offer_early",
      camp_id: "camp",
      stripe_price_id: "price_early",
      stripe_product_id: "prod_one",
      amount: 20000,
      currency: "eur",
      codes: { "10": "MEMBER10" },
      stripe_payment_link_id: null,
    } as any,
    "booking",
    "test@example.invalid",
    10,
    "https://portal.example",
  );
  const body = calls.find((c) => c.path === "/v1/checkout/sessions")!.body;
  expect(body.get("line_items[0][price]")).toBe("price_early");
  expect(body.get("discounts[0][promotion_code]")).toBe("promo_member");
  expect(body.get("metadata[camp_id]")).toBe("camp");
  expect(body.get("metadata[camp_booking_id]")).toBe("booking");
  expect(body.get("client_reference_id")).toBe("booking");
  expect(body.has("allow_promotion_codes")).toBe(false);
  expect(
    Number(body.get("expires_at")) - Math.floor(Date.now() / 1000),
  ).toBeGreaterThan(1800);
});
it("classifies camps by the complete schedule, independently of day order", () => {
  const c = {
    days: [
      { starts_at: "2026-11-03T08:00:00Z", ends_at: "2026-11-03T14:00:00Z" },
      { starts_at: "2026-11-01T08:00:00Z", ends_at: "2026-11-01T14:00:00Z" },
    ],
  };
  expect(campTiming(c, Date.parse("2026-11-02T12:00Z"))).toMatchObject({
    phase: "ongoing",
    hours: 12,
  });
  expect(campTiming(c, Date.parse("2026-10-31T12:00Z")).phase).toBe("upcoming");
  expect(campTiming(c, Date.parse("2026-11-03T14:00Z")).phase).toBe("past");
});
