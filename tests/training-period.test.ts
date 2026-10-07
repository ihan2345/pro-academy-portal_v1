import { expect, it } from "vitest";
import { trainingPeriod } from "../src/lib/training-period";
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

it("checks the exact start instant across timestamp formats and excludes the end", () => {
  const active = [{ ...period, status: "active" }];
  expect(resolve(active, "2026-09-29T18:17:48Z").period).toBeUndefined();
  expect(resolve(active, "2026-09-29T20:17:49+02:00").issue).toBeUndefined();
  expect(resolve(active, "2026-10-29T18:17:48Z").issue).toBeUndefined();
  expect(resolve(active, "2026-10-29T18:17:49Z").period).toBeUndefined();
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
