import { it, expect, vi, beforeEach, afterEach } from "vitest";
const state = vi.hoisted(() => ({
  products: new Map<string, any>(),
  prices: new Map<string, any>(),
  cache: new Map<number, any>(),
  created: [] as string[],
}));
vi.mock("../src/lib/server/products/stripe", () => ({
  productStripe: () => ({
    products: {
      retrieve: async (id: string) => {
        const p = state.products.get(id);
        if (!p) throw { code: "resource_missing" };
        return p;
      },
      create: async (p: any) => {
        if (state.products.has(p.id)) throw { code: "resource_already_exists" };
        state.created.push(p.id);
        const v = { ...p, active: true, livemode: false };
        state.products.set(p.id, v);
        return v;
      },
    },
    prices: {
      list: async ({ product }: any) => ({
        data: [...state.prices.values()].filter((p) => p.product === product),
      }),
      create: async (p: any) => {
        const id = `price_${p.product}`,
          v = { ...p, id, billing_scheme: "per_unit" };
        state.prices.set(id, v);
        return v;
      },
    },
  }),
  validateProductPrice: async (
    id: string,
    _kind: string,
    product_id: string,
  ) => {
    const p = state.prices.get(id);
    return { id, product_id, amount: p.unit_amount, currency: p.currency };
  },
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      let amount = 0,
        productId = "",
        patch: any;
      const b: any = {
        select: () => b,
        eq: (k: string, v: any) => {
          if (k === "amount") amount = v;
          if (k === "product_id") productId = v;
          return b;
        },
        single: async () => ({ data: { min_amount: 100, max_amount: 100000 } }),
        maybeSingle: async () => ({ data: state.cache.get(amount) ?? null }),
        upsert: (v: any) => {
          if (!state.cache.has(v.amount)) state.cache.set(v.amount, v);
          return Promise.resolve({ data: null });
        },
        update: (v: any) => {
          patch = v;
          return b;
        },
        then: (resolve: any) => {
          if (patch) {
            for (const v of state.cache.values())
              if (v.product_id === productId) Object.assign(v, patch);
          }
          return Promise.resolve({ data: null }).then(resolve);
        },
      };
      return b;
    },
  }),
}));
import { ensureGiftValue } from "../src/lib/gifts/stripe";
beforeEach(() => {
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("GIFT_CARDS_ENABLED", "true");
  state.products.clear();
  state.prices.clear();
  state.cache.clear();
  state.created = [];
});
afterEach(() => vi.unstubAllEnvs());
it("uses one deterministic Stripe product per denomination, including simultaneous and repeated requests", async () => {
  const [a, b] = await Promise.all([
    ensureGiftValue(5000),
    ensureGiftValue(5000),
  ]);
  expect(a.id).toBe(b.id);
  expect(state.created).toEqual(["prod_pa_gift_test_eur_5000"]);
  await ensureGiftValue(5000);
  await ensureGiftValue(7500);
  expect(state.created).toHaveLength(2);
});
it("recovers the same Stripe product and price when persistence stopped between Stripe creation and local caching", async () => {
  const first = await ensureGiftValue(5000);
  state.cache.clear();
  expect(await ensureGiftValue(5000)).toEqual(first);
  expect(state.created).toHaveLength(1);
});
it("rejects invalid bounds and a mismatching cached Stripe amount", async () => {
  await expect(ensureGiftValue(99)).rejects.toThrow(/Betrag/);
  const p = await ensureGiftValue(5000);
  state.prices.get(p.id).unit_amount = 100;
  await expect(ensureGiftValue(5000)).rejects.toThrow(/stimmt nicht/);
});
