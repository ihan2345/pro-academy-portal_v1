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
