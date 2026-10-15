import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportActiveMonths } from "../src/lib/player-export";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  session: vi.fn(),
  load: vi.fn(),
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ rpc: mocks.rpc }),
}));
vi.mock("../src/lib/server/supabase", () => ({ sessionUser: mocks.session }));
vi.mock("../src/lib/server/player-export", () => ({
  loadPlayerExport: mocks.load,
}));
import { GET as feed } from "../src/app/api/public/players/[token]/route";
import { GET, POST } from "../src/app/api/admin/player-api-link/route";
const period = (start: string, end: string, status = "active") => ({
  player_id: "child",
  starts_at: start,
  ends_at: end,
  status,
  product_name: "Abo",
});
const now = "2026-12-31T00:00:00Z";
describe("active export months", () => {
  it("counts 9 days as zero, 10 as one, and full months plus ten days", () => {
    expect(
      exportActiveMonths(
        [period("2026-01-01T00:00Z", "2026-01-10T00:00Z")],
        now,
      ),
    ).toBe(0);
    expect(
      exportActiveMonths(
        [period("2026-01-01T00:00Z", "2026-01-11T00:00Z")],
        now,
      ),
    ).toBe(1);
    expect(
      exportActiveMonths(
        [period("2026-01-14T00:00Z", "2026-02-23T00:00Z")],
        now,
      ),
    ).toBe(1);
    expect(
      exportActiveMonths(
        [period("2026-01-14T00:00Z", "2026-02-24T00:00Z")],
        now,
      ),
    ).toBe(2);
  });
  it("excludes future time and inactive gaps; merges overlapping subscriptions", () => {
    const p = period("2026-01-01T00:00Z", "2026-03-01T00:00Z");
    expect(exportActiveMonths([p, p], "2026-01-10T00:00Z")).toBe(0);
    expect(exportActiveMonths([p, p], now)).toBe(2);
    expect(
      exportActiveMonths(
        [
          period("2026-01-01T00:00Z", "2026-01-10T00:00Z"),
          period("2026-02-01T00:00Z", "2026-02-10T00:00Z"),
          period("2026-03-01T00:00Z", "2026-09-01T00:00Z", "paused"),
        ],
        now,
      ),
    ).toBe(0);
  });
  it("uses Berlin calendar days over DST and month-end anniversaries", () => {
    expect(
      exportActiveMonths(
        [period("2026-03-24T00:00:00+01:00", "2026-04-03T00:00:00+02:00")],
        now,
      ),
    ).toBe(1);
    expect(
      exportActiveMonths(
        [period("2026-01-31T00:00Z", "2026-02-28T00:00Z")],
        now,
      ),
    ).toBe(1);
  });
});
const token = "a".repeat(64);
const context = { params: Promise.resolve({ token }) };
const request = (action = "create", origin = "https://portal.example.com") =>
  new Request("https://portal.example.com/api/admin/player-api-link", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  process.env.APP_URL = "https://portal.example.com";
});
describe("access and dynamic delivery", () => {
  it.each([null, "parent", "staff"])(
    "blocks management for %s",
    async (role) => {
      mocks.session.mockResolvedValue(role ? { role } : null);
      expect((await POST(request())).status).toBe(role ? 403 : 401);
      expect(
        (await GET(new Request("https://portal.example.com"))).status,
      ).toBe(role ? 403 : 401);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("requires origin and routes admin mutations to the protected RPC", async () => {
    mocks.session.mockResolvedValue({ role: "admin", db: { rpc: mocks.rpc } });
    expect((await POST(request("rotate", "https://evil.example"))).status).toBe(
      403,
    );
    mocks.rpc.mockResolvedValue({
      data: { enabled: true, token },
      error: null,
    });
    expect((await (await POST(request("rotate"))).json()).url).toContain(token);
    expect(mocks.rpc).toHaveBeenCalledWith("manage_player_api_share", {
      action: "rotate",
      candidate: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });
  it("does not load any players for invalid or disabled tokens", async () => {
    expect(
      (
        await feed(new Request("https://example.com"), {
          params: Promise.resolve({ token: "bad" }),
        })
      ).status,
    ).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: false });
    expect(
      (await feed(new Request("https://example.com"), context)).status,
    ).toBe(404);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("loads fresh data on every call, disables caching and rechecks revocation", async () => {
    mocks.rpc.mockResolvedValue({ data: true });
    mocks.load
      .mockResolvedValueOnce([{ spielername: "Alt" }])
      .mockResolvedValueOnce([{ spielername: "Neu" }]);
    const first = await feed(new Request("https://example.com"), context);
    expect(first.headers.get("Cache-Control")).toContain("no-store");
    expect((await first.json()).spieler[0].spielername).toBe("Alt");
    expect(
      (await (await feed(new Request("https://example.com"), context)).json())
        .spieler[0].spielername,
    ).toBe("Neu");
    mocks.rpc
      .mockResolvedValueOnce({ data: true })
      .mockResolvedValueOnce({ data: false });
    expect(
      (await feed(new Request("https://example.com"), context)).status,
    ).toBe(404);
  });
  it("returns generic failures without exposing tokens or personal data", async () => {
    mocks.rpc.mockRejectedValue(new Error(token));
    const r = await feed(new Request("https://example.com"), context);
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain(token);
  });
});
