import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  rpc: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.get, delete: mocks.remove }),
}));
vi.mock("../src/lib/server/supabase", () => ({
  sessionDb: async () => ({
    auth: { exchangeCodeForSession: mocks.exchange },
    rpc: mocks.rpc,
  }),
}));
import { GET as callback } from "../src/app/auth/callback/route";
import { GET as invitation } from "../src/app/einladung/route";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  mocks.exchange.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("authentication redirects preserve the configured cookie host", () => {
  it("returns to 127.0.0.1 after a successful code exchange despite Next URL normalization", async () => {
    const response = await callback(
      new NextRequest("http://127.0.0.1:3000/auth/callback?code=example"),
    );
    expect(mocks.exchange).toHaveBeenCalledWith("example");
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/");
  });
  it("uses only the configured production origin, ignoring forwarded hosts and next parameters", async () => {
    vi.stubEnv("APP_URL", "https://portal.example.com");
    const response = await callback(
      new NextRequest(
        "http://internal/auth/callback?code=example&next=https://attacker.example",
        { headers: { "x-forwarded-host": "attacker.example" } },
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://portal.example.com/",
    );
  });
  it("preserves the error reason after a failed exchange", async () => {
    mocks.exchange.mockResolvedValue({ error: { message: "expired" } });
    const response = await callback(
      new NextRequest("http://127.0.0.1:3000/auth/callback?code=expired"),
    );
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login?error=auth",
    );
  });
  it("does not attempt an exchange without a code", async () => {
    const response = await callback(
      new NextRequest("http://127.0.0.1:3000/auth/callback"),
    );
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login?error=auth",
    );
  });
  it("accepts the invitation before redirecting and clears its cookie", async () => {
    mocks.get.mockReturnValue({ value: "hashed-invitation" });
    const response = await callback(
      new NextRequest("http://127.0.0.1:3000/auth/callback?code=example"),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("accept_invitation", {
      invitation_hash: "hashed-invitation",
    });
    expect(mocks.remove).toHaveBeenCalledWith("pa_invitation");
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/");
  });
  it("keeps a rejected invitation on the configured error page", async () => {
    mocks.get.mockReturnValue({ value: "invalid-invitation" });
    mocks.rpc.mockResolvedValue({ error: { message: "invalid" } });
    const response = await callback(
      new NextRequest("http://127.0.0.1:3000/auth/callback?code=example"),
    );
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login?error=invitation",
    );
  });
  it("keeps the invitation cookie and login form on the same configured host", async () => {
    const response = await invitation(
      new NextRequest(
        "http://127.0.0.1:3000/einladung?token=" + "a".repeat(64),
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login",
    );
    expect(response.cookies.get("pa_invitation")?.value).toHaveLength(64);
  });
});

it("returns a player-link login to the protected card, accepting only a UUID", async () => {
  const player = "12345678-1234-4234-8234-123456789012";
  mocks.get.mockImplementation((name) =>
    name === "pa_player_redirect" ? { value: player } : undefined,
  );
  const r = await callback(
    new NextRequest(
      `http://127.0.0.1:3000/auth/callback?code=example&player=${player}`,
    ),
  );
  expect(r.headers.get("location")).toBe(
    `http://127.0.0.1:3000/admin/spieler/${player}`,
  );
  mocks.get.mockImplementation((name) =>
    name === "pa_player_redirect"
      ? { value: "https://attacker.example" }
      : undefined,
  );
  const bad = await callback(
    new NextRequest(
      "http://127.0.0.1:3000/auth/callback?code=example&player=https://attacker.example",
    ),
  );
  expect(bad.headers.get("location")).toBe("http://127.0.0.1:3000/");
});
