import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ serviceFrom: vi.fn(), stripe: vi.fn() }));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ from: m.serviceFrom }),
}));
vi.mock("../src/lib/server/profile-stripe", () => ({
  profileStripeClient: m.stripe,
}));
import {
  analytics,
  attendanceReport,
  collectRows,
  reportWindow,
  scopedSubscriptions,
} from "../src/lib/server/pai/analytics";
import { billing, summarizeBilling } from "../src/lib/server/pai/billing";
const person = { first_name: "Test", last_name: "Kind" };
function query(data: any[]) {
  const q: any = {};
  for (const key of ["select", "eq", "is", "order", "limit", "gt", "in"])
    q[key] = vi.fn(() => q);
  q.then = (resolve: any) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return q;
}
beforeEach(() => {
  vi.clearAllMocks();
});
it("calculates Berlin calendar boundaries across daylight saving changes", () => {
  const w = reportWindow("2026-10-25", "2026-10-25");
  expect((Date.parse(w.until) - Date.parse(w.from)) / 3600000).toBe(25);
  expect(() => reportWindow("2026-10-26", "2026-10-25")).toThrow();
});
it("separates absences and attendance, excludes removals and cancelled events, adds backfills once", () => {
  const event = {
    starts_at: "2026-10-01T10:00:00Z",
    ends_at: "2026-10-01T11:30:00Z",
    status: "scheduled",
  };
  const row = { player_id: "one", players: person, training_events: event };
  const r = attendanceReport(
    [
      { ...row, status: "attended_manual" },
      { ...row, status: "absent" },
      { ...row, status: "excused" },
      { ...row, status: "attended_auto", removed_from_event: true },
      {
        ...row,
        status: "attended_auto",
        training_events: { ...event, status: "cancelled" },
      },
    ],
    [{ player_id: "one", players: person, duration_minutes: 60 }],
  );
  expect(r[0]).toMatchObject({
    attended: 2,
    absent: 1,
    excused: 1,
    minutes: 150,
  });
});
it("does not silently return incomplete totals at traversal limit", async () => {
  await expect(
    collectRows(() =>
      query(Array.from({ length: 250 }, (_, i) => ({ id: String(i) }))),
    ),
  ).rejects.toThrow("keine Teilsumme");
});
it("blocks parent access to academy trainer/location comparisons", async () => {
  for (const report of ["trainers", "locations"])
    await expect(
      analytics({ role: "parent" } as any, { report, start: null, end: null }),
    ).rejects.toThrow("nur für das Team");
});
it("scopes privileged subscription joins to players visible to the authenticated parent", async () => {
  const service = query([
    {
      id: "link",
      player_id: "own",
      subscriptions: { id: "sub", status: "active" },
    },
  ]);
  m.serviceFrom.mockReturnValue(service);
  const result = await scopedSubscriptions({
    role: "parent",
    db: { from: () => query([{ id: "own", ...person }]) },
  } as any);
  expect(service.in).toHaveBeenCalledWith("player_id", ["own"]);
  expect(result[0].players.first_name).toBe("Test");
});
it("blocks all finance for coaches before accessing data", async () => {
  await expect(
    billing({ role: "staff" } as any, {
      report: "payments",
      start: null,
      end: null,
    }),
  ).rejects.toThrow("nicht freigegeben");
  expect(m.stripe).not.toHaveBeenCalled();
});
it("rejects ambiguous shared Stripe customers before any provider request", async () => {
  m.serviceFrom.mockReturnValue(
    query([{ parent_id: "own" }, { parent_id: "foreign" }]),
  );
  const s: any = {
    role: "parent",
    user: { id: "user" },
    db: {
      from: (table: string) =>
        query(
          table === "parents"
            ? [{ id: "own", full_name: "Self" }]
            : [
                {
                  id: "link",
                  parent_id: "own",
                  stripe_customer_id: "cus_test",
                },
              ],
        ),
    },
  };
  await expect(
    billing(s, { report: "unpaid", start: null, end: null }),
  ).rejects.toThrow("nicht eindeutig");
  expect(m.stripe).not.toHaveBeenCalled();
});
it("reports collected amounts and refunds separately by currency", () => {
  const charge = {
    paid: true,
    captured: true,
    status: "succeeded",
    currency: "eur",
    amount_captured: 10000,
    amount_refunded: 2500,
  };
  const result: any = summarizeBilling(
    "payments",
    [
      charge,
      { ...charge, paid: false },
      { ...charge, currency: "usd", amount_refunded: 0 },
    ],
    reportWindow("2026-10-01", "2026-10-31"),
    () => "Family",
  );
  expect(result.currencies.eur).toMatchObject({
    capturedMinor: 10000,
    refundedMinor: 2500,
    netMinor: 7500,
  });
  expect(result.currencies.usd.netMinor).toBe(10000);
});
it("does not confuse renewing periods with subscription termination", () => {
  const ends = Date.parse("2026-10-20T10:00:00Z") / 1000;
  const sub = {
    customer: "one",
    status: "active",
    items: { data: [{ current_period_end: ends }], has_more: false },
  };
  const result: any = summarizeBilling(
    "ending_subscriptions",
    [sub, { ...sub, cancel_at_period_end: true }],
    reportWindow("2026-10-01", "2026-10-31"),
    () => "Family",
  );
  expect(result.total).toBe(1);
});
it("cannot cross the local boundary to fetch real billing data", async () => {
  const previous = process.env.APP_MODE;
  process.env.APP_MODE = "local";
  try {
    m.serviceFrom.mockReturnValue(query([{ parent_id: "own" }]));
    const s: any = {
      role: "parent",
      user: { id: "user" },
      db: {
        from: (table: string) =>
          query(
            table === "parents"
              ? [{ id: "own", full_name: "Self" }]
              : [
                  {
                    id: "link",
                    parent_id: "own",
                    stripe_customer_id: "cus_test",
                  },
                ],
          ),
      },
    };
    const result: any = await billing(s, {
      report: "payments",
      start: null,
      end: null,
    });
    expect(result.available).toBe(false);
    expect(m.stripe).not.toHaveBeenCalled();
  } finally {
    if (previous === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previous;
  }
});
it("open invoices have complete currency totals even when the displayed list is limited", () => {
  const invoices = Array.from({ length: 35 }, (_, i) => ({
    customer: "one",
    number: `I${i}`,
    currency: "eur",
    amount_remaining: 1000,
    due_date: null,
  }));
  const result: any = summarizeBilling(
    "unpaid",
    invoices,
    reportWindow(null, null),
    () => "Family",
  );
  expect(result.totalsMinor.eur).toBe(35000);
  expect(result.totalOpenInvoices).toBe(35);
  expect(result.invoices).toHaveLength(30);
  expect(result.more).toBe(true);
  expect(result.invoices[0].overdue).toBe(false);
});
