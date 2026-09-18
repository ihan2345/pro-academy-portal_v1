import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  session: {} as any,
  booking: {} as any,
  line: {} as any,
  payment: {} as any,
  retrievePayment: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../src/lib/camps/stripe", () => ({
  campStripe: () => ({
    checkout: {
      sessions: {
        retrieve: async () => f.session,
        listLineItems: async () => ({ has_more: false, data: [f.line] }),
      },
    },
    paymentIntents: { retrieve: f.retrievePayment },
  }),
}));
vi.mock("../src/lib/camps/runtime", () => ({ campPaymentMode: () => "live" }));
vi.mock("../src/lib/server/supabase", () => ({ sessionUser: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      const data =
        table === "camp_bookings"
          ? f.booking
          : table === "camps"
            ? { id: "camp", payment_mode: "live" }
            : table === "camp_installation"
              ? { live_payments_enabled: true }
              : [];
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data, error: null }),
        maybeSingle: async () => ({ data, error: null }),
        then: (resolve: any) =>
          Promise.resolve({ data, error: null }).then(resolve),
      };
      return chain;
    },
    rpc: f.rpc,
  }),
}));
import { confirmPayment } from "../src/lib/camps/service";
beforeEach(() => {
  vi.clearAllMocks();
  process.env.CAMP_LIVE_PAYMENTS_ENABLED = "true";
  f.booking = {
    id: "e0000000-0000-4000-8000-000000000001",
    camp_id: "camp",
    status: "draft",
    expected_amount: 20610,
    currency: "eur",
    benefit_percent: 15,
    stripe_price_id: "price_camp",
    stripe_payment_link_id: "plink_camp",
  };
  f.session = {
    id: "cs_live_free",
    livemode: true,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    client_reference_id: f.booking.id,
    currency: "eur",
    amount_subtotal: 20610,
    amount_total: 0,
    total_details: { amount_discount: 20610, amount_shipping: 0 },
    payment_intent: null,
    payment_link: "plink_camp",
  };
  f.line = { price: { id: "price_camp" }, quantity: 1 };
  f.rpc.mockImplementation(async (name, args) => ({
    data:
      name === "camp_occupied_seats"
        ? 0
        : {
            status: args.input.review_reason ? "review" : "paid",
            booking_id: f.booking.id,
          },
    error: null,
  }));
});
describe("Camp payment confirmation", () => {
  it("records a completed free Checkout for review without inventing a PaymentIntent or granting 100% entitlement", async () => {
    expect(await confirmPayment("cs_live_free", true)).toMatchObject({
      status: "review",
      no_cost: true,
    });
    expect(f.retrievePayment).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledWith("camp_confirm_payment", {
      input: expect.objectContaining({
        payment_id: "cs_live_free",
        proof_kind: "no_cost_checkout",
        total: 0,
        review_reason: "Verwendeter Rabatt passt nicht zum Abo-Anrecht",
      }),
    });
  });
  it.each([
    "wrong price",
    "wrong link",
    "wrong currency",
    "wrong quantity",
    "wrong subtotal",
    "incomplete",
    "unproven discount",
    "missing paid intent",
  ])("rejects %s even on a zero-cost path", async (change) => {
    if (change === "wrong price") f.line.price.id = "price_other";
    if (change === "wrong link") f.session.payment_link = "plink_other";
    if (change === "wrong currency") f.session.currency = "usd";
    if (change === "wrong quantity") f.line.quantity = 2;
    if (change === "wrong subtotal") f.session.amount_subtotal = 100;
    if (change === "incomplete") f.session.status = "open";
    if (change === "unproven discount")
      f.session.total_details.amount_discount = 100;
    if (change === "missing paid intent") f.session.amount_total = 17518;
    await expect(confirmPayment("cs_live_free", true)).rejects.toThrow(
      "Zahlung passt nicht",
    );
    expect(
      f.rpc.mock.calls.some(([name]) => name === "camp_confirm_payment"),
    ).toBe(false);
  });
  it("does not confirm an unpaid zero-total session", async () => {
    f.session.payment_status = "unpaid";
    expect(await confirmPayment("cs_live_free", true)).toMatchObject({
      status: "pending",
    });
    expect(
      f.rpc.mock.calls.some(([name]) => name === "camp_confirm_payment"),
    ).toBe(false);
  });
  it("still requires and verifies the charge for a normal discounted payment", async () => {
    f.session.payment_intent = "pi_paid";
    f.session.total_details.amount_discount = 3092;
    f.session.amount_total = 17518;
    f.retrievePayment.mockResolvedValue({
      livemode: true,
      status: "succeeded",
      currency: "eur",
      amount_received: 17518,
      latest_charge: {
        livemode: true,
        paid: true,
        currency: "eur",
        amount: 17518,
        payment_intent: "pi_paid",
      },
    });
    expect(await confirmPayment("cs_live_free", true)).toMatchObject({
      status: "paid",
      no_cost: false,
    });
    expect(f.rpc).toHaveBeenCalledWith("camp_confirm_payment", {
      input: expect.objectContaining({
        payment_id: "pi_paid",
        review_reason: null,
      }),
    });
    f.retrievePayment.mockResolvedValue({ latest_charge: null });
    await expect(confirmPayment("cs_live_free", true)).rejects.toThrow(
      "Zahlungsnachweis",
    );
  });
});
