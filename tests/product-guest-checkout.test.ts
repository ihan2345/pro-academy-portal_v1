import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { emptyProduct, visitorContext } from "../src/lib/products/domain";
const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  reads: [] as string[],
  rpc: [] as any[],
  stripe: {} as any,
  product: {} as any,
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      state.reads.push(table);
      let patch: any,
        single = false;
      const filters: any[] = [];
      const b: any = {
        select: () => b,
        eq: (k: string, v: any) => {
          filters.push((r: any) => r[k] === v);
          return b;
        },
        in: (k: string, values: any[]) => {
          filters.push((r: any) => values.includes(r[k]));
          return b;
        },
        neq: (k: string, v: any) => {
          filters.push((r: any) => r[k] !== v);
          return b;
        },
        is: (k: string, v: any) => {
          filters.push((r: any) => (r[k] ?? null) === v);
          return b;
        },
        update: (p: any) => {
          patch = p;
          return b;
        },
        single: () => {
          single = true;
          return b;
        },
        maybeSingle: () => {
          single = true;
          return b;
        },
        order: () => b,
        limit: () => b,
        gt: () => b,
        then: (resolve: any) => {
          const rows = (state.tables[table] ?? []).filter((r) =>
            filters.every((f) => f(r)),
          );
          if (patch) rows.forEach((r) => Object.assign(r, patch));
          return Promise.resolve({
            data: single ? (rows[0] ?? null) : rows,
            error: null,
          }).then(resolve);
        },
      };
      return b;
    },
    rpc: async (name: string, args: any) => {
      state.rpc.push({ name, args });
      if (name === "reserve_product_purchase") {
        const i = {
          ...args.input,
          expires_at: new Date(Date.now() + 1800000).toISOString(),
        };
        state.tables.product_purchase_intents.push(i);
        return { data: i, error: null };
      }
      throw Error("Unexpected RPC");
    },
  }),
}));
vi.mock("../src/lib/server/products/catalog", () => ({
  productById: async () => state.product,
}));
vi.mock("../src/lib/server/products/context", () => ({
  checked: (r: any) => {
    if (r.error) throw Error("DB");
    return r.data;
  },
  collect: async (make: any) => (await make()).data,
  loadProductContext: vi.fn(async () => visitorContext()),
}));
vi.mock("../src/lib/server/products/stripe", () => ({
  productStripe: () => state.stripe,
  verifyStoredPrice: async (p: any) => p.price,
}));
vi.mock("../src/lib/server/stripe", () => ({ syncSubscription: vi.fn() }));
import { checkoutProduct } from "../src/lib/server/products/checkout";
const productId = "90000000-0000-4000-8000-000000000001",
  requestId = "90000000-0000-4000-8000-000000000002";
