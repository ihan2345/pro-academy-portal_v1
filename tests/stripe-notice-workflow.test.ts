import { beforeEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const m = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  billing: vi.fn(),
  hydrate: vi.fn(),
  reads: [] as string[],
  failWrite: false,
}));
vi.mock("../src/lib/server/stripe-conflicts", () => ({
  stripeBillingConflicts: m.billing,
}));
vi.mock("../src/lib/server/stripe-activities", () => ({
  stripeActivityRows: m.hydrate,
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      m.reads.push(table);
      let rows = [...(m.tables[table] ?? [])],
        offset = 0,
        limit = 1000;
      const sorts: { key: string; ascending: boolean }[] = [];
      const q: any = {
        select: () => q,
        order: (key: string, options?: any) => {
          sorts.push({ key, ascending: options?.ascending !== false });
          return q;
        },
        limit: (n: number) => {
          limit = n;
          return q;
        },
        range: (a: number, b: number) => {
          offset = a;
          limit = b - a + 1;
          return q;
        },
        eq: (key: string, v: any) => {
          rows = rows.filter((r) => r[key] === v);
          return q;
        },
        in: (key: string, v: any[]) => {
          rows = rows.filter((r) => v.includes(r[key]));
          return q;
        },
        gt: (key: string, v: any) => {
          rows = rows.filter((r) => r[key] > v);
          return q;
        },
        gte: (key: string, v: any) => {
          rows = rows.filter((r) => r[key] >= v);
          return q;
        },
        lte: (key: string, v: any) => {
          rows = rows.filter((r) => r[key] <= v);
          return q;
        },
        upsert: async (value: any) => {
          if (m.failWrite) return { error: {} };
          const all = m.tables[table] ?? [];
          m.tables[table] = [
            ...all.filter(
              (r) =>
                r.kind !== value.kind ||
                r.entity_id !== value.entity_id ||
                r.fingerprint !== value.fingerprint,
            ),
            { id: crypto.randomUUID(), ...value },
          ];
          return { error: null };
        },
        delete: () => ({
          match: async (key: any) => {
            m.tables[table] = (m.tables[table] ?? []).filter(
              (r) => !Object.entries(key).every(([k, v]) => r[k] === v),
            );
            return { error: null };
          },
        }),
        then: (f: any) => {
          rows.sort((a, b) => {
            for (const s of sorts) {
              const d = String(a[s.key]).localeCompare(String(b[s.key]));
              if (d) return s.ascending ? d : -d;
            }
            return 0;
          });
          return Promise.resolve({
            data: rows.slice(offset, offset + limit),
            count: rows.length,
            error: null,
          }).then(f);
        },
      };
      return q;
    },
  }),
}));
import { stripeOverview } from "../src/lib/server/stripe-overview";
import { decideStripeNotice } from "../src/lib/server/stripe-notice-decisions";
import {
  STRIPE_NOTICE_MONTH,
  recentStripeNotice,
} from "../src/lib/stripe-notices";
const now = Date.now(),
  admin = {
    role: "admin",
    user: { id: "a0000000-0000-4000-8000-000000000001" },
  } as any;
