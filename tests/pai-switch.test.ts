import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  client: vi.fn(),
  single: vi.fn(),
  rows: vi.fn(),
  db: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: m.client }));
vi.mock("../src/lib/server/service-db", () => ({ serviceDb: m.db }));
import { paiEnabled, paiVisibility } from "../src/lib/server/pai/switch";
import { proxy } from "../src/proxy";
beforeEach(() => {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    single: m.single,
    in: m.rows,
  };
  m.db.mockReturnValue({ from: vi.fn(() => q) });
  m.single.mockResolvedValue({ data: { enabled: false }, error: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
it("fails closed on missing rows, database errors and exceptions", async () => {
  for (const result of [
    { data: null },
    { data: { enabled: true }, error: {} },
    { data: { enabled: "true" } },
  ]) {
    m.single.mockResolvedValue(result);
    expect(await paiEnabled()).toBe(false);
  }
  m.single.mockRejectedValue(Error("offline"));
  expect(await paiEnabled()).toBe(false);
});
it("reads each change without caching or an environment override", async () => {
  vi.stubEnv("PAI_ENABLED", "true");
  expect(await paiEnabled()).toBe(false);
  m.single.mockResolvedValue({ data: { enabled: true } });
  expect(await paiEnabled()).toBe(true);
  m.single.mockResolvedValue({ data: { enabled: false } });
  expect(await paiEnabled()).toBe(false);
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
])("blocks %s before session access", async (path) => {
  for (const method of ["GET", "POST", "DELETE"]) {
    const r = await proxy(
      new NextRequest("https://portal.proacademy-ak.com" + path, { method }),
    );
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toContain("no-store");
  }
  expect(m.client).not.toHaveBeenCalled();
});
it("does not gate management or unrelated portal pages", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  for (const path of ["/konto", "/admin/funktionen", "/api/platform/features"])
    expect(
      (await proxy(new NextRequest("https://portal.proacademy-ak.com" + path)))
        .status,
    ).toBe(200);
  expect(m.single).not.toHaveBeenCalled();
  m.single.mockResolvedValue({ data: { enabled: true } });
  expect(
    (await proxy(new NextRequest("https://portal.proacademy-ak.com/pai")))
      .status,
  ).toBe(200);
});

it("never exposes a mascot without the master and tolerates missing child flags", async () => {
  for (const [rows, expected] of [
    [[], { pai: false, mascot: false }],
    [[{ key: "pai_mascot", enabled: true }], { pai: false, mascot: false }],
    [[{ key: "pai", enabled: true }], { pai: true, mascot: false }],
    [
      [
        { key: "pai", enabled: true },
        { key: "pai_mascot", enabled: true },
      ],
      { pai: true, mascot: true },
    ],
    [
      [
        { key: "pai", enabled: false },
        { key: "pai_mascot", enabled: true },
      ],
      { pai: false, mascot: false },
    ],
  ] as const) {
    m.rows.mockResolvedValue({ data: rows });
    expect(await paiVisibility()).toEqual(expected);
  }
  m.rows.mockResolvedValue({ error: {}, data: [] });
  expect(await paiVisibility()).toEqual({ pai: false, mascot: false });
});
