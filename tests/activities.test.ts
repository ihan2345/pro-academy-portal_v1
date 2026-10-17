import { describeActivity } from "../src/lib/activities";
import { expect, it, vi } from "vitest";
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => {
    throw Error("Database must not be read");
  },
}));
import { activityList, activitySummary } from "../src/lib/server/activities";
const base = {
  id: "a:00000000-0000-4000-8000-000000000001",
  occurred_at: "2026-10-17T10:00:00Z",
  subject: "Beispielkind",
  actor: "Coach",
  kind: "review",
  details: { status: "pending" },
  is_open: true,
};
it("never sends instructions, raw errors or financial data to coaches", () => {
  const row = {
    ...base,
    details: {
      ...base.details,
      error: "SECRET",
      recipient: "private@example.invalid",
      amount: "999",
    },
    payload: { secret: "SECRET" },
  };
  const staff = describeActivity(row, false),
    admin = describeActivity(row, true);
  expect(staff).not.toHaveProperty("help");
  expect(JSON.stringify(staff)).not.toMatch(
    /SECRET|private@example|999|Aktion erforderlich|Bestätige/,
  );
  expect(admin.help?.href).toBe("/admin");
  expect(admin.help?.text).toContain("bestätige");
});
it("resolved problems have no admin instruction", () => {
  const result = describeActivity(
    { ...base, is_open: false, details: { status: "resolved" } },
    true,
  );
  expect(result.help).toBeUndefined();
  expect(result.tone).toBe("success");
});
it("explains a package change without exposing billing", () => {
  const result = describeActivity(
    {
      ...base,
      kind: "package",
      is_open: false,
      details: { previousProduct: "Pro", product: "FirstTouch", units: "4" },
    },
    false,
  );
  expect(result.title).toBe("Paketwechsel übernommen");
  expect(result.text).toContain("Pro → FirstTouch");
  expect(result.text).toContain("4 Einheiten");
});
it.each(["parent", undefined])(
  "rejects role %s before using service credentials",
  async (role) => {
    const session = { role } as any;
    await expect(activityList(session, {})).rejects.toMatchObject({
      status: role ? 403 : 401,
    });
    await expect(activitySummary(session)).rejects.toMatchObject({
      status: role ? 403 : 401,
    });
  },
);
it("rejects a malformed pagination filter", async () => {
  await expect(
    activityList({ role: "staff" } as any, {
      cursor: Buffer.from(
        JSON.stringify({ at: "x),is_open.eq.true", id: "*" }),
      ).toString("base64url"),
    }),
  ).rejects.toMatchObject({ status: 400 });
});
