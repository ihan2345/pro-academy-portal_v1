import { it, expect, vi, beforeEach, afterEach } from "vitest";
const state = vi.hoisted(() => ({
  order: {} as any,
  gift: {} as any,
  jobs: [] as any[],
  patches: [] as any[],
  balanceJobs: [] as any[],
  purchase: {} as any,
  generate: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    rpc: state.rpc,
    auth: { admin: { generateLink: state.generate } },
    from: (table: string) => {
      let patch: any,
        audience = "";
      const b: any = {
        select: () => b,
        eq: (key: string, value: any) => {
          if (key === "audience") audience = value;
          return b;
        },
        maybeSingle: async () => ({ data: state.gift }),
        single: async () => ({
          data:
            table === "gift_orders"
              ? state.order
              : table === "product_purchase_intents"
                ? state.purchase
                : state.gift,
        }),
        update: (p: any) => {
          patch = p;
          return b;
        },
        then: (resolve: any) => {
          state.patches.push({ audience, ...patch });
          return Promise.resolve({ data: null }).then(resolve);
        },
      };
      return b;
    },
  }),
}));
vi.mock("../src/lib/gifts/artwork-mail", () => ({
  giftMailArtwork: vi.fn(async () =>
    ["front", "back"].map((side) => ({
      filename: `${side}.png`,
      content: Buffer.from("png"),
      contentType: "image/png",
      cid: `pa-gift-${side}`,
    })),
  ),
  giftMailImages: '<img src="cid:pa-gift-front"><img src="cid:pa-gift-back">',
}));
import { giftMailArtwork } from "../src/lib/gifts/artwork-mail";
import { processGiftMessages } from "../src/lib/gifts/messages";
import { sealGift } from "../src/lib/gifts/crypto";
const provider = {
  name: "capture",
  send: vi.fn(async () => ({ id: "captured" })),
};
beforeEach(() => {
  vi.clearAllMocks();
  state.patches = [];
  state.balanceJobs = [];
  state.purchase = {
    id: "purchase",
    status: "fulfilled",
    product: { name: "Training" },
    expected_amount: 0,
    gift_credit_amount: 2000,
  };
  vi.stubEnv("GIFT_CARDS_ENABLED", "true");
  vi.stubEnv("GIFT_MAIL_ENABLED", "true");
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3115");
  vi.stubEnv("EMAIL_TEST_MODE", "true");
  vi.stubEnv("EMAIL_TEST_RECIPIENT", "capture@example.invalid");
  vi.stubEnv("GIFT_ENCRYPTION_KEY", "c".repeat(64));
  state.order = {
    id: "order",
    status: "issued",
    amount: 5000,
    buyer: { full_name: "Alex Test", email: "buyer@example.invalid" },
    recipient: { first_name: "Nora", email: "recipient@example.invalid" },
    access_cipher: sealGift("buyer-access"),
    recipient_access_cipher: sealGift("recipient-access"),
  };
  state.gift = {
    status: "issued",
    amount: 5000,
    remaining: 5000,
    code_hash: "code-hash",
    expires_at: "2027-10-30T12:00:00Z",
    code_cipher: sealGift("PA-DEMO"),
  };
  state.jobs = ["buyer", "recipient"].map((audience) => ({
    order_id: "order",
    audience,
    attempts: 1,
  }));
  state.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "gift_claim_balance_messages" ? state.balanceJobs : state.jobs,
  }));
  provider.send.mockResolvedValue({ id: "captured" });
});
afterEach(() => vi.unstubAllEnvs());
it("prepares independent purchase and gift emails, marks local capture honestly and never creates accounts automatically", async () => {
  expect(await processGiftMessages(provider)).toBe(2);
  expect(provider.send).toHaveBeenCalledTimes(2);
  expect(state.patches.map((p) => p.status)).toEqual(["captured", "captured"]);
  expect(state.generate).not.toHaveBeenCalled();
  const messages = provider.send.mock.calls.map((c: any) => c[0]);
  expect(messages[1].text).toContain("Alex Test hat dir");
  expect(messages[1].text).toContain("PA-DEMO");
  expect(messages[1].text).toContain("Restguthaben");
  expect(giftMailArtwork).toHaveBeenCalledTimes(1);
  expect(messages[1].attachments.map((a: any) => a.cid)).toEqual([
    "pa-gift-front",
    "pa-gift-back",
  ]);
  expect(messages[1].html).toContain('src="cid:pa-gift-front"');
  expect(messages[0].attachments).toBe(messages[1].attachments);
});
it("retries a failed recipient email without resetting a successful buyer email", async () => {
  provider.send
    .mockRejectedValueOnce(Error("SMTP failed"))
    .mockResolvedValueOnce({ id: "ok" });
  expect(await processGiftMessages(provider)).toBe(1);
  expect(state.patches.map((p) => p.status)).toEqual(["failed", "captured"]);
});
it("never emails codes for refunded gifts or releases the queue when the gift switch is disabled", async () => {
  state.order.status = "refunded";
  expect(await processGiftMessages(provider)).toBe(0);
  expect(provider.send).not.toHaveBeenCalled();
  vi.stubEnv("GIFT_MAIL_ENABLED", "false");
  state.rpc.mockClear();
  expect(await processGiftMessages(provider)).toBe(0);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("sends one combined gift notification when buyer and beneficiary share the same address", async () => {
  state.order.recipient.email = state.order.buyer.email;
  expect(await processGiftMessages(provider)).toBe(1);
  expect(state.patches.map((p) => p.status)).toEqual(["cancelled", "captured"]);
});

it("replaces account invitations with scoped order-status links without creating auth credentials", async () => {
  state.jobs = [
    { order_id: "order", audience: "status_recipient", attempts: 1 },
  ];
  expect(await processGiftMessages(provider)).toBe(1);
  expect(state.generate).not.toHaveBeenCalled();
  const mail = (provider.send.mock.calls as any)[0][0];
  expect(mail.subject).toBe("Dein persönlicher ProAcademy Bestellstatus");
  expect(mail.text).toContain("kein Portalkonto");
  expect(mail.text).toContain("recipient-access");
  expect(mail.text).not.toContain("buyer-access");
  expect(mail.attachments).toBeUndefined();
});
it("sends a balance update only to the beneficiary with before/used/after, last purchase and original expiry", async () => {
  state.jobs = [];
  state.gift.remaining = 3000;
  state.balanceJobs = [
    {
      order_id: "order",
      intent_id: "purchase",
      after_balance: 3000,
      before_balance: 5000,
      used_amount: 2000,
      code_hash: "code-hash",
      code_cipher: state.gift.code_cipher,
      purchased_at: "2026-10-30T12:00:00Z",
      attempts: 1,
    },
  ];
  expect(await processGiftMessages(provider)).toBe(1);
  const mail = (provider.send.mock.calls as any)[0][0];
  for (const s of [
    "50,00",
    "20,00",
    "30,00",
    "Training",
    "purchase",
    "30.10.2027",
    "ursprüngliche Gültigkeit",
  ])
    expect(mail.text).toContain(s);
  expect(mail.text).toContain("recipient-access");
  expect(mail.text).not.toContain("buyer-access");
  expect(giftMailArtwork).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 3000 }),
  );
});
it("does not send a stale balance code or retired portal-account mail", async () => {
  state.jobs = [{ order_id: "order", audience: "access_buyer", attempts: 1 }];
  state.balanceJobs = [
    {
      order_id: "order",
      intent_id: "purchase",
      after_balance: 3000,
      code_hash: "old-version",
      attempts: 1,
    },
  ];
  expect(await processGiftMessages(provider)).toBe(0);
  expect(provider.send).not.toHaveBeenCalled();
  expect(state.patches.map((p) => p.status)).toEqual([
    "cancelled",
    "cancelled",
  ]);
});
it("keeps a delayed initial beneficiary message useful after full redemption without sending an obsolete code or zero-value card", async () => {
  state.jobs = [{ order_id: "order", audience: "recipient", attempts: 1 }];
  state.gift.remaining = 0;
  expect(await processGiftMessages(provider)).toBe(1);
  const mail = (provider.send.mock.calls as any)[0][0];
  expect(mail.text).toContain("vollständig eingelöst");
  expect(mail.text).not.toContain("PA-DEMO");
  expect(mail.text).toContain("recipient-access");
  expect(mail.attachments).toBeUndefined();
});
