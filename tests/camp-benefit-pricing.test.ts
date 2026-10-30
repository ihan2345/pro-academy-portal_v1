import { afterEach, expect, it, vi } from "vitest";
import { campBenefitUpdateSchema } from "../src/lib/camps/domain";
import {
  visitorContext,
  type ProductContext,
} from "../src/lib/products/domain";
import { campPricingForCatalog } from "../src/lib/server/products/camp-pricing";
const mock = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  benefit: vi.fn(),
}));
vi.mock("../src/lib/camps/service", () => ({ childBenefit: mock.benefit }));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      const q: any = {
        select: () => q,
        in: () => q,
        or: () => q,
        then: (resolve: any) =>
          Promise.resolve({ data: mock.tables[table] ?? [], error: null }).then(
            resolve,
          ),
      };
      return q;
    },
  }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it.each([10, 15, 20, null])(
  "accepts existing seeded tariff IDs when saving %s",
  (percent) => {
    expect(
      campBenefitUpdateSchema.parse({
        id: "10000000-0000-0000-0000-000000000001",
        percent,
      }).percent,
    ).toBe(percent);
    expect(
      campBenefitUpdateSchema.safeParse({ id: "not-an-id", percent }).success,
    ).toBe(false);
    expect(
      campBenefitUpdateSchema.safeParse({
        id: "10000000-0000-0000-0000-000000000001",
        percent: 100,
      }).success,
    ).toBe(false);
  },
);
function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T10:00:00Z"));
  mock.tables = {
    plans: [{ camp_benefit_percent: 15 }],
    camp_offers: [1, 2].map((n) => ({
      id: `offer${n}`,
      stripe_price_id: `price${n}`,
      amount: 19999,
      kind: "early",
      codes: { "15": "promo_internal" },
      camps: { early_bird_until: "2026-11-01T12:00:00Z" },
    })),
  };
  mock.benefit.mockResolvedValue({ percent: 15 });
  return {
    ...visitorContext(),
    auth_id: "parent",
    role: "parent",
    children: [
      { id: "child", first_name: "Mila" },
      { id: "sibling", first_name: "Tom" },
    ],
  } as ProductContext;
}
it("applies the child's benefit once to early-bird prices across the page, using Checkout cent rounding", async () => {
  const ctx = fixture();
  const prices = await campPricingForCatalog(
    ["offer1", "offer2"],
    ctx,
    "child",
  );
  expect(prices.get("offer1")).toMatchObject({
    personal_amount: 16999,
    percent: 15,
    child_name: "Mila",
    early_until: "2026-11-01T12:00:00Z",
  });
  expect(prices.get("offer2")?.personal_amount).toBe(16999);
  expect(mock.benefit).toHaveBeenCalledTimes(1);
  expect(mock.benefit).toHaveBeenCalledWith("child");
});
it("does not promise a personal price for guests, another family's child, an unselected sibling, or a new child", async () => {
  const ctx = fixture();
  for (const [context, player, newChild] of [
    [visitorContext(), undefined, false],
    [ctx, "foreign", false],
    [ctx, undefined, false],
    [ctx, "child", true],
  ] as const) {
    const prices = await campPricingForCatalog(
      ["offer1"],
      context,
      player,
      newChild,
    );
    expect(prices.get("offer1")).toMatchObject({
      personal_amount: null,
      percent: 0,
      benefit_available: true,
    });
  }
  expect(mock.benefit).not.toHaveBeenCalled();
});
it("does not advertise an expired early-bird offer or an unconfigured member discount", async () => {
  const ctx = fixture();
  mock.tables.camp_offers[0].camps.early_bird_until = "2026-10-30T10:00:00Z";
  mock.tables.camp_offers[1].codes = {};
  const prices = await campPricingForCatalog(
    ["offer1", "offer2"],
    ctx,
    "child",
  );
  expect(prices.has("offer1")).toBe(false);
  expect(prices.get("offer2")).toMatchObject({
    personal_amount: null,
    percent: 0,
    benefit_available: false,
  });
});
