import { describe, it, expect } from "vitest";
import {
  calculateAutoAttendanceAt as auto,
  localToUtc as utc,
  attendanceStats,
  stampSlots,
  periodFromStripe,
  periodLabel,
  reportDueAt,
  LEGACY_PLAN_UNITS,
  remainingActiveMinutes,
  durationMinutes,
} from "../src/lib/domain";
describe("12 aktive Stunden, Nachtpause und Mitternachtskonvention", () => {
  it.each([
    ["10:00", "2026-09-09", "22:00"],
    ["12:00", "2026-09-10", "06:00"],
    ["18:00", "2026-09-10", "12:00"],
    ["20:00", "2026-09-10", "14:00"],
    ["23:00", "2026-09-10", "17:00"],
    ["00:00", "2026-09-09", "18:00"],
    ["00:30", "2026-09-09", "18:00"],
    ["04:00", "2026-09-09", "18:00"],
    ["06:00", "2026-09-09", "18:00"],
  ])("%s -> %s %s", (end, day, time) =>
    expect(new Date(auto(utc("2026-09-09", end))).toISOString()).toBe(
      new Date(utc(day, time)).toISOString(),
    ),
  );
  it.each([
    ["2026-03-28", "2026-03-29"],
    ["2026-10-24", "2026-10-25"],
  ])("DST Nacht %s", (day, next) =>
    expect(new Date(auto(utc(day, "20:00"))).toISOString()).toBe(
      new Date(utc(next, "14:00")).toISOString(),
    ),
  );
  it("rejects ambiguous local times", () =>
    expect(() => utc("2026-10-25", "02:30")).toThrow());
  it("rejects missing local times", () =>
    expect(() => utc("2026-03-29", "02:30")).toThrow());
  it("uses explicit timezone independent of machine", () =>
    expect(auto("2026-09-09T10:00:00Z", "UTC")).toBe("2026-09-09T22:00:00Z"));
  it("counts active minutes only", () =>
    expect(
      remainingActiveMinutes(
        utc("2026-09-09", "23:00"),
        utc("2026-09-10", "07:00"),
      ),
    ).toBe(120));
});
it("preserves stripe half-open periods without 30 day arithmetic", () => {
  const p = periodFromStripe(
    Date.parse(utc("2026-09-12", "00:00")) / 1000,
    Date.parse(utc("2026-10-12", "00:00")) / 1000,
  );
  expect(periodLabel(p.starts_at, p.ends_at)).toBe("12.09.2026 – 11.10.2026");
  expect(() => periodFromStripe(2, 1)).toThrow();
});
it("counts absences as units but never as attended minutes", () => {
  const rows = [
    "attended_auto",
    "attended_manual",
    "planned",
    "excused",
    "absent",
    "cancelled",
  ].map((status) => ({
    status: status as "planned",
    starts_at: utc("2026-09-09", "16:30"),
    ends_at: utc("2026-09-09", "18:00"),
  }));
  expect(attendanceStats(rows)).toEqual({
    completed: 4,
    charged: 2,
    planned: 1,
    minutes: 180,
    neutral: 1,
  });
  expect(stampSlots(4, 2, 1)).toEqual(["done", "done", "planned", "open"]);
  expect(stampSlots(6, 4, 1, 2)).toEqual([
    "done",
    "done",
    "charged",
    "charged",
    "planned",
    "open",
  ]);
  expect(LEGACY_PLAN_UNITS).toEqual({
    FirstTouch: 4,
    GameChanger: 8,
    "Pro-Player": 10,
  });
});
it("report at Berlin 08:00 even when buffer pending", () => {
  expect(reportDueAt(utc("2026-10-25", "00:00"))).toBe("2026-10-25T07:00:00Z");
  expect(reportDueAt(utc("2026-09-12", "12:00"))).toBe(
    utc("2026-09-12", "12:00"),
  );
});
it("duration crossing midnight uses actual UTC elapsed time", () =>
  expect(
    durationMinutes(utc("2026-09-09", "23:30"), utc("2026-09-10", "01:00")),
  ).toBe(90));