const form = {
  request_id: requestId,
  guest_parent: { full_name: "Neue Familie", email: "family@example.invalid" },
  new_child: {
    first_name: "Neues",
    last_name: "Kind",
    birth_date: "2016-01-01",
  },
};
beforeEach(() => {
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3110");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
  vi.stubEnv("PRODUCT_MANAGEMENT_ENABLED", "true");
  vi.stubEnv("PRODUCT_PAYMENTS_ENABLED", "true");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "local-test-only-hash-secret");
  state.tables = { product_purchase_intents: [] };
  state.reads = [];
  state.rpc = [];
  const product = {
    ...emptyProduct(),
    status: "active",
    kind: "other",
    channels: ["catalog"],
    price: {
      id: "price_test",
      product_id: "prod_test",
      amount: 9900,
      currency: "eur",
      livemode: false,
    },
  };
  state.product = { id: productId, published: product, published_revision: 1 };
  state.stripe = {
    customers: {
      create: vi.fn(async () => ({ id: "cus_guest", livemode: false })),
    },
    checkout: {
      sessions: {
        create: vi.fn(async () => ({
          id: "cs_test_guest",
          livemode: false,
          url: "https://checkout.stripe.com/c/pay/cs_test_guest",
        })),
      },
    },
    promotionCodes: {
      list: vi.fn(async () => ({
        data: [
          {
            id: "promo_public",
            code: "START",
            active: true,
            livemode: false,
            customer: null,
            restrictions: {},
            coupon: {
              id: "coupon_public",
              valid: true,
              percent_off: 20,
              amount_off: null,
              duration: "once",
              duration_in_months: null,
            },
          },
        ],
      })),
    },
  };
});
afterEach(() => vi.unstubAllEnvs());
it("reserves unregistered parent/child data and opens Checkout without creating any portal identity", async () => {
  const r = await checkoutProduct(null, productId, form, "a".repeat(64));
  expect(r.url).toContain("checkout.stripe.com");
  expect(state.reads).not.toContain("parents");
  expect(state.reads).not.toContain("players");
  expect(state.reads).not.toContain("profiles");
  const input = state.rpc.find((r) => r.name === "reserve_product_purchase")
    .args.input;
  expect(input).toMatchObject({
    parent_id: null,
    auth_id: undefined,
    guest_data: form.guest_parent,
    guest_token_hash: "a".repeat(64),
    player_data: form.new_child,
    amount: 9900,
  });
  expect(state.stripe.checkout.sessions.create.mock.calls[0][0]).toMatchObject({
    customer: "cus_guest",
    client_reference_id: requestId,
    mode: "payment",
  });
});
it("reserves the discounted total and applies exactly the checked Stripe promotion", async () => {
  await checkoutProduct(
    null,
    productId,
    { ...form, discount_code: "START" },
    "a".repeat(64),
  );
  expect(state.rpc[0].args.input).toMatchObject({
    amount: 7920,
    discount: { promotion_id: "promo_public", amount: 7920 },
  });
  expect(
    state.stripe.checkout.sessions.create.mock.calls[0][0].discounts,
  ).toEqual([{ promotion_code: "promo_public" }]);
});
it("rejects forged existing identities and missing guest details before creating payment resources", async () => {
  await expect(
    checkoutProduct(
      null,
      productId,
      { ...form, player_id: productId },
      "a".repeat(64),
    ),
  ).rejects.toThrow(/Gastbestellung/);
  await expect(
    checkoutProduct(
      null,
      productId,
      { request_id: requestId, new_child: form.new_child },
      "a".repeat(64),
    ),
  ).rejects.toThrow(/Gastbestellung/);
  expect(state.stripe.customers.create).not.toHaveBeenCalled();
  expect(state.rpc).toEqual([]);
});
it("does not grant member-only eligibility to a guest with a claimed membership email", async () => {
  state.product.published.rules.purchase.clauses[0].include = ["subscriber"];
  await expect(
    checkoutProduct(null, productId, form, "a".repeat(64)),
  ).rejects.toThrow();
  expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
});
it("blocks manually entered camp membership codes even when their Stripe coupon is public", async () => {
  state.tables.camp_offers = [{ id: productId, codes: { "20": "START" } }];
  await expect(
    checkoutProduct(
      null,
      productId,
      { ...form, discount_code: "START" },
      "a".repeat(64),
    ),
  ).rejects.toThrow(/Mitgliederrabatte/);
  expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
});
it("releases only definitively rejected Checkout creation, while retaining ambiguous remote attempts", async () => {
  state.stripe.checkout.sessions.create.mockRejectedValueOnce(
    new Stripe.errors.StripeInvalidRequestError({
      message: "promotion expired",
      type: "invalid_request_error",
    }),
  );
  await expect(
    checkoutProduct(
      null,
      productId,
      { ...form, discount_code: "START" },
      "a".repeat(64),
    ),
  ).rejects.toThrow(/Rabattcode/);
  expect(state.tables.product_purchase_intents[0].status).toBe("expired");
  state.tables.product_purchase_intents = [];
  state.stripe.checkout.sessions.create.mockRejectedValueOnce(
    Error("connection lost after remote create"),
  );
  await expect(
    checkoutProduct(null, productId, form, "a".repeat(64)),
  ).rejects.toThrow(/connection lost/);
  expect(state.tables.product_purchase_intents[0].status).not.toBe("expired");
});
