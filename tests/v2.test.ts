import { expect, it, vi } from "vitest";
import { filterCustomers, withStripeOrder } from "../src/lib/stripe-customers";
import { readAll } from "../src/lib/server/read-all";
import { backfillEvent } from "../src/lib/backfills";
import {
  attendanceStats,
  disciplineStats,
  stampSlots,
} from "../src/lib/domain";
import { backfillSchema } from "../src/lib/server/schemas";
import { stampCardSnapshot } from "../src/lib/stamp-card";
import { portalFixture } from "./fixtures/portal";

it("combines active subscriptions with search, recency and sorting across all customers", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const rows = Array.from({ length: 227 }, (_, i) => ({
    id: `cus_${i}`,
    name: `Familie ${i}`,
    email: null,
    first_seen_at: new Date(now - i * 86400000).toISOString(),
    assigned: i % 3 === 0,
    has_active_subscription: i % 2 === 0,
    stripe_position: 226 - i,
  }));
  expect(filterCustomers(rows, "", "stripe", false, now, true)).toEqual(
    rows.filter((c) => c.has_active_subscription).reverse(),
  );
  expect(filterCustomers(rows, "", "stripe", false, now, false)).toHaveLength(
    227,
  );
  expect(
    filterCustomers(rows, "Familie 21", "stripe", false, now, true).map(
      (c) => c.id,
    ),
  ).toEqual(["cus_218", "cus_216", "cus_214", "cus_212", "cus_210"]);
  expect(
    filterCustomers(rows, "", "added-asc", true, now, true).map((c) => c.id),
  ).toEqual([
    "cus_14",
    "cus_12",
    "cus_10",
    "cus_8",
    "cus_6",
    "cus_4",
    "cus_2",
    "cus_0",
  ]);
  expect(
    filterCustomers(
      [{ ...rows[0], has_active_subscription: undefined }],
      "",
      "stripe",
      false,
      now,
      true,
    ),
  ).toEqual([]);
});

it("globally sorts and searches customers beyond 10/1000 without omissions", async () => {
  const rows = Array.from({ length: 1027 }, (_, n) => ({
    id: `cus_${String(n).padStart(4, "0")}`,
    name: `Familie ${String(n).padStart(4, "0")}`,
    email: null,
    first_seen_at: new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString(),
    assigned: n % 2 === 0,
  }));
  const pageRead = vi.fn();
  const db = {
    from: () => {
      let after = "";
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        gt: (_key: string, value: string) => {
          after = value;
          return chain;
        },
        then: (resolve: (value: unknown) => unknown) => {
          pageRead(after);
          return Promise.resolve({
            data: rows.filter((r) => r.id > after).slice(0, 500),
            error: null,
          }).then(resolve);
        },
      };
      return chain;
    },
  } as unknown as Parameters<typeof readAll>[0];
  expect(await readAll(db, "stripe_customer_registry", "*")).toEqual(rows);
  expect(pageRead).toHaveBeenCalledTimes(3);
  expect(filterCustomers(rows, "", "name-desc", false)[0].id).toBe("cus_1026");
  expect(filterCustomers(rows, "Familie 1026", "name-asc", false)).toEqual([
    rows[1026],
  ]);
  expect(filterCustomers(rows, "", "added-asc", false)).toEqual(rows);
  expect(filterCustomers(rows, "", "added-desc", false)).toEqual(
    [...rows].reverse(),
  );
});
it("uses first system observation for the 14-day boundary and stable ties", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");
  const rows = [
    "2026-09-09T12:00:00Z",
    "2026-09-09T11:59:59Z",
    "2026-09-23T12:00:00Z",
  ].map((first_seen_at, i) => ({
    id: `cus_${i}`,
    name: "Same",
    email: null,
    first_seen_at,
    assigned: false,
  }));
  expect(
    filterCustomers(rows, "", "added-asc", true, now).map((c) => c.id),
  ).toEqual(["cus_0", "cus_2"]);
  expect(
    filterCustomers([...rows].reverse(), "", "name-desc", false).map(
      (c) => c.id,
    ),
  ).toEqual(["cus_0", "cus_1", "cus_2"]);
});
it("counts one backfill with its explicit minutes, no synthetic duration or private note", () => {
  const event = backfillEvent({
    id: "bf",
    period_id: "period-max",
    player_id: "max",
    title: "Nachgetragen",
    event_type: "Athletiktraining",
    occurred_on: null,
    duration_minutes: 90,
    parent_note: "Öffentliche Notiz",
    created_at: "2026-09-23T12:00:00Z",
    internal_note: "SECRET",
  } as any);
  const stats = attendanceStats([event]);
  expect(stats.completed).toBe(1);
  expect(stats.retrospective).toBe(1);
  expect(stats.minutes).toBe(90);
  expect(disciplineStats([event]).athletics.completed).toBe(1);
  expect(stampSlots(5, 3, 1, 1, 1)).toEqual([
    "done",
    "retrospective",
    "charged",
    "planned",
    "open",
  ]);
  const snapshot = stampCardSnapshot(
    portalFixture.players[0],
    portalFixture.periods[0],
    [event],
    event.starts_at,
    "",
  );
  expect(JSON.stringify(snapshot)).not.toContain("SECRET");
  expect(snapshot.events[0].parent_note).toBe("Öffentliche Notiz");
});
it("requires public note and minutes at the HTTP boundary", () => {
  const valid = {
    request_id: crypto.randomUUID(),
    period_id: crypto.randomUUID(),
    event_type: "Gruppentraining",
    duration_minutes: 60,
    parent_note: "Nachgeholt",
  };
  expect(backfillSchema.parse(valid).notify_parents).toBe(false);
  expect(
    backfillSchema.safeParse({ ...valid, duration_minutes: undefined }).success,
  ).toBe(false);
  expect(
    backfillSchema.safeParse({
      ...valid,
      parent_note: "  ",
      internal_note: "Only private",
    }).success,
  ).toBe(false);
});

