import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("../src/lib/server/supabase", () => ({
  sessionUser: mocks.session,
  sessionDb: vi.fn(),
  serviceDb: vi.fn(),
}));
import { POST } from "../src/app/api/[...path]/route";
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  process.env.APP_URL = "https://portal.example.org";
  mocks.rpc.mockResolvedValue({ data: { queued: 2, blocked: 0 }, error: null });
});
function session(role: string | null) {
  mocks.session.mockResolvedValue(
    role ? { role, user: { id }, db: { rpc: mocks.rpc } } : null,
  );
}
function request(
  body: unknown = {
    id,
    selections: [{ parent_id: id, player_id: id, kind: "planning" }],
  },
  origin = "https://portal.example.org",
) {
  return POST(
    new NextRequest("https://portal.example.org/api/team/notify-parents", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: ["team", "notify-parents"] }) },
  );
}
it.each(["admin", "staff"])(
  "allows %s to request the server-controlled manual notice",
  async (role) => {
    session(role);
    const r = await request();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, queued: 2, blocked: 0 });
    expect(mocks.rpc).toHaveBeenCalledWith("submit_training_notifications", {
      event: id,
      selections: [{ parent_id: id, player_id: id, kind: "planning" }],
    });
  },
);
it.each([null, "parent"])("rejects %s", async (role) => {
  session(role);
  expect((await request()).status).toBe(role ? 403 : 401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("requires same origin and rejects arbitrary recipient/override fields", async () => {
  session("admin");
  expect((await request({ id }, "https://other.example.org")).status).toBe(403);
  expect(
    (await request({ id, recipient: "other@example.org", manual: true }))
      .status,
  ).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("requires explicit selections; accepts no blanket-send request", async () => {
  session("admin");
  expect((await request({ id })).status).toBe(400);
  expect((await request({ id, selections: [] })).status).toBe(400);
  expect(
    (
      await request({
        id,
        selections: [{ parent_id: id, player_id: id, kind: "report" }],
      })
    ).status,
  ).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([
  [
    "notification-options",
    "training_notification_options",
    { id },
    { event: id },
  ],
  [
    "confirm-all-attendance",
    "confirm_planned_training_attendance",
    { id, confirmed: true },
    { event: id, confirmed: true },
  ],
])("routes %s to its protected RPC", async (path, rpc, body, args) => {
  session("staff");
  const response = await POST(
    new NextRequest(`https://portal.example.org/api/team/${path}`, {
      method: "POST",
      headers: {
        Origin: "https://portal.example.org",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: ["team", String(path)] }) },
  );
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith(rpc, args);
});
it("requires an explicit true acknowledgement for bulk attendance", async () => {
  session("admin");
  const response = await POST(
    new NextRequest(
      "https://portal.example.org/api/team/confirm-all-attendance",
      {
        method: "POST",
        headers: {
          Origin: "https://portal.example.org",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, confirmed: false }),
      },
    ),
    { params: Promise.resolve({ path: ["team", "confirm-all-attendance"] }) },
  );
  expect(response.status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("allows a team-only confirmation with many addresses and no parent selection", async () => {
  session("admin");
  const emails = Array.from({ length: 150 }, (_, i) => `coach${i}@example.org`);
  expect(
    (await request({ id, selections: [], staff_emails: emails })).status,
  ).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith(
    "submit_training_notifications_with_staff",
    { event: id, selections: [], staff_emails: emails },
  );
});
it("normalizes team recipients, validates email syntax and surfaces the server's recipient rejection", async () => {
  session("staff");
  expect(
    (
      await request({
        id,
        selections: [],
        staff_emails: [" COACH@EXAMPLE.ORG "],
      })
    ).status,
  ).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith(
    "submit_training_notifications_with_staff",
    { event: id, selections: [], staff_emails: ["coach@example.org"] },
  );
  mocks.rpc.mockClear();
  expect(
    (await request({ id, selections: [], staff_emails: ["not an email"] }))
      .status,
  ).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({
    data: null,
    error: {
      code: "22023",
      message:
        "Nur bestätigte aktive Coach-/Admin-Konten sind erlaubt: outsider@example.org",
    },
  });
  const response = await request({
    id,
    selections: [],
    staff_emails: ["outsider@example.org"],
  });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("bestätigte aktive");
});
it.each(["admin", "staff", "parent", null])(
  "protects team address validation for %s",
  async (role) => {
    session(role);
    const response = await POST(
      new NextRequest(
        "https://portal.example.org/api/team/validate-training-staff",
        {
          method: "POST",
          headers: {
            Origin: "https://portal.example.org",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ emails: ["coach@example.org"] }),
        },
      ),
      {
        params: Promise.resolve({ path: ["team", "validate-training-staff"] }),
      },
    );
    expect(response.status).toBe(
      role === "admin" || role === "staff" ? 200 : role ? 403 : 401,
    );
    if (role === "admin" || role === "staff")
      expect(mocks.rpc).toHaveBeenCalledWith(
        "validate_training_staff_recipients",
        { emails: ["coach@example.org"] },
      );
    else expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
