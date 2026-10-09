import { beforeEach, it, expect, vi } from "vitest";
const f = vi.hoisted(() => ({
  charges: [] as any[],
  invoices: [] as any[],
  refunds: [] as any[],
  query: vi.fn(),
  client: vi.fn(),
  authorize: vi.fn(),
}));
vi.mock("../src/lib/server/parent-profile", () => ({
  authorizeProfile: f.authorize,
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({
          data: [{ stripe_customer_id: "cus_one" }],
          error: null,
        }),
        in: () => ({
          neq: () => ({ limit: async () => ({ data: [], error: null }) }),
        }),
      }),
    }),
  }),
}));
vi.mock("../src/lib/server/stripe", () => ({ stripeClient: f.client }));
vi.mock("../src/lib/camps/runtime", () => ({
  campEnabled: () => false,
  campPaymentMode: () => "test",
}));
vi.mock("../src/lib/camps/processing", () => ({ campReadStripe: vi.fn() }));
import { readProfileFinances } from "../src/lib/server/parent-profile-finances";
const admin = { role: "admin", user: { id: "admin" } } as any;
const seconds = (day: string) => Date.parse(day + "T12:00:00Z") / 1000;
beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  f.charges = [];
  f.invoices = [];
  f.refunds = [];
  f.authorize.mockResolvedValue({ id: "parent" });
  f.client.mockReturnValue({
    accounts: {
      retrieve: async () => {
        throw new Error("Connected account read is not permitted for this key");
      },
    },
    customers: { retrieve: async () => ({ id: "cus_one" }) },
    charges: { list: async () => ({ data: f.charges, has_more: false }) },
    invoices: { list: async () => ({ data: f.invoices, has_more: false }) },
    refunds: { list: async () => ({ data: f.refunds, has_more: false }) },
  });
});
it.each(["staff", "parent", undefined])(
  "blocks %s before Stripe or parent lookup",
  async (role) => {
    await expect(readProfileFinances({ role } as any, "p")).rejects.toThrow(
      "nur für Admins",
    );
    expect(f.client).not.toHaveBeenCalled();
    expect(f.authorize).not.toHaveBeenCalled();
  },
);
it("counts captures once and places refunds of older charges into their refund month", async () => {
  const day = new Date().toISOString().slice(0, 10);
  f.charges = [
    {
      id: "ch_one",
      payment_intent: "pi_one",
      status: "succeeded",
      paid: true,
      captured: true,
      amount_captured: 10000,
      amount_refunded: 2500,
      currency: "eur",
      balance_transaction: { created: seconds("2020-01-01") },
    },
    { id: "ch_fail", status: "failed", amount_captured: 9999 },
  ];
  f.invoices = [
    {
      id: "in_one",
      parent: { subscription_details: { subscription: "sub_one" } },
      lines: {
        has_more: false,
        data: [
          {
            parent: {
              subscription_item_details: { subscription_item: "si_one" },
            },
          },
        ],
      },
      payments: {
        has_more: false,
        data: [
          {
            status: "paid",
            amount_paid: 10000,
            payment: { payment_intent: "pi_one" },
          },
        ],
      },
    },
  ];
  f.refunds = [
    { id: "re_one", status: "succeeded", amount: 2500, created: seconds(day) },
    { id: "re_failed", status: "failed", amount: 1000, created: seconds(day) },
  ];
  const result = await readProfileFinances(admin, "p");
  expect(result.complete).toBe(true);
  expect(result.currencies[0]).toEqual({
    currency: "eur",
    all: { total: 7500, subscriptions: 7500 },
    month: { total: -2500, subscriptions: -2500 },
  });
});
it("does not pretend mixed invoice money is all subscription spending", async () => {
  f.charges = [
    {
      id: "ch_one",
      payment_intent: "pi_one",
      status: "succeeded",
      paid: true,
      captured: true,
      amount_captured: 10000,
      amount_refunded: 0,
      currency: "eur",
      balance_transaction: { created: seconds("2020-01-01") },
    },
  ];
  f.invoices = [
    {
      id: "in_one",
      parent: { subscription_details: { subscription: "sub_one" } },
      lines: {
        has_more: false,
        data: [{ parent: { invoice_item_details: {} } }],
      },
      payments: {
        has_more: false,
        data: [{ status: "paid", payment: { payment_intent: "pi_one" } }],
      },
    },
  ];
  const r = await readProfileFinances(admin, "p");
  expect(r.currencies[0].all.total).toBe(10000);
  expect(r.currencies[0].all.subscriptions).toBeNull();
});
it("reports incomplete confirmation dates and disputes instead of trusted totals", async () => {
  f.charges = [
    {
      id: "ch_one",
      status: "succeeded",
      paid: true,
      captured: true,
      amount_captured: 10000,
      amount_refunded: 0,
      currency: "eur",
      disputed: true,
    },
  ];
  const r = await readProfileFinances(admin, "p");
  expect(r.complete).toBe(false);
  expect(r.notes.length).toBeGreaterThan(0);
});
