import { it, expect, vi, beforeEach, afterEach } from "vitest";
const state = vi.hoisted(() => ({
  order: {} as any,
  gift: {} as any,
  uses: [] as any[],
  historyReads: 0,
}));
vi.mock("../src/lib/server/products/context", () => ({
  checked: (r: any) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      let permitted = true;
      const b: any = {
        select: () => {
          if (table === "gift_code_uses") state.historyReads++;
          return b;
        },
        eq: (k: string, v: any) => {
          if (table === "gift_orders" && k === "id" && v !== state.order.id)
            permitted = false;
          return b;
        },
        or: (value: string) => {
          permitted =
            permitted &&
            (value.includes(state.order.access_hash) ||
              value.includes(state.order.recipient_access_hash));
          return b;
        },
        in: () => b,
        order: () => b,
        maybeSingle: async () => ({
          data:
            table === "gift_orders"
              ? permitted
                ? state.order
                : null
              : state.gift,
        }),
        then: (resolve: any) =>
          Promise.resolve({
            data: table === "gift_code_uses" ? state.uses : [],
          }).then(resolve),
      };
      return b;
    },
  }),
}));
import { giftStatusView } from "../src/lib/gifts/status";
import { giftHash, sealGift } from "../src/lib/gifts/crypto";
const id = "b9200000-0000-4000-8000-000000000050";
beforeEach(() => {
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("GIFT_CARDS_ENABLED", "true");
  vi.stubEnv("GIFT_ENCRYPTION_KEY", "v".repeat(64));
  state.historyReads = 0;
  state.order = {
    id,
    status: "issued",
    amount: 5000,
    currency: "eur",
    buyer: { full_name: "Alex", email: "a@example.invalid" },
    recipient: {
      first_name: "Nora",
      last_name: "Test",
      email: "n@example.invalid",
    },
    access_hash: giftHash("buyer-only"),
    recipient_access_hash: giftHash("recipient-only"),
    paid_at: "2026-10-30T12:00:00Z",
  };
  state.gift = {
    id: "card",
    status: "issued",
    amount: 5000,
    remaining: 3000,
    reserved: 0,
    code_cipher: sealGift("PRIVATE-CURRENT-CODE"),
    initial_code_cipher: sealGift("ORIGINAL-CODE"),
    expires_at: "2099-10-30T12:00:00Z",
  };
  state.uses = [
    {
      intent_id: "purchase",
      amount: 2000,
      state: "spent",
      before_balance: 5000,
      after_balance: 3000,
      spent_at: "2026-10-30T13:00:00Z",
      product_purchase_intents: { product: { name: "PRIVATE-TRAINING" } },
    },
  ];
});
afterEach(() => vi.unstubAllEnvs());
it("keeps remaining balance, replacement code and consumption history out of the buyer response", async () => {
  const v = await giftStatusView(id, "buyer-only");
  expect(v.viewer).toBe("buyer");
  expect(v.code).toBeNull();
  expect(v).not.toHaveProperty("remaining");
  expect(v).not.toHaveProperty("history");
  expect(JSON.stringify(v)).not.toContain("PRIVATE");
  expect(state.historyReads).toBe(0);
});
it("shows the active code, balance and narrowly scoped product history to the beneficiary without an account", async () => {
  const v: any = await giftStatusView(id, "recipient-only");
  expect(v.viewer).toBe("recipient");
  expect(v.remaining).toBe(3000);
  expect(v.code).toBe("PRIVATE-CURRENT-CODE");
  expect(v.history[0]).toMatchObject({
    product_name: "PRIVATE-TRAINING",
    used_amount: 2000,
    before_balance: 5000,
    after_balance: 3000,
  });
  expect(v.history[0]).not.toHaveProperty("product");
});
it("does not grant access with a number alone, an incorrect key or another order", async () => {
  await expect(giftStatusView(id, "")).rejects.toThrow(/nicht gefunden/);
  await expect(giftStatusView(id, "wrong")).rejects.toThrow(/nicht gefunden/);
  await expect(
    giftStatusView("b9200000-0000-4000-8000-000000000099", "recipient-only"),
  ).rejects.toThrow(/nicht gefunden/);
});
