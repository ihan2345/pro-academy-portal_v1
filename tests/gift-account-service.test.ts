import { it, expect, vi, beforeEach, afterEach } from "vitest";
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  links: [] as any[],
  order: {} as any,
  present: vi.fn(),
  reads: [] as string[],
}));
vi.mock("../src/lib/server/products/context", () => ({
  checked: (r: any) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));
vi.mock("../src/lib/gifts/status", () => ({
  presentGiftStatus: state.present,
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    rpc: state.rpc,
    from: (table: string) => {
      state.reads.push(table);
      const b: any = {
        select: () => b,
        eq: () => b,
        then: (r: any) => Promise.resolve({ data: state.links }).then(r),
        maybeSingle: async () => ({ data: state.order }),
      };
      return b;
    },
  }),
}));
import {
  giftAccount,
  giftAccountDetail,
  linkGiftAccount,
} from "../src/lib/gifts/account";
import { sealGift } from "../src/lib/gifts/crypto";
let sid = "first-login",
  exp = 100;
const session = () =>
  ({
    role: "parent",
    user: {
      id: "own-user",
      email: "own@example.invalid",
      email_confirmed_at: "2026-10-31T10:00:00Z",
      last_sign_in_at: "2026-10-31T10:00:00Z",
    },
    db: {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              access_token: `header.${Buffer.from(JSON.stringify({ session_id: sid, exp })).toString("base64url")}.signature`,
            },
          },
        }),
      },
    },
  }) as any;
beforeEach(() => {
  vi.clearAllMocks();
  state.reads = [];
  state.links = [];
  sid = "first-login";
  exp = 100;
  vi.stubEnv("GIFT_CARDS_ENABLED", "true");
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3115");
  vi.stubEnv("GIFT_ENCRYPTION_KEY", "k".repeat(64));
  state.rpc.mockResolvedValue({
    data: {
      cards: [{ id: "card", code_cipher: sealGift("CURRENT-CODE") }],
      available: 3000,
      has_cards: true,
    },
  });
});
afterEach(() => vi.unstubAllEnvs());
it("requires a verified parent before any private data is read", async () => {
  await expect(giftAccount(null)).rejects.toThrow(/anmelden/);
  await expect(giftAccount({ ...session(), role: "admin" })).rejects.toThrow(
    /Elternkonto/,
  );
  await expect(
    giftAccount({
      ...session(),
      user: { ...session().user, email_confirmed_at: null },
    }),
  ).rejects.toThrow(/bestätigtes/);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("uses the verified user for ownership and returns the current code without exposing ciphertext", async () => {
  const v = await giftAccount(session());
  expect(state.rpc).toHaveBeenCalledWith("gift_account_state", {
    input: { auth_id: "own-user", livemode: false },
  });
  expect(v.cards[0].code).toBe("CURRENT-CODE");
  expect(v.cards[0]).not.toHaveProperty("code_cipher");
});
it("keeps the welcome identity stable on token refresh and changes it for a new login", async () => {
  const first = await giftAccount(session());
  exp = 900;
  expect((await giftAccount(session())).welcome_key).toBe(first.welcome_key);
  sid = "next-login";
  expect((await giftAccount(session())).welcome_key).not.toBe(
    first.welcome_key,
  );
});
it("rejects external status links and does not allow a caller to supply another user ID", async () => {
  await expect(
    linkGiftAccount(session(), {
      value: "https://other.invalid/bestellstatus?order=abc&key=x",
    }),
  ).rejects.toThrow(/ProAcademy Statuslink/);
  await expect(
    linkGiftAccount(session(), {
      value: "PA-1234-1234-1234-1234-1234-1234",
      auth_id: "other",
    }),
  ).rejects.toThrow();
  expect(state.rpc).not.toHaveBeenCalled();
});
it("checks stored membership before opening a private profile history", async () => {
  const id = "b9200000-0000-4000-8000-000000000050";
  await expect(giftAccountDetail(session(), id)).rejects.toThrow(
    /nicht gefunden/,
  );
  expect(state.reads).toEqual(["gift_account_links"]);
  state.links = [{ scope: "buyer" }];
  state.order = { id };
  state.present.mockResolvedValue({ viewer: "buyer" });
  await giftAccountDetail(session(), id);
  expect(state.present).toHaveBeenCalledWith(state.order, "buyer");
});
