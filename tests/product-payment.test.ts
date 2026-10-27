import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { emptyProduct } from "../src/lib/products/domain";
import { simulateProductContext } from "../src/lib/products/simulation";
const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  stripe: {} as any,
  product: null as any,
  ctx: null as any,
  calls: [] as any[],
}));
vi.mock("../src/lib/server/products/stripe", () => ({
  productStripe: () => state.stripe,
  verifyStoredPrice: async (p: any) => p.price,
}));
vi.mock("../src/lib/server/products/catalog", () => ({
  productById: async () => state.product,
}));
vi.mock("../src/lib/server/products/context", () => ({
  loadProductContext: async () => structuredClone(state.ctx),
  checked: (r: any) => {
    if (r.error) throw Error("DB error");
    return r.data;
  },
  collect: async (make: any) => (await make()).data,
}));
vi.mock("../src/lib/server/stripe", () => ({ syncSubscription: vi.fn() }));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: (table: string) => builder(table),
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user: {
              id: "auth-test",
              email_confirmed_at: new Date().toISOString(),
            },
          },
          error: null,
        }),
      },
    },
    rpc: async (name: string, args: any) => {
      state.calls.push({ name, args });
      if (name === "product_family_version")
        return { data: "context-version", error: null };
      if (name === "fulfill_product_purchase") {
        state.tables.product_purchase_intents[0].status = "fulfilled";
        return {
          data: { id: "intent-test", status: "fulfilled" },
          error: null,
        };
      }
      return { data: null, error: {} };
    },
  }),
}));
function builder(table: string) {
  const filters: ((r: any) => boolean)[] = [];
  let patch: any;
  let single = false;
  const b: any = {
    select: () => b,
    eq: (key: string, v: any) => {
      filters.push((r) => r[key] === v);
      return b;
    },
    neq: (key: string, v: any) => {
      filters.push((r) => r[key] !== v);
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
    limit: () => b,
    order: () => b,
    then: (resolve: any) => {
      let data = (state.tables[table] ?? []).filter((r) =>
        filters.every((f) => f(r)),
      );
      if (patch) for (const r of data) Object.assign(r, patch);
      return Promise.resolve({
        data: single ? (data[0] ?? null) : data,
        error: null,
      }).then(resolve);
    },
  };
  return b;
}
import { fulfillCheckout } from "../src/lib/server/products/checkout";
import { syncSubscription } from "../src/lib/server/stripe";
beforeEach(() => {
  vi.stubEnv("PRODUCT_MANAGEMENT_ENABLED", "true");
  vi.stubEnv("PRODUCT_PAYMENTS_ENABLED", "true");
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3110");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
  state.calls = [];
  vi.mocked(syncSubscription).mockClear();
  const price = {
    id: "price_test",
    product_id: "prod_test",
    amount: 9900,
    currency: "eur",
    interval: null,
    interval_count: 1,
    livemode: false,
    checked_at: new Date().toISOString(),
    product_name: "Test",
    source: "stripe",
  };
  const product = {
    ...emptyProduct(),
    name: "Paid test",
    kind: "other",
    status: "active",
    channels: ["catalog"],
    price,
  };
  state.product = {
    id: "product-test",
    published: product,
    published_revision: 1,
  };
  state.ctx = simulateProductContext("new", "product-test");
  state.tables = {
    product_purchase_intents: [
      {
        id: "intent-test",
        product_id: "product-test",
        status: "checkout",
        session_id: "cs_test_paid",
        product,
        expected_subtotal: 9900,
        expected_amount: 9900,
        currency: "eur",
        customer_id: "cus_test",
        auth_id: "auth-test",
        parent_id: "parent-test",
        player_id: state.ctx.children[0].id,
        channel: "catalog",
      },
    ],
    profiles: [{ id: "auth-test", role: "parent" }],
  };
  state.stripe = {
    checkout: {
      sessions: {
        retrieve: vi.fn(async () => ({
          id: "cs_test_paid",
          livemode: false,
          client_reference_id: "intent-test",
          metadata: { product_intent_id: "intent-test" },
          mode: "payment",
          status: "complete",
          payment_status: "paid",
          customer: "cus_test",
          amount_subtotal: 9900,
          amount_total: 9900,
          currency: "eur",
          payment_intent: "pi_test",
          created: Math.floor(Date.now() / 1000),
          total_details: { amount_tax: 0, amount_shipping: 0 },
        })),
        listLineItems: vi.fn(async () => ({
          has_more: false,
          data: [
            { quantity: 1, price: { id: "price_test", product: "prod_test" } },
          ],
        })),
      },
    },
    paymentIntents: {
      retrieve: vi.fn(async () => ({
        livemode: false,
        status: "succeeded",
        amount_received: 9900,
        currency: "eur",
        latest_charge: {
          livemode: false,
          paid: true,
          refunded: false,
          disputed: false,
          amount_refunded: 0,
          amount: 9900,
        },
      })),
    },
  };
});
afterEach(() => vi.unstubAllEnvs());
it("does not fulfill when Checkout completes before an asynchronous payment succeeds", async () => {
  state.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
    livemode: false,
    client_reference_id: "intent-test",
    metadata: { product_intent_id: "intent-test" },
    mode: "payment",
    status: "complete",
    payment_status: "unpaid",
  });
  expect((await fulfillCheckout("intent-test")).status).toBe("pending_payment");
  expect(state.calls).toEqual([]);
  expect(syncSubscription).not.toHaveBeenCalled();
});
it.each(["amount", "customer", "live", "line"] as const)(
  "rejects a mismatched %s payment before any rights or mappings are written",
  async (fault) => {
    if (fault === "line")
      state.stripe.checkout.sessions.listLineItems.mockResolvedValueOnce({
        has_more: false,
        data: [
          { quantity: 2, price: { id: "price_test", product: "prod_test" } },
        ],
      });
    else {
      const original = await state.stripe.checkout.sessions.retrieve();
      state.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
        ...original,
        ...(fault === "amount"
          ? { amount_total: 1 }
          : fault === "customer"
            ? { customer: "cus_foreign" }
            : { livemode: true }),
      });
    }
    await expect(fulfillCheckout("intent-test")).rejects.toThrow();
    expect(state.calls.some((c) => c.name === "fulfill_product_purchase")).toBe(
      false,
    );
  },
);
it("requires a successful, unrefunded and undisputed charge", async () => {
  state.stripe.paymentIntents.retrieve.mockResolvedValueOnce({
    livemode: false,
    status: "succeeded",
    amount_received: 9900,
    currency: "eur",
    latest_charge: { paid: true, refunded: true },
  });
  await expect(fulfillCheckout("intent-test")).rejects.toThrow(
    /nicht vollständig/,
  );
  expect(state.calls).toEqual([]);
});
it("fulfills once with the exact stored child, current policy snapshot and verified payment proof", async () => {
  expect((await fulfillCheckout("intent-test")).status).toBe("fulfilled");
  expect((await fulfillCheckout("intent-test")).status).toBe("fulfilled");
  const calls = state.calls.filter(
    (c) => c.name === "fulfill_product_purchase",
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].args.input.context_version).toBe("context-version");
  expect(calls[0].args.input.proof.payment_id).toBe("pi_test");
  expect(calls[0].args.input.proof.total).toBe(9900);
});
it("holds an already paid order for review when the product is disabled during checkout", async () => {
  state.product.published.status = "archived";
  expect((await fulfillCheckout("intent-test")).status).toBe("review");
  expect(state.tables.product_purchase_intents[0].status).toBe("review");
  expect(state.calls.some((c) => c.name === "fulfill_product_purchase")).toBe(
    false,
  );
});
it("preserves an existing identity review across replayed Stripe events until explicit resolution", async () => {
  const order = state.tables.product_purchase_intents[0];
  order.status = "review";
  order.reason = "Gastkauf: E-Mail bestätigen oder Familienzuordnung prüfen";
  expect(await fulfillCheckout(order.id)).toEqual({
    id: order.id,
    status: "review",
  });
  expect(order.reason).toBe(
    "Gastkauf: E-Mail bestätigen oder Familienzuordnung prüfen",
  );
  expect(state.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  expect(state.calls).toEqual([]);
});
