import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("../src/lib/server/supabase", () => ({ sessionUser: mocks.session }));
import { GET, POST } from "../src/app/api/account/email-preference/route";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", "https://portal.example.org");
  mocks.session.mockResolvedValue({ role: "parent", db: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: false, error: null });
});
it("uses the authenticated parent's RPC without accepting a target parent", async () => {
  const res = await POST(
    new Request("https://portal.example.org/api/account/email-preference", {
      method: "POST",
      headers: {
        origin: "https://portal.example.org",
        "content-type": "application/json",
      },
      body: JSON.stringify({ enabled: false, parent_id: "someone-else" }),
    }),
  );
  expect(res.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("set_my_email_preference", {
    wanted: false,
  });
});
it("rejects cross-origin writes and non-parent sessions", async () => {
  const res = await POST(
    new Request("https://portal.example.org/api/account/email-preference", {
      method: "POST",
      headers: { origin: "https://other.example.org" },
      body: '{"enabled":false}',
    }),
  );
  expect(res.ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.session.mockResolvedValue({ role: "staff" });
  expect(
    (
      await GET(
        new Request("https://portal.example.org/api/account/email-preference"),
      )
    ).status,
  ).toBe(403);
});
it("does not interpret unavailable settings as enabled", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
  expect(
    (
      await GET(
        new Request("https://portal.example.org/api/account/email-preference"),
      )
    ).ok,
  ).toBe(false);
});
