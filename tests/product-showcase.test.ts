import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  gate: vi.fn(),
  from: vi.fn(),
  list: vi.fn(),
  session: vi.fn(),
  rpc: vi.fn(),
  token: "a".repeat(64),
}));
vi.mock("../src/lib/server/products/runtime", () => ({
  requireProductShop: m.gate,
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ from: m.from }),
}));
vi.mock("../src/lib/server/products/catalog", () => ({ listProducts: m.list }));
vi.mock("../src/lib/server/supabase", () => ({ sessionUser: m.session }));
import {
  requireShowcase,
  showcaseProducts,
} from "../src/lib/server/products/showcase";
import { GET, POST } from "../src/app/api/admin/product-showcase/route";
import { GET as code } from "../src/app/api/admin/product-showcase/code/route";
import { HttpError } from "../src/lib/server/security";
const url = "https://portal.proacademy-ak.com/api/admin/product-showcase";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", "https://portal.proacademy-ak.com");
  m.token = "a".repeat(64);
  const result = async () => ({ data: { token: m.token }, error: null });
  m.from.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: result, single: result }) }),
  });
  m.gate.mockResolvedValue(undefined);
  m.list.mockResolvedValue({
    rows: [{ id: "public" }],
    context: { private: true },
  });
  m.rpc.mockResolvedValue({ data: true });
  m.session.mockResolvedValue({
    role: "admin",
    db: { rpc: m.rpc, from: m.from },
  });
});
it("rejects malformed and rotated tokens and the closed shop before reading catalogue data", async () => {
  await expect(requireShowcase("bad")).rejects.toMatchObject({ status: 404 });
  expect(m.from).not.toHaveBeenCalled();
  await expect(showcaseProducts("b".repeat(64))).rejects.toMatchObject({
    status: 404,
  });
  expect(m.list).not.toHaveBeenCalled();
  await requireShowcase(m.token);
  m.token = "b".repeat(64);
  await expect(requireShowcase("a".repeat(64))).rejects.toMatchObject({
    status: 404,
  });
  m.gate.mockRejectedValue(new HttpError(404, "closed"));
  await expect(showcaseProducts(m.token)).rejects.toMatchObject({
    status: 404,
  });
  expect(m.list).not.toHaveBeenCalled();
});
it("returns visitor products only without a session or context data", async () => {
  expect(await showcaseProducts(m.token)).toEqual({ rows: [{ id: "public" }] });
  expect(m.list).toHaveBeenCalledWith(
    null,
    new URLSearchParams({ channel: "catalog" }),
  );
  expect(m.session).not.toHaveBeenCalled();
});
it("protects settings and text-code with the Super-Admin permission", async () => {
  m.rpc.mockResolvedValue({ data: false });
  expect((await GET(new Request(url))).status).toBe(403);
  expect((await code(new Request(url + "/code"))).status).toBe(403);
  m.session.mockResolvedValue(null);
  expect((await GET(new Request(url))).status).toBe(401);
});
it("rotates via the session RPC and serves code as text only", async () => {
  m.rpc.mockImplementation(async (name) =>
    name === "can_manage_features"
      ? { data: true }
      : { data: { token: "b".repeat(64) } },
  );
  const request = (origin: string) =>
    new Request(url, {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({ expected: m.token }),
    });
  expect((await POST(request("https://evil.invalid"))).status).toBe(403);
  expect(m.session).not.toHaveBeenCalled();
  const r = await POST(request(new URL(url).origin));
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toContain("no-store");
  expect(m.rpc).toHaveBeenCalledWith("rotate_product_showcase_share", {
    expected: m.token,
    candidate: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect((await r.json()).code).toContain("b".repeat(64));
  const text = await code(new Request(url + "/code"));
  expect(text.headers.get("content-type")).toContain("text/plain");
  expect(await text.text()).toContain("<iframe");
  expect((await GET(new Request(url))).headers.get("content-type")).toContain(
    "application/json",
  );
});
