import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { emptyProduct } from "../src/lib/products/domain";
import { simulateProductContext } from "../src/lib/products/simulation";
const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  ctx: null as any,
  product: null as any,
  stripe: null as any,
  sub: null as any,
}));
vi.mock("../src/lib/server/products/catalog", () => ({
  productById: async () => state.product,
}));
vi.mock("../src/lib/server/products/context", () => ({
  loadProductContext: async () => structuredClone(state.ctx),
  checked: (r: any) => {
    if (r.error) throw Error("DB");
    return r.data;
  },
  collect: async (make: any) => (await make()).data,
}));
vi.mock("../src/lib/server/products/stripe", () => ({
  productStripe: () => state.stripe,
  verifyStoredPrice: async (p: any) => p.price,
}));
vi.mock("../src/lib/server/stripe", () => ({ syncSubscription: vi.fn() }));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ from: (t: string) => builder(t) }),
}));
function builder(t: string) {
  const filters: ((r: any) => boolean)[] = [];
  let patch: any,
    insert: any,
    single = false;
  const b: any = {
    select: () => b,
    eq: (k: string, v: any) => {
      filters.push((r) => r[k] === v);
      return b;
    },
    in: (k: string, v: any[]) => {
      filters.push((r) => v.includes(r[k]));
      return b;
    },
    lte: () => b,
    gt: () => b,
    order: () => b,
    limit: () => b,
    insert: (v: any) => {
      insert = v;
      return b;
    },
    update: (v: any) => {
      patch = v;
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
    then: (resolve: any) => {
      if (insert) {
        state.tables[t] ??= [];
        state.tables[t].push({
          id: "f0000000-0000-4000-8000-000000000001",
          status: "preview",
          expires_at: new Date(Date.now() + 600000).toISOString(),
          ...insert,
        });
      }
      const rows = (state.tables[t] ?? []).filter((r) =>
        filters.every((f) => f(r)),
      );
      if (patch) for (const r of rows) Object.assign(r, patch);
      return Promise.resolve({
        data: single ? (rows[0] ?? null) : rows,
        error: null,
      }).then(resolve);
    },
  };
  return b;
}
import {
  previewProductChange,
  confirmProductChange,
} from "../src/lib/server/products/changes";
import { syncSubscription } from "../src/lib/server/stripe";
const productId = "f0000000-0000-4000-8000-000000000002";
const session: any = { role: "parent", user: { id: "auth-parent" } };
beforeEach(() => {
  vi.stubEnv("PRODUCT_MANAGEMENT_ENABLED", "true");
  vi.stubEnv("PRODUCT_PAYMENTS_ENABLED", "true");
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3110");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
  vi.mocked(syncSubscription).mockClear();
  state.ctx = simulateProductContext("firsttouch", productId);
  state.ctx.auth_id = "auth-parent";
  const member = state.ctx.children[0].memberships[0];
  member.stripe_subscription_id = "sub_current";
  member.item_id = "si_current";
  const price = {
    id: "price_target",
    product_id: "prod_target",
    amount: 15900,
    currency: "eur",
    interval: "month",
    interval_count: 1,
    livemode: false,
    checked_at: new Date().toISOString(),
    product_name: "Target",
    source: "stripe",
  };
  state.product = {
    id: productId,
    published_revision: 1,
    published: {
      ...emptyProduct(),
      name: "GameChanger",
      kind: "subscription",
      status: "active",
      channels: ["catalog"],
      plan_id: "f0000000-0000-4000-8000-000000000003",
      price,
    },
  };
  state.tables = {
    parent_stripe_customers: [
      { parent_id: state.ctx.parent_id, stripe_customer_id: "cus_current" },
    ],
    plans: [
      {
        id: state.product.published.plan_id,
        generation: "current",
        included_units: 8,
        athletics_units: 0,
      },
    ],
    product_change_requests: [],
    entitlement_periods: [],
    event_participants: [],
  };
  state.sub = {
    id: "sub_current",
    livemode: false,
    status: "active",
    customer: "cus_current",
    cancel_at_period_end: false,
    cancel_at: null,
    pending_update: null,
    schedule: null,
    collection_method: "charge_automatically",
    latest_invoice: {
      id: "in_paid",
      status: "paid",
      amount_remaining: 0,
      livemode: false,
    },
    items: {
      has_more: false,
      data: [
        {
          id: "si_current",
          quantity: 1,
          price: {
            id: "price_old",
            unit_amount: 9900,
            currency: "eur",
            recurring: { interval: "month" },
          },
          current_period_start: Math.floor(Date.now() / 1000) - 86400,
          current_period_end: Math.floor(Date.now() / 1000) + 29 * 86400,
        },
      ],
    },
  };
  state.stripe = {
    subscriptions: {
      retrieve: vi.fn(async () => structuredClone(state.sub)),
      create: vi.fn(),
      update: vi.fn(async () => {
        state.sub.pending_update = {
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        };
        return structuredClone(state.sub);
      }),
    },
    invoices: {
      createPreview: vi.fn(async () => ({
        livemode: false,
        currency: "eur",
        amount_due: 3000,
      })),
    },
    subscriptionSchedules: {
      create: vi.fn(async () => ({
        id: "sub_sched_test",
        livemode: false,
        current_phase: {
          start_date: state.sub.items.data[0].current_period_start,
          end_date: state.sub.items.data[0].current_period_end,
        },
      })),
      update: vi.fn(async () => ({ id: "sub_sched_test", livemode: false })),
    },
  };
});
afterEach(() => vi.unstubAllEnvs());
it("updates the exact existing item with payment-dependent upgrade and never creates a second subscription", async () => {
  const v = await previewProductChange(session, productId, {
    player_id: state.ctx.children[0].id,
  });
  expect(v.amount_due).toBe(3000);
  const r = await confirmProductChange(session, v.id);
  expect(r.status).toBe("pending_payment");
  expect(state.stripe.subscriptions.update).toHaveBeenCalledWith(
    "sub_current",
    expect.objectContaining({
      items: [{ id: "si_current", price: "price_target", quantity: 1 }],
      payment_behavior: "pending_if_incomplete",
      proration_behavior: "always_invoice",
    }),
    expect.anything(),
  );
  expect(state.stripe.subscriptions.create).not.toHaveBeenCalled();
  expect(syncSubscription).toHaveBeenCalledWith("sub_current", state.stripe);
});
it("schedules a downgrade at the original period end on the same subscription", async () => {
  const member = state.ctx.children[0].memberships[0];
  member.units = 8;
  member.plan = "GameChanger";
  state.sub.items.data[0].price.unit_amount = 15900;
  state.product.published.price.amount = 9900;
  state.tables.plans[0].included_units = 4;
  const v = await previewProductChange(session, productId, {
    player_id: state.ctx.children[0].id,
  });
  expect(v.direction).toBe("downgrade");
  expect(v.amount_due).toBe(0);
  const r = await confirmProductChange(session, v.id);
  expect(r.status).toBe("scheduled");
  expect(state.stripe.subscriptionSchedules.create).toHaveBeenCalledWith(
    { from_subscription: "sub_current" },
    expect.anything(),
  );
  expect(
    state.stripe.subscriptionSchedules.update.mock.calls[0][1].phases[0]
      .end_date,
  ).toBe(state.sub.items.data[0].current_period_end);
  expect(state.stripe.subscriptions.create).not.toHaveBeenCalled();
  expect(syncSubscription).not.toHaveBeenCalled();
});
it("rejects a changed subscription after preview before mutating Stripe", async () => {
  const v = await previewProductChange(session, productId, {
    player_id: state.ctx.children[0].id,
  });
  state.sub.cancel_at_period_end = true;
  await expect(confirmProductChange(session, v.id)).rejects.toThrow(
    /hat sich geändert/,
  );
  expect(state.stripe.subscriptions.update).not.toHaveBeenCalled();
});
it("rejects foreign, ambiguous and unpaid subscriptions before creating any change request", async () => {
  state.tables.parent_stripe_customers.push({
    parent_id: "foreign",
    stripe_customer_id: "cus_current",
  });
  await expect(
    previewProductChange(session, productId, {
      player_id: state.ctx.children[0].id,
    }),
  ).rejects.toThrow(/persönliche Prüfung/);
  expect(state.tables.product_change_requests).toHaveLength(0);
});
it("synchronises external cancellation while a downgrade is scheduled", async () => {
  const { reconcileProductChanges } =
    await import("../src/lib/server/products/changes");
  state.tables.product_change_requests = [
    {
      id: "scheduled-change",
      subscription_id: "sub_current",
      status: "scheduled",
      item_id: "si_current",
      schedule_id: "sched_old",
      preview: { target_price: "price_target" },
    },
  ];
  state.sub.status = "canceled";
  const r = await reconcileProductChanges("sub_current");
  expect(r.sync_allowed).toBe(true);
  expect(syncSubscription).toHaveBeenCalledWith("sub_current", state.stripe);
  expect(state.tables.product_change_requests[0].status).toBe("failed");
});
it("keeps a future downgrade without blocking normal subscription sync", async () => {
  const { reconcileProductChanges } =
    await import("../src/lib/server/products/changes");
  state.sub.schedule = "sched_future";
  state.tables.product_change_requests = [
    {
      id: "scheduled-change",
      subscription_id: "sub_current",
      status: "scheduled",
      item_id: "si_current",
      schedule_id: "sched_future",
      preview: { target_price: "price_target" },
    },
  ];
  expect((await reconcileProductChanges("sub_current")).sync_allowed).toBe(
    true,
  );
  expect(state.tables.product_change_requests[0].status).toBe("scheduled");
  expect(syncSubscription).toHaveBeenCalledOnce();
});
it("releases a downgrade externally removed from Stripe", async () => {
  const { reconcileProductChanges } =
    await import("../src/lib/server/products/changes");
  state.tables.product_change_requests = [
    {
      id: "scheduled-change",
      subscription_id: "sub_current",
      status: "scheduled",
      item_id: "si_current",
      schedule_id: "sched_removed",
      preview: { target_price: "price_target" },
    },
  ];
  await reconcileProductChanges("sub_current");
  expect(state.tables.product_change_requests[0].status).toBe("failed");
});
it("retains the original discount identity across both downgrade phases without redeeming a coupon again", async () => {
  const member = state.ctx.children[0].memberships[0];
  member.units = 8;
  member.plan = "GameChanger";
  state.sub.items.data[0].price.unit_amount = 15900;
  state.product.published.price.amount = 9900;
  state.tables.plans[0].included_units = 4;
  state.sub.discounts = ["di_original_duration"];
  const v = await previewProductChange(session, productId, {
    player_id: state.ctx.children[0].id,
  });
  await confirmProductChange(session, v.id);
  const phases =
    state.stripe.subscriptionSchedules.update.mock.calls[0][1].phases;
  expect(phases.map((p: any) => p.discounts)).toEqual([
    [{ discount: "di_original_duration" }],
    [{ discount: "di_original_duration" }],
  ]);
});
it("invalidates a price preview when an external Stripe discount changes", async () => {
  const v = await previewProductChange(session, productId, {
    player_id: state.ctx.children[0].id,
  });
  state.sub.discounts = ["di_external"];
  await expect(confirmProductChange(session, v.id)).rejects.toThrow(
    /hat sich geändert/,
  );
  expect(state.stripe.subscriptions.update).not.toHaveBeenCalled();
});
