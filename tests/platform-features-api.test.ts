import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("../src/lib/server/supabase", () => ({ sessionUser: m.session }));
import { GET, POST } from "../src/app/api/platform/features/route";
const url = "https://portal.proacademy-ak.com/api/platform/features";
const request = (body: unknown, origin = "https://portal.proacademy-ak.com") =>
  new Request(url, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", "https://portal.proacademy-ak.com");
  m.session.mockResolvedValue({
    role: "admin",
    db: { rpc: m.rpc, from: m.from },
  });
  m.rpc.mockResolvedValue({ data: true, error: null });
  m.from.mockReturnValue({
    select: () => ({
      order: async () => ({
        data: [{ key: "pai", enabled: false }],
        error: null,
      }),
    }),
  });
});
it("requires a logged-in admin AND manage_features", async () => {
  m.session.mockResolvedValue(null);
  expect((await GET(new Request(url))).status).toBe(401);
  for (const role of ["parent", "staff"]) {
    m.session.mockResolvedValue({ role });
    expect((await GET(new Request(url))).status).toBe(403);
  }
  m.session.mockResolvedValue({ role: "admin", db: { rpc: m.rpc } });
  m.rpc.mockResolvedValue({ data: false });
  expect((await GET(new Request(url))).status).toBe(403);
  expect(m.from).not.toHaveBeenCalled();
});
it("blocks cross-origin writes and validates booleans", async () => {
  expect(
    (
      await POST(
        request(
          { key: "pai", enabled: true, expected: false },
          "https://evil.invalid",
        ),
      )
    ).status,
  ).toBe(403);
  expect(m.session).not.toHaveBeenCalled();
  expect(
    (await POST(request({ key: "pai", enabled: "true", expected: false })))
      .status,
  ).toBe(400);
});
it("uses session RPC, optimistic concurrency and private responses", async () => {
  const r = await POST(request({ key: "pai", enabled: true, expected: false }));
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toContain("no-store");
  expect(m.rpc).toHaveBeenCalledWith("set_platform_feature", {
    feature_key: "pai",
    wanted: true,
    expected: false,
  });
  m.rpc.mockImplementation(async (name) =>
    name === "can_manage_features"
      ? { data: true }
      : { error: { code: "42501" } },
  );
  expect(
    (await POST(request({ key: "pai", enabled: true, expected: false })))
      .status,
  ).toBe(403);
});
