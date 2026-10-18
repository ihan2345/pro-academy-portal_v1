import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { paiEnabled } from "../src/lib/server/pai/switch";
const m = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: m.client }));
import { proxy } from "../src/proxy";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it.each([undefined, "false", "aktiv", "TRUE", ""])(
  "fails closed for %s",
  (value) => {
    vi.stubEnv("PAI_ENABLED", value);
    expect(paiEnabled()).toBe(false);
  },
);
it("can restore access with just the same true parameter", () => {
  vi.stubEnv("PAI_ENABLED", "true");
  expect(paiEnabled()).toBe(true);
});
it.each([
  "/pai",
  "/pai/",
  "/admin/pai",
  "/admin/pai/",
  "/api/pai/status",
  "/api/pai/history",
  "/api/pai/chat",
  "/api/pai/admin/config",
])("blocks %s before any session/data calls", async (path) => {
  vi.stubEnv("PAI_ENABLED", "false");
  for (const method of ["GET", "POST", "DELETE"]) {
    const r = await proxy(
      new NextRequest("https://portal.proacademy-ak.com" + path, { method }),
    );
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toContain("no-store");
  }
  expect(m.client).not.toHaveBeenCalled();
});
it("leaves the rest of the portal accessible and restores pAi when enabled", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("PAI_ENABLED", "false");
  expect(
    (await proxy(new NextRequest("https://portal.proacademy-ak.com/konto")))
      .status,
  ).toBe(200);
  vi.stubEnv("PAI_ENABLED", "true");
  expect(
    (await proxy(new NextRequest("https://portal.proacademy-ak.com/pai")))
      .status,
  ).toBe(200);
});
