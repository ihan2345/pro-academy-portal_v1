import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifyOffer } from "../src/lib/camps/stripe";
let promotionEnabled = true,
  promotions: any[] = [],
  quantity = 1;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  promotionEnabled = true;
  promotions = [];
  quantity = 1;
  vi.stubEnv("CAMP_STRIPE_SECRET_KEY", "rk_test_fixture");
  vi.stubEnv("CAMP_STRIPE_MODE", "test");
  fetcher = vi.fn(async (url: string) => {
    const data = url.includes("promotion_codes")
      ? { data: promotions, has_more: false }
      : url.includes("line_items") && !url.includes("expand")
        ? { data: [{ quantity, price: { id: "price_one" } }], has_more: false }
        : url.includes("/prices/")
          ? {
              id: "price_one",
              product: "prod_one",
              livemode: false,
              type: "one_time",
              active: true,
              unit_amount: 22900,
              currency: "eur",
              tax_behavior: "inclusive",
            }
          : {
              id: "plink_one",
              livemode: false,
              active: true,
              allow_promotion_codes: promotionEnabled,
              customer_creation: "always",
              line_items: {
                data: [{ quantity, adjustable_quantity: { enabled: false } }],
              },
              automatic_tax: { enabled: false },
            };
    return new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("validates full-price checkout without requiring promotion-code availability", async () => {
  promotionEnabled = false;
  expect((await verifyOffer("price_one", "plink_one", {})).amount).toBe(22900);
  expect(
    fetcher.mock.calls.some(([url]) => String(url).includes("promotion_codes")),
  ).toBe(false);
});
it("validates the requested discount against its actual product", async () => {
  promotions = [
    {
      code: "BENEFIT",
      coupon: {
        valid: true,
        percent_off: 15,
        applies_to: { products: ["prod_one"] },
      },
    },
  ];
  await expect(
    verifyOffer("price_one", "plink_one", { "15": "BENEFIT" }),
  ).resolves.toMatchObject({ codes: { "15": "BENEFIT" } });
  promotions[0].coupon.applies_to.products = ["prod_other"];
  await expect(
    verifyOffer("price_one", "plink_one", { "15": "BENEFIT" }),
  ).rejects.toThrow("passt nicht zum Stripe-Produkt");
});
it("clearly rejects inactive or expired codes", async () => {
  await expect(
    verifyOffer("price_one", "plink_one", { "10": "INACTIVE" }),
  ).rejects.toThrow("nicht aktiv oder nicht mehr gültig");
  promotions = [{ code: "EXPIRED", coupon: { valid: false, percent_off: 10 } }];
  await expect(
    verifyOffer("price_one", "plink_one", { "10": "EXPIRED" }),
  ).rejects.toThrow("nicht aktiv oder nicht mehr gültig");
});
it("requires discount entry only when an applicable discount is supplied", async () => {
  promotionEnabled = false;
  await expect(
    verifyOffer("price_one", "plink_one", { "15": "BENEFIT" }),
  ).rejects.toThrow("Eingabe von Rabattcodes nicht aktiviert");
});
it("keeps payment-link quantity validation for full-price bookings", async () => {
  quantity = 2;
  await expect(verifyOffer("price_one", "plink_one", {})).rejects.toThrow(
    "genau einen",
  );
});
