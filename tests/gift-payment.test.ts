import { it, expect, vi, beforeEach, afterEach } from "vitest";
const state = vi.hoisted(() => ({
  order: {} as any,
  session: {} as any,
  line: {} as any,
  pi: {} as any,
  rpc: vi.fn(),
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    rpc: state.rpc,
    from: () => {
      const b: any = {
        select: () => b,
        eq: () => b,
        single: async () => ({ data: state.order }),
      };
      return b;
    },
  }),
}));
vi.mock("../src/lib/server/products/catalog", () => ({ productById: vi.fn() }));
vi.mock("../src/lib/server/products/stripe", () => ({
  productStripe: () => ({
    checkout: {
      sessions: {
        retrieve: async () => state.session,
        listLineItems: async () => ({ has_more: false, data: [state.line] }),
      },
    },
    paymentIntents: { retrieve: async () => state.pi },
  }),
}));
import { fulfillGiftOrder } from "../src/lib/gifts/service";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("GIFT_CARDS_ENABLED", "true");
  vi.stubEnv("GIFT_ENCRYPTION_KEY", "b".repeat(64));
  state.order = {
    id: "order",
    amount: 5000,
    currency: "eur",
    livemode: false,
    status: "checkout",
    session_id: "cs_gift",
    stripe_price_id: "price_gift",
    stripe_product_id: "prod_gift",
  };
  state.session = {
    id: "cs_gift",
    client_reference_id: "order",
    metadata: { gift_order_id: "order" },
    mode: "payment",
    livemode: false,
    status: "complete",
    payment_status: "paid",
    amount_subtotal: 5000,
    amount_total: 5000,
    currency: "eur",
    payment_intent: "pi_gift",
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
  };
  state.line = {
    quantity: 1,
    price: { id: "price_gift", product: "prod_gift" },
  };
  state.pi = {
    id: "pi_gift",
    livemode: false,
    status: "succeeded",
    amount_received: 5000,
    currency: "eur",
    latest_charge: {
      id: "ch_gift",
      payment_intent: "pi_gift",
      livemode: false,
      paid: true,
      amount: 5000,
      currency: "eur",
      created: 1700000000,
      refunded: false,
      disputed: false,
      amount_refunded: 0,
    },
  };
  state.rpc.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("issues only after verifying the saved session, line item, PaymentIntent and charge", async () => {
  expect(await fulfillGiftOrder("order")).toEqual({ status: "issued" });
  expect(state.rpc).toHaveBeenCalledWith("gift_issue_paid_order", {
    input: expect.objectContaining({
      amount: 5000,
      payment_id: "pi_gift",
      paid_at: "2023-11-14T22:13:20.000Z",
      code_hash: expect.any(String),
      code_cipher: expect.any(String),
    }),
  });
});
it.each(["session", "amount", "price", "mode", "charge"])(
  "does not issue on a mismatching %s proof",
  async (kind) => {
    if (kind === "session") state.session.id = "other";
    if (kind === "amount") state.session.amount_total = 1;
    if (kind === "price") state.line.price.id = "other";
    if (kind === "mode") state.pi.livemode = true;
    if (kind === "charge") state.pi.latest_charge.paid = false;
    await expect(fulfillGiftOrder("order")).rejects.toThrow();
    expect(state.rpc).not.toHaveBeenCalled();
  },
);
it("does not create a code while payment is pending", async () => {
  state.session.payment_status = "unpaid";
  expect(await fulfillGiftOrder("order")).toEqual({
    status: "pending_payment",
  });
  expect(state.rpc).not.toHaveBeenCalled();
});
it("freezes refunded or disputed value instead of issuing a usable code", async () => {
  state.pi.latest_charge.refunded = true;
  expect(await fulfillGiftOrder("order")).toEqual({ status: "refunded" });
  expect(state.rpc).toHaveBeenCalledWith("gift_freeze_order", {
    input: { id: "order", status: "refunded", payment_id: "pi_gift" },
  });
});
