import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  matches: true,
  order: {} as any,
  verify: vi.fn(),
  claim: vi.fn(),
  fulfil: vi.fn(),
  cookieSet: vi.fn(),
  limits: true,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (state.cookie ? { value: state.cookie } : undefined),
    set: state.cookieSet,
  }),
}));
vi.mock("../src/lib/server/products/checkout", () => ({
  fulfillCheckout: state.fulfil,
}));
vi.mock("../src/lib/server/products/context", () => ({
  checked: (r: any) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));
vi.mock("../src/lib/server/supabase", () => ({
  sessionDb: async () => ({
    auth: { verifyOtp: state.verify },
    rpc: state.claim,
  }),
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    rpc: async () => ({ data: state.limits }),
    from: () => {
      const b: any = {
        select: () => b,
        eq: (key: string, value: string) => {
          if (
            key === "guest_token_hash" &&
            value !== state.order.guest_token_hash
          )
            state.matches = false;
          return b;
        },
        maybeSingle: async () => ({ data: state.matches ? state.order : null }),
      };
      return b;
    },
  }),
}));
import {
  guestBrowserHash,
  ownGuestIntent,
  claimGuestPurchases,
} from "../src/lib/server/products/guest-checkout";
import { GET } from "../src/app/auth/product/route";
const id = "90000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  state.cookie = undefined;
  state.matches = true;
  state.order = { id, guest_data: { email: "example@example.invalid" } };
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3110");
  vi.stubEnv("PRODUCT_MANAGEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
  state.verify.mockResolvedValue({ error: null });
  state.claim.mockResolvedValue({ data: [], error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("uses an HTTP-only browser secret and stores only its hash as guest ownership", async () => {
  expect(await guestBrowserHash()).toBeNull();
  const hash = await guestBrowserHash(true);
  const [, token, options] = state.cookieSet.mock.calls[0];
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(hash).not.toBe(token);
  expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  state.cookie = token;
  expect(await guestBrowserHash()).toBe(hash);
});
it("cannot read an order with its public ID alone or another browser's cookie", async () => {
  await expect(ownGuestIntent(id)).rejects.toThrow(/nicht gefunden/);
  state.cookie = "a".repeat(64);
  state.order.guest_token_hash = "b".repeat(64);
  await expect(ownGuestIntent(id)).rejects.toThrow(/nicht gefunden/);
});
it("never accepts an invalid, expired or arbitrary token type as a confirmed account", async () => {
  const req = (suffix: string) =>
    new NextRequest(`http://127.0.0.1:3110/auth/product?${suffix}`);
  expect(
    (await GET(req("token_hash=bad&type=invite"))).headers.get("location"),
  ).toContain("error=auth");
  expect(state.verify).not.toHaveBeenCalled();
  expect(
    (await GET(req(`token_hash=${"a".repeat(64)}&type=recovery`))).headers.get(
      "location",
    ),
  ).toContain("error=auth");
  state.verify.mockResolvedValueOnce({ error: { message: "expired" } });
  expect(
    (await GET(req(`token_hash=${"a".repeat(64)}&type=invite`))).headers.get(
      "location",
    ),
  ).toContain("error=auth");
  expect(state.claim).not.toHaveBeenCalled();
});
it("claims only after successful verification and redirects to the shop without a token in the URL", async () => {
  const response = await GET(
    new NextRequest(
      `http://127.0.0.1:3110/auth/product?token_hash=${"a".repeat(64)}&type=invite`,
    ),
  );
  expect(state.verify).toHaveBeenCalledWith({
    token_hash: "a".repeat(64),
    type: "invite",
  });
  expect(state.claim).toHaveBeenCalledWith("claim_product_guest_orders");
  expect(response.headers.get("location")).toBe(
    "http://127.0.0.1:3110/produkte?account=confirmed",
  );
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("reconciles paid guest orders after the claim without treating fulfillment failure as failed login", async () => {
  state.fulfil.mockRejectedValueOnce(Error("needs review"));
  const db = { rpc: vi.fn(async () => ({ data: [id], error: null })) };
  await expect(claimGuestPurchases(db as any)).resolves.toBeUndefined();
  expect(state.fulfil).toHaveBeenCalledWith(id);
});
