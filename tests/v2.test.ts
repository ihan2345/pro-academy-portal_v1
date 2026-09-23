import { expect, it, vi } from "vitest";
import { filterCustomers } from "../src/lib/stripe-customers";
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