it("preserves full Stripe page order and ties independently of portal import dates", () => {
  const rows = Array.from({ length: 1027 }, (_, i) => ({
    id: `cus_${i}`,
    name: `Kunde ${i}`,
    email: null,
    first_seen_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
    assigned: i % 3 === 0,
  }));
  // Same Stripe timestamp: API sequence, not ID/name/import date, is authoritative.
  const stripe = [...rows.slice(500), ...rows.slice(0, 500)].map((row) => ({
    id: row.id,
    created: 1750000000,
  }));
  const ordered = withStripeOrder(rows, stripe);
  expect(
    filterCustomers(ordered, "", "stripe", false).map((c) => c.id),
  ).toEqual(stripe.map((c) => c.id));
  expect(
    filterCustomers(ordered, "", "added-asc", false).map((c) => c.id),
  ).toEqual(rows.map((c) => c.id));
  expect(
    filterCustomers(ordered, "", "added-desc", false).map((c) => c.id),
  ).toEqual([...rows].reverse().map((c) => c.id));
  expect(ordered[0].first_seen_at).toBe(rows[0].first_seen_at);
  const open = filterCustomers(ordered, "", "stripe", false).filter(
    (c) => !c.assigned,
  );
  const displayed = Array.from(
    { length: Math.ceil(open.length / 10) },
    (_, i) => open.slice(i * 10, i * 10 + 10),
  ).flat();
  expect(displayed.map((c) => c.id)).toEqual(
    stripe
      .filter((c) => !rows.find((r) => r.id === c.id)!.assigned)
      .map((c) => c.id),
  );
});

it("keeps historical customers after Stripe results and rejects incomplete registry loads", () => {
  const row = (id: string) => ({
    id,
    name: id,
    email: null,
    first_seen_at: "2026-01-01T00:00:00Z",
    assigned: false,
  });
  const registry = [row("cus_old"), row("cus_new")];
  const stripe = [{ id: "cus_new", created: 1760000000 }];
  const ordered = filterCustomers(
    withStripeOrder(registry, stripe),
    "",
    "stripe",
    false,
  );
  expect(ordered.map((c) => c.id)).toEqual(["cus_new", "cus_old"]);
  expect(ordered[1].stripe_created_at).toBeUndefined();
  expect(() =>
    withStripeOrder(registry, [{ id: "cus_missing", created: 1760000000 }]),
  ).toThrow("unvollständig");
});
