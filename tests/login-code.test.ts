import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  verify: vi.fn(),
  send: vi.fn(),
  rpc: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  limit: vi.fn(),
  claim: vi.fn(),
  query: vi.fn(),
  known: vi.fn(),
  session: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: m.get, set: m.set, delete: m.remove }),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: { CAMP_REQUEST_LIMIT: { limit: m.limit } },
  }),
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ rpc: m.known }),
}));
vi.mock("../src/lib/server/supabase", () => ({
  sessionDb: async () => ({
    auth: { verifyOtp: m.verify, signInWithOtp: m.send },
    rpc: m.rpc,
  }),
  sessionUser: m.session,
  serviceDb: () => ({ from: m.query }),
}));
vi.mock("../src/lib/server/products/guest-checkout", () => ({
  claimGuestPurchases: m.claim,
}));
import { POST } from "../src/app/api/[...path]/route";
import { limitLoginCode } from "../src/lib/server/login-code";
function call(
  body: unknown,
  path = "auth/verify",
  origin = "https://portal.example.com",
) {
  return POST(
    new NextRequest(`https://portal.example.com/api/${path}`, {
      method: "POST",
      headers: {
        origin,
        "Content-Type": "application/json",
        "cf-connecting-ip": "192.0.2.1",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: path.split("/") }) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", "https://portal.example.com");
  vi.stubEnv("EMAIL_TEST_MODE", "false");
  vi.stubEnv("CAMP_SIDE_EFFECTS_BLOCKED", "false");
  vi.stubEnv("PRODUCT_MANAGEMENT_ENABLED", "false");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-secret-for-limiter");
  m.verify.mockResolvedValue({
    data: { session: { user: { id: "test-user" } } },
    error: null,
  });
  m.limit.mockResolvedValue({ success: true });
  m.rpc.mockResolvedValue({ error: null });
  m.send.mockResolvedValue({ error: null });
  m.known.mockResolvedValue({ data: false, error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("email code login", () => {
  it("verifies a leading-zero code using the session client before completing login", async () => {
    const r = await call({ email: "Parent@example.com", code: "012345" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, redirect: "/" });
    expect(m.verify).toHaveBeenCalledWith({
      email: "parent@example.com",
      token: "012345",
      type: "email",
    });
    expect(m.limit).toHaveBeenCalledTimes(2);
    expect(
      m.limit.mock.calls.every(([{ key }]) => /^[a-f0-9]{64}$/.test(key)),
    ).toBe(true);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each(["12345", "1234567", "12a456", "１２３４５６", 123456, "123 456"])(
    "rejects malformed code %s before contacting auth",
    async (code) => {
      expect((await call({ email: "parent@example.com", code })).status).toBe(
        400,
      );
      expect(m.verify).not.toHaveBeenCalled();
    },
  );
  it.each(["expired", "used", "invalid"])(
    "keeps a generic error for %s codes without completing login",
    async (message) => {
      m.verify.mockResolvedValue({
        data: { session: null },
        error: { message },
      });
      const r = await call({ email: "parent@example.com", code: "123456" });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toContain(
        "ungültig, abgelaufen oder bereits verwendet",
      );
      expect(m.rpc).not.toHaveBeenCalled();
      expect(m.claim).not.toHaveBeenCalled();
      expect(m.remove).not.toHaveBeenCalled();
    },
  );
  it("requires an actual session, even when auth returns no error", async () => {
    m.verify.mockResolvedValue({ data: { session: null }, error: null });
    expect(
      (await call({ email: "parent@example.com", code: "123456" })).status,
    ).toBe(400);
  });
  it("rejects a foreign origin before OTP verification", async () => {
    expect(
      (
        await call(
          { email: "parent@example.com", code: "123456" },
          "auth/verify",
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    expect(m.verify).not.toHaveBeenCalled();
  });
  it("retains the local camp write protection", async () => {
    vi.stubEnv("CAMP_SIDE_EFFECTS_BLOCKED", "true");
    expect(
      (await call({ email: "parent@example.com", code: "123456" })).status,
    ).toBe(423);
    expect(m.verify).not.toHaveBeenCalled();
  });
  it("retains the test-account allowlist", async () => {
    vi.stubEnv("EMAIL_TEST_MODE", "true");
    vi.stubEnv("EMAIL_TEST_RECIPIENT", "admin@example.com");
    vi.stubEnv("AUTH_TEST_EMAILS", "");
    expect(
      (await call({ email: "parent@example.com", code: "123456" })).status,
    ).toBe(400);
    expect(m.verify).not.toHaveBeenCalled();
  });
  it.each([1, 2])("blocks when rate bucket %s is exceeded", async (bucket) => {
    if (bucket === 2) m.limit.mockResolvedValueOnce({ success: true });
    m.limit.mockResolvedValueOnce({ success: false });
    expect(
      (await call({ email: "parent@example.com", code: "123456" })).status,
    ).toBe(429);
    expect(m.verify).not.toHaveBeenCalled();
  });
  it("fails closed without a Cloudflare source IP", async () => {
    await expect(
      limitLoginCode(
        new Request("https://portal.example.com/api/auth/verify"),
        "a@example.com",
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("accepts an invitation and preserves a protected player destination", async () => {
    const player = "12345678-1234-4234-8234-123456789012";
    m.get.mockImplementation((key) => ({
      value:
        key === "pa_invitation"
          ? "invitation-hash"
          : key === "pa_player_redirect"
            ? player
            : "",
    }));
    const r = await call({
      email: "parent@example.com",
      code: "123456",
      redirect: "https://evil.example",
    });
    expect(await r.json()).toEqual({
      ok: true,
      redirect: `/admin/spieler/${player}`,
    });
    expect(m.rpc).toHaveBeenCalledWith("accept_invitation", {
      invitation_hash: "invitation-hash",
    });
    expect(m.remove).toHaveBeenCalledWith("pa_invitation");
    expect(m.remove).toHaveBeenCalledWith("pa_player_redirect");
  });
  it("preserves invitation errors and the cookie for retry", async () => {
    m.get.mockReturnValue({ value: "invalid-invitation" });
    m.rpc.mockResolvedValue({ error: { message: "invalid" } });
    expect(
      await (
        await call({ email: "parent@example.com", code: "123456" })
      ).json(),
    ).toEqual({ ok: true, redirect: "/login?error=invitation" });
    expect(m.remove).not.toHaveBeenCalled();
  });
  it("claims guest purchases and prefers the shop return, even if claiming needs review", async () => {
    vi.stubEnv("PRODUCT_MANAGEMENT_ENABLED", "true");
    vi.stubEnv("APP_MODE", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    m.claim.mockRejectedValue(new Error("review"));
    m.get.mockImplementation((key) =>
      key === "pa_product_return" ? { value: "1" } : undefined,
    );
    expect(
      await (
        await call({ email: "parent@example.com", code: "123456" })
      ).json(),
    ).toEqual({ ok: true, redirect: "/produkte" });
    expect(m.claim).toHaveBeenCalledOnce();
    expect(m.remove).toHaveBeenCalledWith("pa_product_return");
  });
  it("rejects an unsafe player redirect", async () => {
    m.get.mockImplementation((key) =>
      key === "pa_player_redirect"
        ? { value: "https://evil.example" }
        : undefined,
    );
    expect(
      (
        await (
          await call({ email: "parent@example.com", code: "123456" })
        ).json()
      ).redirect,
    ).toBe("/");
  });
  it("keeps existing-account-only requests and the PKCE link callback", async () => {
    const r = await call({ email: "parent@example.com" }, "auth/login");
    expect(r.status).toBe(200);
    expect(m.send).toHaveBeenCalledWith({
      email: "parent@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://portal.example.com/auth/callback",
      },
    });
  });
  it("only permits creating a user after a valid, unused, matching invitation", async () => {
    m.get.mockImplementation((key) =>
      key === "pa_invitation" ? { value: "invitation-hash" } : undefined,
    );
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const key of ["select", "eq", "ilike", "is", "gt"])
      query[key] = vi.fn(() => query);
    query.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "invitation" }, error: null });
    m.query.mockReturnValue(query);
    expect(
      (await call({ email: "parent@example.com" }, "auth/login")).status,
    ).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("token_hash", "invitation-hash");
    expect(query.ilike).toHaveBeenCalledWith("email", "parent@example.com");
    expect(query.is).toHaveBeenCalledWith("consumed_at", null);
    expect(query.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(m.send.mock.calls[0][0].options.shouldCreateUser).toBe(true);
  });
});

it("permits a known family to request its own activation code while keeping the neutral response", async () => {
  m.known.mockResolvedValue({ data: true, error: null });
  const result = await call(
    { email: "Parent@example.com", return_to_shop: true },
    "auth/login",
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ ok: true });
  expect(m.known).toHaveBeenCalledWith("parent_self_activation_available", {
    input_email: "parent@example.com",
  });
  expect(m.send).toHaveBeenCalledWith({
    email: "parent@example.com",
    options: {
      shouldCreateUser: true,
      emailRedirectTo: "https://portal.example.com/auth/callback",
    },
  });
  expect(m.set).toHaveBeenCalledWith(
    "pa_product_return",
    "1",
    expect.objectContaining({ httpOnly: true, secure: true, sameSite: "lax" }),
  );
});
it("does not proceed with an ambiguous verified family association", async () => {
  m.rpc.mockResolvedValue({ error: { message: "ambiguous family" } });
  const result = await call({ email: "parent@example.com", code: "123456" });
  expect((await result.json()).redirect).toBe("/login?error=account");
  expect(m.claim).not.toHaveBeenCalled();
});
it("can recover an expired invitation only through successful verified self-activation", async () => {
  m.get.mockImplementation((key) =>
    key === "pa_invitation" ? { value: "expired" } : undefined,
  );
  m.rpc.mockImplementation(async (name) =>
    name === "accept_invitation"
      ? { error: { message: "expired" } }
      : { data: "parent-id", error: null },
  );
  expect(
    (await (await call({ email: "parent@example.com", code: "123456" })).json())
      .redirect,
  ).toBe("/");
  expect(m.rpc).toHaveBeenCalledWith("activate_verified_parent");
  expect(m.remove).toHaveBeenCalledWith("pa_invitation");
});
