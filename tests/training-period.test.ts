import { expect, it } from "vitest";
import {
  trainingPeriod,
  trainingPlanningEnd,
} from "../src/lib/training-period";
import type { Period } from "../src/lib/types";

const period: Period = {
  id: "current",
  player_id: "player",
  product_name: "FirstTouch",
  starts_at: "2026-09-29T18:17:49+00:00",
  ends_at: "2026-10-29T18:17:49+00:00",
  included_units: 4,
  athletics_units: 0,
  status: "suspended",
  subscription_status: "past_due",
  subscription_id: "subscription",
};
const resolve = (
  periods = [period],
  start = "2026-10-05T14:30:00Z",
  type = "Gruppentraining",
) => trainingPeriod(periods, "player", start, type);

it("explains an existing suspended period with an overdue payment", () => {
  const result = resolve();
  expect(result.period).toEqual(period);
  expect(result.issue).toContain("Leistungszeitraum gesperrt");
  expect(result.issue).toContain("Abo-Zahlung ist überfällig");
});

it.each(["active", "trialing"])(
  "accepts a %s period using its own status",
  (status) => {
    expect(resolve([{ ...period, status }]).issue).toBeUndefined();
  },
);

it("checks the exact start instant and requires confirmation from the original end", () => {
  const active = [{ ...period, status: "active" }];
  expect(resolve(active, "2026-09-29T18:17:48Z").period).toBeUndefined();
  expect(resolve(active, "2026-09-29T20:17:49+02:00").issue).toBeUndefined();
  expect(resolve(active, "2026-10-29T18:17:48Z").issue).toBeUndefined();
  expect(resolve(active, "2026-10-29T18:17:49Z").requiresConfirmation).toBe(
    true,
  );
});

it("allows Levin's final following-day minute, but not the next midnight", () => {
  const active = [
    {
      ...period,
      status: "active",
      starts_at: "2026-09-07T12:40:49Z",
      ends_at: "2026-10-07T12:40:49Z",
      subscription_status: "canceled",
    },
  ];
  expect(
    resolve(active, "2026-10-07T14:40:48+02:00").requiresConfirmation,
  ).toBe(false);
  expect(
    resolve(active, "2026-10-07T14:40:49+02:00").requiresConfirmation,
  ).toBe(true);
  expect(
    resolve(active, "2026-10-08T23:59:59.999+02:00").requiresConfirmation,
  ).toBe(true);
  expect(resolve(active, "2026-10-09T00:00:00+02:00").period).toBeUndefined();
  expect(
    resolve(
      [{ ...active[0], status: "suspended" }],
      "2026-10-08T16:00:00+02:00",
    ).issue,
  ).toContain("gesperrt");
  expect(
    resolve(active, "2026-10-08T16:00:00+02:00", "Athletiktraining").issue,
  ).toContain("Kein Kontingent");
});

it.each([
  ["2026-03-28T12:00:00+01:00", "2026-03-30T00:00:00+02:00"],
  ["2026-10-24T12:00:00+02:00", "2026-10-26T00:00:00+01:00"],
  ["2026-12-31T12:00:00+01:00", "2027-01-02T00:00:00+01:00"],
])("uses calendar days across DST and year boundaries: %s", (end, boundary) => {
  expect(trainingPlanningEnd(end)).toBe(Date.parse(boundary));
});

it("prefers a regular entitlement over a newer overlapping grace period", () => {
  const regular = {
    ...period,
    status: "active",
    id: "regular",
    starts_at: "2026-09-01T00:00:00Z",
  };
  const grace = {
    ...regular,
    id: "grace",
    starts_at: "2026-10-01T00:00:00Z",
    ends_at: "2026-10-05T10:00:00Z",
  };
  expect(resolve([grace, regular]).period?.id).toBe("regular");
  expect(resolve([grace, regular]).requiresConfirmation).toBe(false);
});

it("reports missing discipline entitlement separately from a missing period", () => {
  const result = resolve(
    [{ ...period, status: "active" }],
    undefined,
    "Athletiktraining",
  );
  expect(result.period?.id).toBe(period.id);
  expect(result.issue).toContain("Kein Kontingent für diese Trainingsart");
});

it("chooses the newest eligible period like the database, ignoring ineligible overlaps", () => {
  const older = {
    ...period,
    id: "older",
    starts_at: "2026-09-01T00:00:00Z",
    status: "active",
  };
  const latest = { ...period, id: "latest", status: "active" };
  expect(resolve([older, period, latest]).period?.id).toBe("latest");
  expect(resolve([period, older]).period?.id).toBe("older");
});

it("does not attribute every suspended period to an overdue payment", () => {
  expect(
    resolve([{ ...period, subscription_status: "unpaid" }]).issue,
  ).not.toContain("überfällig");
  expect(resolve([{ ...period, status: "void" }]).issue).toContain("ungültig");
});

it("rejects missing periods, other players and incomplete form input", () => {
  expect(resolve([]).issue).toContain(
    "Kein Leistungszeitraum zum gewählten Trainingsbeginn",
  );
  expect(resolve([{ ...period, player_id: "other" }]).period).toBeUndefined();
  expect(resolve(undefined, "").issue).toContain("gültiges Trainingsdatum");
});
