import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), enabled: vi.fn() }));
vi.mock("../src/lib/server/supabase", () => ({ sessionUser: m.session }));
vi.mock("../src/lib/server/pai/switch", () => ({ paiVisibility: m.enabled }));
import { GET } from "../src/app/api/platform/availability/route";
beforeEach(() => {
  vi.resetAllMocks();
});
it("does not reveal feature availability to unauthenticated visitors", async () => {
  m.session.mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
  expect(m.enabled).not.toHaveBeenCalled();
});
it.each(["parent", "staff", "admin"])(
  "returns only current global visibility for %s",
  async (role) => {
    m.session.mockResolvedValue({ role });
    for (const value of [false, true, false]) {
      m.enabled.mockResolvedValue({ pai: value, mascot: value });
      const r = await GET();
      expect(await r.json()).toEqual({ pai: value, mascot: value });
      expect(r.headers.get("cache-control")).toContain("no-store");
    }
  },
);
it("hides entry points if availability cannot be determined", async () => {
  m.session.mockRejectedValue(Error("offline"));
  const r = await GET();
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ pai: false, mascot: false });
});
