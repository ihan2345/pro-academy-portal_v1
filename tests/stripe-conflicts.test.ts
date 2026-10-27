import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const m = vi.hoisted(() => ({
  client: vi.fn(),
  subscriptions: vi.fn(),
  invoices: vi.fn(),
  tables: {} as Record<string, any[]>,
  reads: [] as string[],
}));
vi.mock("../src/lib/server/profile-stripe", () => ({
  profileStripeClient: m.client,
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      m.reads.push(table);
      let rows = [...(m.tables[table] ?? [])];
      const q: any = {
        select: () => q,
        order: () => q,
        limit: () => q,
        in: (k: string, values: any[]) => {
          rows = rows.filter((r) => values.includes(r[k]));
          return q;
        },
        eq: (k: string, value: unknown) => {
          rows = rows.filter((r) => r[k] === value);
          return q;
        },
        gt: (k: string, value: any) => {
          rows = rows.filter((r) => r[k] > value);
          return q;
        },
        lte: (k: string, value: any) => {
          rows = rows.filter((r) => r[k] <= value);
          return q;
        },
        then: (resolve: any) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return q;
    },
  }),
}));
import { stripeBillingConflicts } from "../src/lib/server/stripe-conflicts";
import { stripeActivityActions } from "../src/lib/stripe-conflicts";
import { DashboardDisclosure } from "../src/components/dashboard-disclosure";
const admin = { role: "admin" } as any;
const sub = {
  id: "sub_one",
  customer: "cus_one",
  livemode: false,
  status: "canceled",
  cancellation_details: { reason: "payment_failed" },
};
const invoice = {
  id: "in_one",
  customer: "cus_one",
  status: "open",
  amount_remaining: 8900,
  currency: "eur",
  number: "TEST-1",
  attempted: true,
  attempt_count: 5,
  parent: { subscription_details: { subscription: "sub_one" } },
  metadata: { private_value: "never for browser" },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  m.reads = [];
  m.client.mockReturnValue({
    subscriptions: { list: m.subscriptions },
    invoices: { list: m.invoices },
  });
  m.subscriptions.mockResolvedValue({ data: [sub], has_more: false });
  m.invoices.mockResolvedValue({ data: [invoice], has_more: false });
  m.tables = {
    subscriptions: [{ id: "local", stripe_subscription_id: "sub_one" }],
    stripe_customer_registry: [{ id: "cus_one", name: "Familie Beispiel" }],
    subscription_players: [
      {
        id: "mapping",
        subscription_id: "local",
        player_id: "child",
        players: {
          first_name: "Ada",
          last_name: "Beispiel",
          archived_at: null,
        },
      },
    ],
    entitlement_periods: [
      {
        id: "period",
        subscription_id: "local",
        player_id: "child",
        status: "suspended",
        starts_at: "2026-09-29",
        ends_at: "2026-10-29",
      },
    ],
  };
});
afterEach(() => vi.useRealTimers());
it.each(["parent", "staff", undefined])(
  "rejects %s before any Stripe or database access",
  async (role) => {
    await expect(stripeBillingConflicts({ role } as any)).rejects.toThrow();
    expect(m.client).not.toHaveBeenCalled();
    expect(m.reads).toEqual([]);
  },
);
it("groups repeated failed payments into one current Abo case with child and invoice attribution", async () => {
  m.invoices.mockResolvedValue({
    data: [invoice, { ...invoice, id: "in_two", number: "TEST-2" }],
    has_more: false,
  });
  const result = await stripeBillingConflicts(admin);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    customer: "Familie Beispiel",
    status: "canceled",
    blocked: true,
    reason: "Abo wegen fehlgeschlagener Zahlung beendet",
    children: [{ id: "child", name: "Ada Beispiel" }],
    invoices: [
      { id: "in_one", remaining: 8900 },
      { id: "in_two", remaining: 8900 },
    ],
    href: "https://dashboard.stripe.com/test/subscriptions/sub_one",
  });
  expect(JSON.stringify(result)).not.toContain("never for browser");
});
it("does not keep old failures open after payment and ignores regular cancellations, draft, future-due and one-off invoices", async () => {
  m.subscriptions.mockResolvedValue({
    data: [
      { ...sub, status: "active" },
      {
        ...sub,
        id: "sub_cancel",
        cancellation_details: { reason: "cancellation_requested" },
      },
    ],
    has_more: false,
  });
  m.invoices.mockResolvedValue({
    data: [
      { ...invoice, status: "paid", amount_remaining: 0 },
      { ...invoice, id: "in_processing", due_date: null },
      { ...invoice, id: "in_draft", status: "draft" },
      {
        ...invoice,
        id: "in_future",
        attempted: false,
        attempt_count: 0,
        due_date: Date.now() / 1000 + 86400,
      },
      { ...invoice, id: "in_camp", parent: null },
    ],
    has_more: false,
  });
  expect((await stripeBillingConflicts(admin)).rows).toEqual([]);
});
it("ignores a settled canceled Abo when the same child already has a valid replacement", async () => {
  m.invoices.mockResolvedValue({ data: [], has_more: false });
  m.subscriptions.mockResolvedValue({
    data: [sub, { ...sub, id: "sub_new", status: "active" }],
    has_more: false,
  });
  m.tables.entitlement_periods.push({
    id: "new-period",
    subscription_id: "new-local",
    player_id: "child",
    status: "active",
    starts_at: "2026-10-20",
    ends_at: "2026-11-20",
    subscriptions: { stripe_subscription_id: "sub_new" },
  });
  expect((await stripeBillingConflicts(admin)).rows).toEqual([]);
});
it("includes restricted Abos without an open invoice and reads every Stripe page", async () => {
  m.invoices.mockResolvedValue({ data: [], has_more: false });
  m.subscriptions.mockImplementation(async (params: any) =>
    params.starting_after
      ? {
          data: [{ ...sub, id: "sub_unpaid", status: "unpaid" }],
          has_more: false,
        }
      : { data: [{ ...sub, status: "active" }], has_more: true },
  );
  const result = await stripeBillingConflicts(admin);
  expect(m.subscriptions).toHaveBeenCalledTimes(2);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].status).toBe("unpaid");
});
it("fails instead of returning a false zero or a partial result when Stripe fails or pagination stalls", async () => {
  m.invoices.mockRejectedValue(Error("offline"));
  await expect(stripeBillingConflicts(admin)).rejects.toThrow(
    "nicht verfügbar",
  );
  m.invoices.mockResolvedValue({ data: [], has_more: true });
  await expect(stripeBillingConflicts(admin)).rejects.toThrow(
    "nicht vollständig",
  );
});
it("starts collapsed and deduplicates activity actions independently of successful history entries", () => {
  const html = renderToStaticMarkup(
    createElement(DashboardDisclosure, {
      title: "Stripe/Abo-Konflikte",
      count: 2,
      description: "Test",
      children: "Details",
    }),
  );
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('hidden=""');
  expect(html).toContain("2 offene Aktionen");
  const row = {
    id: "evt_one",
    subscriptionId: "sub_one",
    actionRequired: true,
    actionLabel: "Zuordnung / Tarif prüfen",
    href: "/admin",
  };
  expect(
    stripeActivityActions([
      row,
      { ...row, id: "evt_two" },
      { ...row, id: "evt_paid", actionRequired: false },
    ]),
  ).toBe(1);
  expect(
    stripeActivityActions([
      { ...row, actionLabel: "Verarbeitung prüfen" },
      { ...row, id: "evt_failed", actionLabel: "Verarbeitung prüfen" },
    ]),
  ).toBe(2);
});
