import { beforeEach, afterEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  jobs: [] as any[],
  stripe: null as any,
  sub: null as any,
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: (t: string) => builder(t),
    rpc: async () => ({ data: state.jobs, error: null }),
  }),
}));
vi.mock("../src/lib/server/products/stripe", () => ({
  productStripe: () => state.stripe,
}));
vi.mock("../src/lib/server/stripe", () => ({
  syncSubscription: vi.fn(),
  syncInvoicePeriods: vi.fn(),
}));
function builder(t: string) {
  const filters: ((r: any) => boolean)[] = [];
  let patch: any,
    upsert: any,
    options: any,
    single = false;
  const b: any = {
    select: () => b,
    order: () => b,
    limit: () => b,
    eq: (k: string, v: any) => {
      filters.push((r) => r[k] === v);
      return b;
    },
    in: (k: string, v: any[]) => {
      filters.push((r) => v.includes(r[k]));
      return b;
    },
    gt: () => b,
    maybeSingle: () => {
      single = true;
      return b;
    },
    update: (v: any) => {
      patch = v;
      return b;
    },
    upsert: (v: any, o: any) => {
      upsert = v;
      options = o;
      return b;
    },
    then: (resolve: any) => {
      state.tables[t] ??= [];
      if (upsert) {
        const keys = (options?.onConflict ?? "id").split(",");
        const old = state.tables[t].find((r) =>
          keys.every((k: string) => r[k] === upsert[k]),
        );
        if (old) {
          if (!options?.ignoreDuplicates) Object.assign(old, upsert);
        } else
          state.tables[t].push({
            id: `row-${state.tables[t].length}`,
            status: "paid",
            ...upsert,
          });
      }
      const rows = state.tables[t].filter((r) => filters.every((f) => f(r)));
      if (patch) rows.forEach((r) => Object.assign(r, patch));
      return Promise.resolve({
        data: single ? (rows[0] ?? null) : rows,
        error: null,
      }).then(resolve);
    },
  };
  return b;
}
import {
  processProductEvents,
  enqueueProductEvent,
} from "../src/lib/server/products/events";
import { syncSubscription, syncInvoicePeriods } from "../src/lib/server/stripe";
const list = (rows: any[]) => ({
  async *[Symbol.asyncIterator]() {
    yield* rows;
  },
});
beforeEach(() => {
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3110");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
  vi.stubEnv("PRODUCT_MANAGEMENT_ENABLED", "true");
  vi.stubEnv("PRODUCT_PAYMENTS_ENABLED", "true");
  vi.mocked(syncSubscription).mockClear();
  vi.mocked(syncInvoicePeriods).mockClear();
  state.sub = {
    id: "sub_existing",
    livemode: false,
    status: "active",
    customer: "cus_own",
    pending_update: null,
    schedule: null,
    items: { data: [{ id: "si_own", price: { id: "price_old" } }] },
    latest_invoice: {
      id: "in_paid",
      livemode: false,
      status: "paid",
      amount_remaining: 0,
    },
  };
  state.tables = {
    subscriptions: [
      {
        id: "db-sub",
        stripe_subscription_id: "sub_existing",
        parent_id: "family",
        stripe_customer_id: "cus_own",
      },
    ],
    parent_stripe_customers: [
      { id: "account", parent_id: "family", stripe_customer_id: "cus_own" },
    ],
    product_change_requests: [],
    product_purchase_intents: [],
    product_payment_events: [
      { id: "job", lease_token: "lease", status: "processing" },
    ],
    product_payment_links: [],
  };
  state.jobs = [
    {
      id: "job",
      lease_token: "lease",
      type: "customer.subscription.updated",
      object_id: "sub_existing",
      attempts: 1,
    },
  ];
  const invoice = {
    id: "in_paid",
    livemode: false,
    status: "paid",
    customer: "cus_own",
    parent: { subscription_details: { subscription: "sub_existing" } },
  };
  state.stripe = {
    subscriptions: { retrieve: vi.fn(async () => structuredClone(state.sub)) },
    invoices: { retrieve: vi.fn(async () => invoice) },
    invoicePayments: {
      list: vi.fn(() =>
        list([
          {
            invoice: "in_paid",
            livemode: false,
            status: "paid",
            amount_paid: 9900,
            currency: "eur",
            payment: { type: "payment_intent", payment_intent: "pi_invoice" },
          },
        ]),
      ),
    },
    charges: {
      retrieve: vi.fn(async () => ({
        id: "ch_paid",
        livemode: false,
        payment_intent: "pi_invoice",
        refunded: true,
        amount_refunded: 9900,
        disputed: false,
      })),
    },
  };
});
afterEach(() => vi.unstubAllEnvs());
it("imports external changes of an existing subscription without any product checkout", async () => {
  expect((await processProductEvents()).processed).toBe(1);
  expect(syncSubscription).toHaveBeenCalledWith("sub_existing", state.stripe);
});
it("does not swallow external cancellation during a scheduled downgrade", async () => {
  state.sub.status = "canceled";
  state.tables.product_change_requests = [
    {
      id: "change",
      subscription_id: "sub_existing",
      status: "scheduled",
      item_id: "si_own",
      schedule_id: "sched",
      preview: { target_price: "price_new" },
    },
  ];
  await processProductEvents();
  expect(syncSubscription).toHaveBeenCalledWith("sub_existing", state.stripe);
  expect(state.tables.product_change_requests[0].status).toBe("failed");
});
it("imports externally paid invoice periods and records invoice-to-payment references", async () => {
  state.jobs[0].type = "invoice.paid";
  state.jobs[0].object_id = "in_paid";
  await processProductEvents();
  expect(syncInvoicePeriods).toHaveBeenCalledWith(
    "in_paid",
    "sub_existing",
    state.stripe,
  );
  expect(state.tables.product_payment_links[0]).toMatchObject({
    invoice_id: "in_paid",
    payment_intent_id: "pi_invoice",
    subscription_id: "sub_existing",
    parent_id: "family",
  });
});
it("finds a subscription refund through its invoice payment even when the order stores an invoice ID", async () => {
  state.jobs[0].type = "charge.refunded";
  state.jobs[0].object_id = "ch_paid";
  state.tables.product_purchase_intents = [
    {
      id: "order",
      subscription_id: "sub_existing",
      payment_id: "in_paid",
      status: "fulfilled",
      product: { kind: "subscription" },
    },
  ];
  await processProductEvents();
  expect(state.tables.product_payment_links[0].status).toBe("refunded");
  expect(state.tables.subscriptions[0].needs_review).toBe(true);
  expect(state.tables.product_purchase_intents[0].reason).toMatch(/Erstattung/);
  expect(syncSubscription).not.toHaveBeenCalled();
});
it("never imports an unrelated Stripe test family by matching an email", async () => {
  state.tables.subscriptions = [];
  state.tables.parent_stripe_customers = [];
  await processProductEvents();
  expect(syncSubscription).not.toHaveBeenCalled();
});
it("deduplicates webhook and polling deliveries by the same Stripe event ID", async () => {
  const event: any = {
    id: "evt_same",
    type: "customer.subscription.updated",
    livemode: false,
    data: { object: { id: "sub_existing" } },
  };
  await enqueueProductEvent(event);
  await enqueueProductEvent(event);
  expect(
    state.tables.product_payment_events.filter(
      (e) => e.stripe_event_id === "evt_same",
    ),
  ).toHaveLength(1);
});
it("does not reopen a documented payment review for an unchanged refund delivered again", async () => {
  const charge = await state.stripe.charges.retrieve();
  state.jobs[0].type = "charge.refunded";
  state.jobs[0].object_id = charge.id;
  state.tables.subscriptions[0].needs_review = false;
  state.tables.product_payment_links = [
    {
      id: "link",
      parent_id: "family",
      subscription_id: "sub_existing",
      invoice_id: "in_paid",
      payment_intent_id: "pi_invoice",
      status: "refunded",
      charge_state: JSON.stringify({
        paid: charge.paid,
        refunded: charge.refunded,
        amount_refunded: charge.amount_refunded,
        disputed: charge.disputed,
      }),
      review_resolved_at: new Date().toISOString(),
    },
  ];
  await processProductEvents();
  expect(state.tables.subscriptions[0].needs_review).toBe(false);
  expect(state.tables.product_payment_links[0].review_resolved_at).toBeTruthy();
});
