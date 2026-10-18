import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  session: vi.fn(),
  enabled: vi.fn(),
  context: vi.fn(),
  history: vi.fn(),
  chat: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../src/lib/server/pai/service", () => ({
  paiSession: m.session,
  enabled: m.enabled,
  context: m.context,
  history: m.history,
  deleteHistory: vi.fn(),
  checked: (r: any) => {
    if (r.error) throw Error();
    return r.data;
  },
}));
vi.mock("../src/lib/server/pai/chat", () => ({ chat: m.chat }));
vi.mock("../src/lib/server/pai/admin", () => ({ adminSummary: vi.fn() }));
import { GET, POST } from "../src/app/api/pai/[...action]/route";
const params = (action: string) => ({
  params: Promise.resolve({ action: action.split("/") }),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", "http://127.0.0.1:3117");
  m.session.mockResolvedValue({
    role: "parent",
    user: { id: "parent" },
    db: { rpc: m.rpc },
  });
  m.enabled.mockResolvedValue(false);
});
it("disabled status avoids context and model calls", async () => {
  const r = await GET(
    new Request("http://127.0.0.1:3117/api/pai/status"),
    params("status"),
  );
  expect(await r.json()).toEqual({ enabled: false });
  expect(m.context).not.toHaveBeenCalled();
  expect(m.chat).not.toHaveBeenCalled();
});
it("blocks parent admin APIs and cross-origin model requests", async () => {
  expect(
    (
      await GET(
        new Request("http://127.0.0.1:3117/api/pai/admin"),
        params("admin"),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await POST(
        new Request("http://127.0.0.1:3117/api/pai/chat", {
          method: "POST",
          headers: { origin: "https://evil.invalid" },
          body: "{}",
        }),
        params("chat"),
      )
    ).status,
  ).toBe(403);
  expect(m.chat).not.toHaveBeenCalled();
});
it("rejects preference target injection instead of allowing another user", async () => {
  const r = await POST(
    new Request("http://127.0.0.1:3117/api/pai/preference", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3117" },
      body: JSON.stringify({ enabled: false, userId: "someone" }),
    }),
    params("preference"),
  );
  expect(r.status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
