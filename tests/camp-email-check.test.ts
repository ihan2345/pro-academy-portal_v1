import { beforeEach, expect, it, vi } from "vitest";
import { HttpError } from "../src/lib/server/security";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  limit: vi.fn(),
  origin: vi.fn(),
  access: vi.fn(),
}));
vi.mock("../src/lib/camps/guard", () => ({
  requireCampAccess: m.access,
  requireCampOrigin: m.origin,
  requireCampLocal: vi.fn(),
}));
vi.mock("../src/lib/camps/rate-limit", () => ({ limitCampRequest: m.limit }));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ rpc: m.rpc }),
}));
import { POST } from "../src/app/api/camp/[...path]/route";
function call(email: string) {
  return POST(
    new NextRequest("https://portal.example/api/camp/email-check", {
      method: "POST",
      headers: {
        origin: "https://portal.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email }),
    }),
    { params: Promise.resolve({ path: ["email-check"] }) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  m.rpc.mockResolvedValue({ data: false, error: null });
});
it.each([true, false])(
  "checks email without returning family details or creating anything: %s",
  async (known) => {
    m.rpc.mockResolvedValue({ data: known, error: null });
    const result = await call(" Parent@Example.com ");
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ requires_login: known });
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith(
      "parent_email_requires_login",
      { input_email: "parent@example.com" },
    );
    expect(m.limit).toHaveBeenCalledWith(expect.anything(), "email-check");
    expect(m.origin).toHaveBeenCalled();
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  },
);
it("validates email before lookup", async () => {
  expect((await call("invalid")).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("fails closed on rate limiting and on unavailable lookup", async () => {
  m.limit.mockRejectedValue(new HttpError(429, "Bitte warten"));
  expect((await call("parent@example.com")).status).toBe(429);
  expect(m.rpc).not.toHaveBeenCalled();
  m.limit.mockResolvedValue(undefined);
  m.rpc.mockResolvedValue({ data: null, error: null });
  expect((await call("parent@example.com")).status).toBe(503);
});
