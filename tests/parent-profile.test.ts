import { describe, it, expect } from "vitest";
import {
  familyStatus,
  membershipMonths,
  subscriptionMonths,
  trainingStats,
  profileCalendar,
  unitPreview,
  childAge,
  type ProfileUnit,
  type ProfilePeriod,
} from "../src/lib/parent-profile";
const period = (
  start: string,
  end: string,
  status = "active",
): ProfilePeriod => ({
  player_id: "a",
  starts_at: start + "T10:00:00Z",
  ends_at: end + "T10:00:00Z",
  status,
  product_name: "Abo",
});
const unit = (changes: Partial<ProfileUnit> = {}): ProfileUnit => ({
  id: "one",
  player_id: "a",
  child_name: "A",
  title: "Training",
  event_type: "Training",
  starts_at: "2026-10-01T10:00:00Z",
  ends_at: "2026-10-01T11:00:00Z",
  day: "2026-10-01",
  status: "attended_manual",
  cancelled: false,
  minutes: 60,
  retrospective: false,
  location: "",
  ...changes,
});
describe("family status", () => {
  it.each([
    [0, "starter"],
    [2, "starter"],
    [3, "bronze"],
    [5, "bronze"],
    [6, "silver"],
    [9, "silver"],
    [10, "gold"],
    [15, "gold"],
    [16, "ultimate"],
    [18, "ultimate"],
  ])("%s completed months => %s", (n, t) =>
    expect(familyStatus(Number(n)).tier).toBe(t),
  );
  it("does not invent another level after ultimate", () =>
    expect(familyStatus(30)).toMatchObject({
      remaining: 0,
      progress: 100,
      tier: "ultimate",
    }));
  it("adds separate children's months and excludes advance annual coverage", () => {
    const a = subscriptionMonths(
      [period("2026-06-01", "2027-06-01")],
      "2026-10-01T10:00:00Z",
    );
    const b = subscriptionMonths(
      [period("2026-02-01", "2027-02-01")],
      "2026-10-01T10:00:00Z",
    );
    expect(a).toBe(4);
    expect(b).toBe(8);
    expect(familyStatus(a + b)).toMatchObject({ tier: "gold", remaining: 4 });
  });
  it("merges overlapping items and excludes trial/void periods", () =>
    expect(
      subscriptionMonths(
        [
          period("2026-06-01", "2026-08-01"),
          period("2026-07-01", "2026-10-01"),
          period("2026-01-01", "2026-06-01", "trialing"),
          period("2025-01-01", "2026-01-01", "void"),
        ],
        "2026-10-08T10:00:00Z",
      ),
    ).toBe(4));
  it("handles calendar month ends, partial months and gaps", () => {
    expect(
      subscriptionMonths(
        [period("2026-01-31", "2026-02-28")],
        "2026-03-01T10:00:00Z",
      ),
    ).toBe(1);
    expect(
      subscriptionMonths(
        [
          period("2026-01-01", "2026-01-20"),
          period("2026-02-01", "2026-02-20"),
        ],
        "2026-03-01T10:00:00Z",
      ),
    ).toBe(0);
  });
});
it("counts attendance, not charged absence; undated backfills only count in all time", () => {
  const rows = [
    unit(),
    unit({ id: "auto", status: "attended_auto", minutes: 90 }),
    unit({ id: "absent", status: "absent" }),
    unit({ id: "cancel", cancelled: true }),
    unit({ id: "old", day: "2026-09-20" }),
    unit({
      id: "back",
      retrospective: true,
      starts_at: null,
      day: null,
      minutes: 30,
    }),
  ];
  expect(trainingStats(rows, "2026-10-01")).toEqual({
    month: { count: 2, minutes: 150 },
    all: { count: 4, minutes: 240 },
  });
});
it("marks attended and future planned units, not pending past confirmations", () => {
  expect(
    profileCalendar(
      [
        unit(),
        unit({
          id: "future",
          day: "2026-10-15",
          starts_at: "2026-10-15T10:00:00Z",
          status: "planned",
        }),
        unit({ id: "pending", day: "2026-10-02", status: "planned" }),
      ],
      "2026-10-01",
      "2026-10-08T10:00:00Z",
    ),
  ).toEqual({
    "2026-10-01": { attended: 1, planned: 0 },
    "2026-10-15": { attended: 0, planned: 1 },
  });
});
it("limits preview to five, future first", () => {
  const rows = Array.from({ length: 7 }, (_, i) => unit({ id: String(i) }));
  rows.push(
    unit({ id: "next", status: "planned", starts_at: "2026-10-20T10:00:00Z" }),
  );
  const preview = unitPreview(rows, "2026-10-08T10:00:00Z");
  expect(preview).toHaveLength(5);
  expect(preview[0].id).toBe("next");
});
it("does not invent precise age from year or dated observations", () => {
  expect(childAge({ birth_year: 2015 }, "2026-10-08")).toBe("Jahrgang 2015");
  expect(childAge({ camp_birth_date: "2015-10-09" }, "2026-10-08")).toBe(
    "10 Jahre",
  );
  expect(
    childAge(
      { camp_age_at_booking: 10, camp_age_recorded_on: "2025-09-01" },
      "2026-10-08",
    ),
  ).toContain("bei Buchung");
});

it("counts elapsed membership once per child from the earliest Stripe start, including gaps", () => {
  expect(
    membershipMonths(
      ["2025-07-20T10:00:00Z", "2026-08-20T10:00:00Z", "2025-07-20T10:00:00Z"],
      "2026-10-19T10:00:00Z",
    ),
  ).toEqual({ since: "2025-07-20T10:00:00Z", months: 14 });
  expect(
    membershipMonths(
      ["invalid", "2027-01-01T10:00:00Z"],
      "2026-10-19T10:00:00Z",
    ),
  ).toEqual({ since: null, months: 0 });
});

it.each([
  [2, "Bronze", 1, 3],
  [5, "Silber", 1, 6],
  [9, "Gold", 1, 10],
  [15, "Ultimativ", 1, 16],
])(
  "shows the next threshold at %s months",
  (months, next, remaining, target) => {
    expect(familyStatus(Number(months))).toMatchObject({
      next,
      remaining,
      target,
    });
  },
);
