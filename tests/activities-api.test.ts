import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rows: [] as any[], queries: [] as any[] }));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: () => {
      const filters: ((row: any) => boolean)[] = [],
        record: any = {};
      mock.queries.push(record);
      let cap = 1000,
        count = false;
      const q: any = {
        select: (_s: string, options?: any) => {
          count = !!options?.head;
          return q;
        },
        gt: (k: string, v: string) => {
          filters.push((r) => r[k] > v);
          return q;
        },
        lte: (k: string, v: string) => {
          filters.push((r) => r[k] <= v);
          return q;
        },
        eq: (k: string, v: any) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        order: () => q,
        limit: (n: number) => {
          cap = n;
          return q;
        },
        or: (value: string) => {
          record.cursor = value;
          return q;
        },
        then: (resolve: any) => {
          const rows = mock.rows.filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({
            data: count ? null : rows.slice(0, cap),
            count: rows.length,
            error: null,
          }).then(resolve);
        },
      };
      return q;
    },
  }),
}));
import { activityList, activitySummary } from "../src/lib/server/activities";
const now = "2026-10-17T12:00:00.000Z";
const row = (id: number, hours: number, open = false) => ({
  id: `a:00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  occurred_at: new Date(Date.parse(now) - hours * 3600000).toISOString(),
  kind: "review",
  details: { status: "pending" },
  subject: "Kind",
  actor: "Automatisch",
  is_open: open,
});
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  mock.queries = [];
  mock.rows = [
    row(1, 0),
    row(2, 23),
    row(3, 24),
    row(4, 48),
    row(5, 72),
    row(6, 100, true),
  ];
});
it("uses non-overlapping 24-hour windows and preserves old unresolved issues", async () => {
  const session = { role: "staff" } as any;
  const a = await activityList(session, { window: "0", asOf: now }),
    b = await activityList(session, { window: "1", asOf: now }),
    c = await activityList(session, { window: "2", asOf: now });
  expect(a.rows).toHaveLength(2);
  expect(b.rows).toHaveLength(1);
  expect(c.rows).toHaveLength(1);
  expect(new Set([...a.rows, ...b.rows, ...c.rows].map((r) => r.id)).size).toBe(
    4,
  );
  const issues = await activityList(session, { window: "issues", asOf: now });
  expect(issues.rows).toHaveLength(1);
  expect(issues.rows[0].help).toBeUndefined();
  const admin = await activityList({ role: "admin" } as any, {
    window: "issues",
    asOf: now,
  });
  expect(admin.rows[0].help).toBeDefined();
});
it("bounds pages and returns a worker-independent continuation", async () => {
  mock.rows = Array.from({ length: 55 }, (_, i) => row(i, 1));
  const first = await activityList({ role: "staff" } as any, {
    window: "all",
    asOf: now,
  });
  expect(first.rows).toHaveLength(50);
  expect(first.total).toBe(55);
  expect(first.next).toBeTruthy();
  await activityList({ role: "staff" } as any, {
    window: "all",
    asOf: now,
    cursor: first.next,
  });
  expect(mock.queries.some((q) => q.cursor?.includes(first.rows[49].id))).toBe(
    true,
  );
});
