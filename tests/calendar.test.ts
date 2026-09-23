import { expect, it } from "vitest";
import { readAll } from "../src/lib/server/read-all";
import {
  addDays,
  addMonths,
  calendarDate,
  monthDays,
  weekStart,
} from "../src/lib/calendar";

it("groups late-night UTC events by the Berlin day, including DST boundaries", () => {
  expect(calendarDate("2026-09-30T22:30:00Z")).toBe("2026-10-01");
  expect(calendarDate("2026-03-28T23:30:00Z")).toBe("2026-03-29");
  expect(calendarDate("2026-03-29T22:30:00Z")).toBe("2026-03-30");
  expect(calendarDate("2026-10-25T22:30:00Z")).toBe("2026-10-25");
  expect(calendarDate("2026-10-25T23:30:00Z")).toBe("2026-10-26");
});

it("navigates month pairs across year and leap-year boundaries without skipping February", () => {
  expect(addMonths("2026-12-31", 1)).toBe("2027-01-01");
  expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
  expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
  expect(monthDays("2028-02-01").filter(Boolean)).toHaveLength(29);
  expect(monthDays("2026-02-01").filter(Boolean)).toHaveLength(28);
  expect(monthDays("2026-03-01")[6]).toBe("2026-03-01");
  expect(monthDays("2026-03-01")).toContain("2026-03-31");
});

it("keeps Monday-based weeks and calendar-day navigation stable during clock changes", () => {
  expect(weekStart("2026-03-29")).toBe("2026-03-23");
  expect(weekStart("2026-03-30")).toBe("2026-03-30");
  expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
  expect(addDays("2026-10-25", 7)).toBe("2026-11-01");
});

it("loads training lists beyond the database row limit without missing or duplicate events", async () => {
  const rows = Array.from({ length: 1007 }, (_, i) => ({
    id: String(i).padStart(5, "0"),
  }));
  const cursors: (string | undefined)[] = [];
  const db = {
    from: () => {
      let after: string | undefined;
      const query: any = {
        order: () => query,
        select: () => query,
        limit: () => query,
        gt: (_column: string, value: string) => {
          after = value;
          return query;
        },
        then: (resolve: any, reject: any) => {
          cursors.push(after);
          return Promise.resolve({
            data: rows.filter((row) => !after || row.id > after).slice(0, 500),
            error: null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const result = await readAll(db as any, "training_events", "*");
  expect(result).toEqual(rows);
  expect(cursors).toEqual([undefined, "00499", "00999"]);
});

it("places cancelled appointments last even when active appointments start later", async () => {
  const { compareTrainings } = await import("../src/lib/calendar");
  const events = [
    { status: "cancelled", starts_at: "2026-09-23T06:00:00Z" },
    { status: "scheduled", starts_at: "2026-09-24T18:00:00Z" },
    { status: "cancelled", starts_at: "2026-09-23T05:00:00Z" },
    { status: "scheduled", starts_at: "2026-09-23T12:00:00Z" },
  ];
  expect([...events].sort(compareTrainings)).toEqual([
    events[3],
    events[1],
    events[2],
    events[0],
  ]);
});

it("explains future confirmation, counts down only after the end and hides cancelled hints", async () => {
  const { confirmationHint } = await import("../src/lib/calendar");
  const event = {
    status: "scheduled",
    ends_at: "2026-09-23T16:00:00Z",
    auto_attendance_at: "2026-09-24T10:00:00Z",
  };
  const future = confirmationHint(event, "2026-09-23T10:00:00Z");
  expect(future).toContain("24.09.2026 um 12:00 Uhr");
  expect(future).toContain("nach Trainingsende");
  expect(future).not.toContain("Puffer-Minuten");
  expect(confirmationHint(event, "2026-09-23T16:00:00Z")).toContain(
    "Noch 720 aktive Puffer-Minuten",
  );
  expect(confirmationHint(event, "2026-09-23T23:00:00Z")).toContain(
    "Noch 360 aktive Puffer-Minuten",
  );
  expect(confirmationHint(event, "2026-09-24T10:00:00Z")).toContain(
    "nächsten automatischen Prüflauf",
  );
  expect(
    confirmationHint({ ...event, status: "cancelled" }, "2026-09-23T10:00:00Z"),
  ).toBeNull();
  expect(
    confirmationHint({ ...event, status: "cancelled" }, "2026-09-24T10:00:00Z"),
  ).toBeNull();
});
