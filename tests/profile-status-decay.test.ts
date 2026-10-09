import { expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import {
  familyMembership,
  familyStatus,
  activeMembership,
  type ProfilePeriod,
} from "../src/lib/parent-profile";
const at = (s: string) =>
  Temporal.PlainDate.from(s)
    .toZonedDateTime({ timeZone: "Europe/Berlin", plainTime: "10:00" })
    .toInstant()
    .toString();
const p = (
  start: string,
  end: string,
  player = "one",
  status = "active",
): ProfilePeriod => ({
  player_id: player,
  product_name: "Abo",
  status,
  starts_at: at(start),
  ends_at: at(end),
});
it("16 active months minus four fully inactive months => 12 and Gold", () => {
  const periods = [p("2025-01-01", "2026-05-01")];
  const result = familyMembership(periods, at("2026-09-01"));
  expect(result).toEqual({ months: 12, earned_months: 16, deducted_months: 4 });
  expect(familyStatus(result.months).tier).toBe("gold");
  expect(activeMembership(periods, at("2026-09-01")).months).toBe(16);
});
it("counts two children separately but deducts family inactivity just once", () => {
  expect(
    familyMembership(
      [p("2025-09-01", "2026-05-01"), p("2025-09-01", "2026-05-01", "two")],
      at("2026-09-01"),
    ),
  ).toEqual({ months: 12, earned_months: 16, deducted_months: 4 });
});
it("does not decay while another child is active or double count parallel subscriptions", () => {
  const a = p("2025-09-01", "2026-05-01");
  expect(
    familyMembership(
      [a, a, p("2026-01-01", "2026-10-01", "two")],
      at("2026-09-01"),
    ),
  ).toEqual({ months: 16, earned_months: 16, deducted_months: 0 });
});
it("retains previous deductions after resuming; future coverage is not credited", () => {
  expect(
    familyMembership(
      [p("2025-01-01", "2026-05-01"), p("2026-09-01", "2027-09-01")],
      at("2026-10-01"),
    ),
  ).toEqual({ months: 13, earned_months: 17, deducted_months: 4 });
});
it("a long break consumes the balance, never creates debt for a later restart", () => {
  expect(
    familyMembership(
      [p("2025-01-01", "2025-03-01"), p("2026-09-01", "2027-09-01")],
      at("2026-10-01"),
    ),
  ).toEqual({ months: 1, earned_months: 3, deducted_months: 2 });
});
it("does not deduct an incomplete inactive month; credits no time before first membership", () => {
  expect(
    familyMembership([p("2025-01-01", "2026-05-01")], at("2026-05-30")).months,
  ).toBe(16);
  expect(familyMembership([], at("2026-10-01"))).toEqual({
    months: 0,
    earned_months: 0,
    deducted_months: 0,
  });
});
it("several complete gaps deduct independently, trials do not keep a family active", () => {
  const result = familyMembership(
    [
      p("2025-01-01", "2025-05-01"),
      p("2025-06-01", "2025-10-01"),
      p("2025-10-01", "2025-12-01", "two", "trialing"),
    ],
    at("2025-12-01"),
  );
  expect(result).toEqual({ months: 5, earned_months: 8, deducted_months: 3 });
});
it("month ends and DST use calendar anniversaries", () => {
  expect(
    familyMembership([p("2025-01-31", "2026-05-31")], at("2026-09-30")).months,
  ).toBe(12);
});
