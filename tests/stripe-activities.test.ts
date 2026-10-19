import { beforeEach, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  reads: [] as string[],
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      mock.reads.push(table);
      let rows = [...(mock.tables[table] ?? [])],
        cap = 1000;
      const q: any = {
        select: () => q,
        lte: (k: string, v: any) => {
          rows = rows.filter((r) => r[k] <= v);
          return q;
        },
        gt: (k: string, v: any) => {
          rows = rows.filter((r) => r[k] > v);
          return q;
        },
        in: (k: string, v: any[]) => {
          rows = rows.filter((r) => v.includes(r[k]));
          return q;
        },
        eq: (k: string, v: any) => {
          rows = rows.filter((r) => r[k] === v);
          return q;
        },
        order: () => q,
        range: () => q,
        limit: (n: number) => {
          cap = n;
          return q;
        },
        or: () => q,
        then: (f: any) =>
          Promise.resolve({ data: rows.slice(0, cap), error: null }).then(f),
      };
      return q;
    },
  }),
}));
import { stripeActivities } from "../src/lib/server/stripe-activities";
import { stripeEventTitle } from "../src/lib/stripe-activities";
const asOf = "2026-10-19T12:00:00Z";
const timestamp = Date.parse(asOf) / 1000;
const event = (n: number, age = 1) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  stripe_event_id: `evt_${n}`,
  type: "invoice.paid",
  stripe_created: timestamp - age * 3600,
  status: "processed",
  payload: {
    secret: "not for browser",
    data: {
      object: {
        customer: "cus_one",
        customer_name: "Parent",
        parent: { subscription_details: { subscription: "sub_one" } },
        billing_reason: "subscription_cycle",
        customer_email: "private@test.test",
        amount_paid: 999,
      },
    },
  },
});
beforeEach(() => {
  mock.reads = [];
  mock.tables = {
    stripe_webhook_events: [event(1)],
    subscriptions: [
      {
        id: "local",
        stripe_subscription_id: "sub_one",
        status: "active",
        stripe_data: { items: [{ id: "si_one", quantity: 1 }] },
      },
    ],
  };
});
it("uses original Stripe events and current exact subscription mapping without audit events or payload leaks", async () => {
  mock.tables.subscription_players = [
    {
      id: "mapping",
      subscription_id: "local",
      stripe_item_id: "si_one",
      players: { first_name: "Child", last_name: "One", archived_at: null },
    },
  ];
  const result = await stripeActivities({ role: "admin" } as any, { asOf });
  expect(result.rows[0]).toMatchObject({
    title: "Abo-Verlängerung bezahlt",
    assignment: "assigned",
    children: ["Child One"],
    actionRequired: false,
  });
  expect(mock.reads).not.toContain("activity_feed");
  expect(JSON.stringify(result)).not.toMatch(
    /not for browser|private@test|999/,
  );
});
it("does not confuse a family link with an assigned subscription", async () => {
  mock.tables.parent_stripe_customers = [
    { id: "link", stripe_customer_id: "cus_one" },
  ];
  const r = await stripeActivities({ role: "admin" } as any, { asOf });
  expect(r.rows[0]).toMatchObject({
    assignment: "unassigned",
    actionRequired: true,
    href: "/admin/stripe?customer=cus_one",
  });
});
it("keeps assigned tariffs requiring review actionable", async () => {
  mock.tables.subscription_players = [
    {
      id: "m",
      subscription_id: "local",
      stripe_item_id: "si_one",
      players: { first_name: "Child", last_name: "One" },
    },
  ];
  mock.tables.subscription_assignment_reviews = [
    { id: "review", subscription_id: "local", status: "pending" },
  ];
  const r = await stripeActivities({ role: "admin" } as any, { asOf });
  expect(r.rows[0]).toMatchObject({
    assignment: "assigned",
    actionRequired: true,
    actionLabel: "Zuordnung / Tarif prüfen",
  });
});
it("returns three latest original events and filters seven days", async () => {
  mock.tables.stripe_webhook_events = [
    event(1),
    event(2, 2),
    event(3, 3),
    event(4, 167),
    event(5, 168),
    event(6, 200),
  ];
  expect(
    (await stripeActivities({ role: "admin" } as any, { asOf })).rows,
  ).toHaveLength(3);
  expect(
    (
      await stripeActivities({ role: "admin" } as any, {
        asOf,
        window: "week",
        limit: 50,
      })
    ).rows,
  ).toHaveLength(4);
});
it.each(["staff", "parent", undefined])(
  "rejects %s before reading Stripe data",
  async (role) => {
    await expect(stripeActivities({ role } as any, { asOf })).rejects.toThrow();
    expect(mock.reads).toEqual([]);
  },
);
it("rejects invalid cursor filters", async () => {
  await expect(
    stripeActivities({ role: "admin" } as any, {
      asOf,
      cursor: Buffer.from(JSON.stringify({ at: 0, id: "bad),x" })).toString(
        "base64url",
      ),
    }),
  ).rejects.toThrow("Seitenreferenz");
});
it("labels actual Stripe subscription changes", () => {
  expect(
    stripeEventTitle(
      "customer.subscription.updated",
      { cancel_at_period_end: true },
      { cancel_at_period_end: false },
    ),
  ).toContain("gekündigt");
  expect(stripeEventTitle("customer.subscription.created", {})).toBe(
    "Neues Abo abgeschlossen",
  );
});
