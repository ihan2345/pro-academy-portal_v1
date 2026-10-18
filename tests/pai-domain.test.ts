import { expect, it } from "vitest";
import {
  allowance,
  berlinWindow,
  defaultConfig,
  planGroup,
  configSchema,
} from "../src/lib/pai/domain";
const matrix = [
  [2, 3, 3, 3],
  [3, 4, 5, 5],
  [4, 5, 7, 7],
  [5, 7, 10, 10],
  [6, 9, 12, 12],
];
for (const [r, months] of [0, 3, 6, 10, 16].entries())
  for (const [c, plan] of (
    ["firsttouch", "gamechanger", "pro", "nextlevel"] as const
  ).entries())
    it(`matrix ${months} months ${plan}`, () =>
      expect(allowance("parent", months, [plan], defaultConfig).standard).toBe(
        matrix[r][c],
      ));
it("uses the highest active factor, monthly fallback for absent or ambiguous mappings", () => {
  expect(
    allowance("parent", 6, ["firsttouch", "gamechanger"], defaultConfig)
      .standard,
  ).toBe(5);
  for (const groups of [[], [null], ["pro", null]] as any[])
    expect(allowance("parent", 16, groups, defaultConfig)).toMatchObject({
      kind: "month",
      standard: 10,
    });
  expect(planGroup("untrusted pro plus")).toBeNull();
  expect(planGroup("Pro-Player")).toBe("pro");
});
it("uses central configured integer factors without float rounding artefacts", () => {
  const c = structuredClone(defaultConfig);
  c.factors.gamechanger = 70;
  c.bases.gold = 10;
  expect(allowance("parent", 10, ["gamechanger"], c).standard).toBe(7);
  expect(allowance("staff", 0, [], c).standard).toBe(10);
  expect(allowance("admin", 0, [], c).standard).toBe(15);
  expect(configSchema.safeParse({ ...c, budgetUsd: -1 }).success).toBe(false);
});
it("resets at Berlin midnight on 23/25-hour DST days and month boundaries", () => {
  for (const [now, hours] of [
    ["2026-03-29T12:00:00Z", 23],
    ["2026-10-25T12:00:00Z", 25],
  ] as const) {
    const w = berlinWindow("day", now);
    expect((Date.parse(w.reset) - Date.parse(w.start)) / 3600000).toBe(hours);
  }
  expect(berlinWindow("month", "2026-10-17T12:00:00Z")).toEqual({
    start: "2026-09-30T22:00:00Z",
    reset: "2026-10-31T23:00:00Z",
  });
});
