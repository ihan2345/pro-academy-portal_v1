import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { emptyProduct } from "../src/lib/products/domain";
const session = vi.hoisted(() => ({ value: null as any }));
vi.mock("../src/lib/server/supabase", () => ({
  sessionUser: async () => session.value,
  sessionDb: vi.fn(),
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => {
    throw new Error("Unexpected database access before authorisation");
  },
}));
vi.mock("../src/lib/server/products/runtime", async (original) => ({
  ...(await original<typeof import("../src/lib/server/products/runtime")>()),
  requireProductShop: vi.fn(async () => undefined),
}));
import { productApi } from "../src/lib/server/products/api";
const url = "http://127.0.0.1:3110";
beforeEach(() => {
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("APP_URL", url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
  vi.stubEnv("PRODUCT_MANAGEMENT_ENABLED", "true");
  session.value = null;
});
afterEach(() => vi.unstubAllEnvs());
const req = (path: string, method = "GET", data?: unknown, origin = url) =>
  new NextRequest(url + path, {
    method,
    headers:
      method === "GET" ? {} : { origin, "content-type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
it("hides the entire new surface outside the explicitly isolated local environment", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://production.example.invalid");
  expect((await productApi(req("/api/admin/products"), [], true)).status).toBe(
    404,
  );
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
  vi.stubEnv("APP_MODE", "production");
  expect((await productApi(req("/api/products"), [], false)).status).toBe(404);
});
it("rejects anonymous and parent admin calls before touching any privileged database", async () => {
  expect((await productApi(req("/api/admin/products"), [], true)).status).toBe(
    401,
  );
  session.value = { role: "parent", user: { id: "test" } };
  expect((await productApi(req("/api/admin/products"), [], true)).status).toBe(
    403,
  );
});
it("checks the origin before mutation, even for an admin", async () => {
  session.value = { role: "admin", user: { id: "test" } };
  expect(
    (
      await productApi(
        req(
          "/api/admin/products/preview",
          "POST",
          {},
          "https://foreign.example.invalid",
        ),
        ["preview"],
        true,
      )
    ).status,
  ).toBe(403);
});
it("uses exactly the production policy for server-simulated mixed-family previews", async () => {
  session.value = { role: "admin", user: { id: "test" } };
  const data = {
    ...emptyProduct(),
    status: "active",
    channels: ["catalog"],
    kind: "subscription",
  };
  const r = await productApi(
    req("/api/admin/products/preview", "POST", {
      data,
      scenario: "mixed",
      channel: "catalog",
    }),
    ["preview"],
    true,
  );
  expect(r.status).toBe(200);
  const v = await r.json();
  expect(v.simulation).toBe(true);
  expect(v.context.children).toHaveLength(2);
  expect(v.decision.audiences).toContain("gamechanger");
  expect(v.decision.player_id).toBe(v.context.children[0].id);
});
it("never accepts a forged user context or arbitrary simulation state", async () => {
  session.value = { role: "admin", user: { id: "test" } };
  const r = await productApi(
    req("/api/admin/products/preview", "POST", {
      data: emptyProduct(),
      scenario: "superadmin",
      channel: "catalog",
      role: "admin",
    }),
    ["preview"],
    true,
  );
  expect(r.status).toBe(400);
});
it("refuses a purchase before checkout when no Stripe test configuration is enabled", async () => {
  session.value = { role: "parent", user: { id: "test" } };
  vi.stubEnv("PRODUCT_PAYMENTS_ENABLED", "false");
  const r = await productApi(
    req(
      "/api/products/00000000-0000-4000-8000-000000000001/checkout",
      "POST",
      {},
    ),
    ["00000000-0000-4000-8000-000000000001", "checkout"],
    false,
  );
  expect(r.status).toBe(503);
});
it("a closed storefront rejects direct purchase calls for signed-in parents", async () => {
  const { requireProductShop } =
    await import("../src/lib/server/products/runtime");
  const { HttpError } = await import("../src/lib/server/security");
  vi.mocked(requireProductShop).mockRejectedValueOnce(
    new HttpError(404, "Shop geschlossen"),
  );
  session.value = { role: "parent", user: { id: "parent" } };
  const r = await productApi(
    req(
      "/api/products/00000000-0000-4000-8000-000000000001/checkout",
      "POST",
      {},
    ),
    ["00000000-0000-4000-8000-000000000001", "checkout"],
    false,
  );
  expect(r.status).toBe(404);
});