const billing = (n: number, age = 1) => ({
  id: `sub_${n}`,
  at: new Date(now - age * 86400000).toISOString(),
  customer: `Familie ${n}`,
  status: "unpaid",
  blocked: true,
  reason: "Zahlung offen",
  invoices: [{ id: `in_${n}`, remaining: 8900, currency: "eur" }],
  children: [],
});
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    "local-only-workflow-secret-at-least-32-chars";
  m.tables = {};
  m.reads = [];
  m.failWrite = false;
  m.billing.mockResolvedValue({
    rows: [billing(1), billing(2, 40)],
    checkedAt: new Date(now).toISOString(),
  });
  m.hydrate.mockImplementation(async (rows: any[]) =>
    rows.map((r) => ({
      id: r.stripe_event_id,
      at: new Date(r.stripe_created * 1000).toISOString(),
      customer: "Test",
      title: "Abo prüfen",
      subscriptionId: "sub_1",
      assignment: "unassigned",
      children: [],
      actionRequired: r.status === "failed",
      actionLabel: "Verarbeitung prüfen",
      href: "/admin/protokolle",
    })),
  );
});
it("counts only recent open conflicts across the whole list, persists decisions, and reopens a changed case", async () => {
  const load = () => stripeOverview(admin, { section: "conflicts" });
  const initial = await load();
  expect(initial.total).toBe(2);
  expect(initial.openCount).toBe(1);
  await decideStripeNotice(admin, {
    token: initial.rows[0].token,
    state: "done",
  });
  expect((await load()).openCount).toBe(0);
  expect((await load()).rows[0].state).toBe("done");
  expect(m.tables.stripe_notice_decisions[0].actor_id).toBe(admin.user.id);
  await decideStripeNotice(admin, {
    token: initial.rows[0].token,
    state: "ignored",
  });
  expect(m.tables.stripe_notice_decisions).toHaveLength(1);
  expect((await load()).rows[0].state).toBe("ignored");
  m.billing.mockResolvedValue({
    rows: [
      {
        ...billing(1),
        invoices: [{ id: "in_new", remaining: 8900, currency: "eur" }],
      },
    ],
  });
  expect((await load()).rows[0].state).toBe("open");
  expect((await load()).openCount).toBe(1);
});
it("keeps old conflicts out of the badge even when they are reopened; supports undo without changing source tables", async () => {
  const initial = await stripeOverview(admin, { section: "conflicts" });
  for (const state of ["ignored", "open"])
    await decideStripeNotice(admin, { token: initial.rows[1].token, state });
  expect(
    (await stripeOverview(admin, { section: "conflicts" })).openCount,
  ).toBe(1);
  await decideStripeNotice(admin, {
    token: initial.rows[0].token,
    state: "done",
  });
  await decideStripeNotice(admin, {
    token: initial.rows[0].token,
    state: "open",
  });
  expect(
    (await stripeOverview(admin, { section: "conflicts" })).openCount,
  ).toBe(1);
  expect(m.tables.stripe_notice_decisions).toEqual([]);
  expect(Object.keys(m.tables)).toEqual(["stripe_notice_decisions"]);
});
it("returns 10 activities per page with a global 30-day badge unaffected by the selected page or all-history filter", async () => {
  m.tables.stripe_webhook_events = Array.from({ length: 24 }, (_, n) => ({
    id: String(n).padStart(4, "0"),
    stripe_event_id: `evt_${n}`,
    stripe_created: Math.floor(now / 1000) - (n === 23 ? 40 : n + 1) * 86400,
    status: "failed",
  }));
  const page1 = await stripeOverview(admin, {
    section: "activities",
    window: "month",
    page: 1,
  });
  expect(page1.rows).toHaveLength(10);
  expect(page1.total).toBe(23);
  expect(page1.openCount).toBe(23);
  const page3 = await stripeOverview(admin, {
    section: "activities",
    window: "all",
    page: 3,
  });
  expect(page3.rows).toHaveLength(4);
  expect(page3.total).toBe(24);
  expect(page3.openCount).toBe(23);
  await decideStripeNotice(admin, {
    token: page3.rows[0].token,
    state: "ignored",
  });
  expect(
    (await stripeOverview(admin, { section: "activities", page: 1 })).openCount,
  ).toBe(22);
  expect(page3.rows.at(-1)?.at).toBe(
    new Date(Math.floor(now / 1000) * 1000 - 40 * 86400000).toISOString(),
  );
});
it("leaves assignment reviews available and the badge uncertain when the live billing lookup fails", async () => {
  m.billing.mockRejectedValue(Error("offline"));
  m.tables.subscription_assignment_reviews = [
    {
      id: "review",
      signature: "abc",
      created_at: new Date(now).toISOString(),
      status: "pending",
      subscriptions: { stripe_customer_id: "cus_1" },
    },
  ];
  const result = await stripeOverview(admin, { section: "conflicts" });
  expect(result.warning).toBeTruthy();
  expect(result.rows[0].reviewId).toBe("review");
});
it.each(["parent", "staff", undefined])(
  "rejects %s before DB access and rejects forged/expired acknowledgements",
  async (role) => {
    await expect(
      stripeOverview({ role } as any, { section: "conflicts" }),
    ).rejects.toThrow();
    await expect(
      decideStripeNotice({ role } as any, { token: "forged", state: "done" }),
    ).rejects.toThrow();
    expect(m.reads).toEqual([]);
    expect(m.billing).not.toHaveBeenCalled();
  },
);
it("rejects tampering, expired tokens and failed writes without marking a notice done", async () => {
  const page = await stripeOverview(admin, { section: "conflicts" }),
    token = page.rows[0].token;
  await expect(
    decideStripeNotice(admin, { token: token + "x", state: "done" }),
  ).rejects.toThrow("Ungültige");
  m.failWrite = true;
  await expect(
    decideStripeNotice(admin, { token, state: "done" }),
  ).rejects.toThrow("nicht gespeichert");
  expect(m.tables.stripe_notice_decisions).toBeUndefined();
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 25 * 3600000);
  await expect(
    decideStripeNotice(admin, { token, state: "done" }),
  ).rejects.toThrow("abgelaufen");
  vi.useRealTimers();
  expect(
    recentStripeNotice(new Date(now - STRIPE_NOTICE_MONTH).toISOString(), now),
  ).toBe(true);
  expect(
    recentStripeNotice(
      new Date(now - STRIPE_NOTICE_MONTH - 1).toISOString(),
      now,
    ),
  ).toBe(false);
});
it("installs isolated acknowledgement storage with RLS, service-only access, unique revisions and actor retention", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);",
    );
    await db.exec(
      readFileSync("supabase/release/030-stripe-notice-decisions.sql", "utf8"),
    );
    const row = ["billing", "sub_test", "a".repeat(64), "done"];
    await db.query("insert into auth.users values($1)", [admin.user.id]);
    await db.query(
      "insert into stripe_notice_decisions(kind,entity_id,fingerprint,state,actor_id)values($1,$2,$3,$4,$5)",
      [...row, admin.user.id],
    );
    await expect(
      db.query(
        "insert into stripe_notice_decisions(kind,entity_id,fingerprint,state)values($1,$2,$3,$4)",
        row,
      ),
    ).rejects.toThrow("duplicate");
    await db.query("delete from auth.users where id=$1", [admin.user.id]);
    expect(
      (await db.query("select actor_id from stripe_notice_decisions")).rows,
    ).toEqual([{ actor_id: null }]);
    await db.exec("set role authenticated");
    await expect(
      db.query("select * from stripe_notice_decisions"),
    ).rejects.toThrow("permission denied");
    await db.exec("reset role");
    await db.exec("set role anon");
    await expect(
      db.query("delete from stripe_notice_decisions"),
    ).rejects.toThrow("permission denied");
    await db.exec("reset role");
    await db.exec("set role service_role");
    expect(
      (await db.query("select * from stripe_notice_decisions")).rows,
    ).toHaveLength(1);
  } finally {
    await db.close();
  }
});
