import { beforeEach, afterEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  billing: {} as any,
  rpc: vi.fn(),
  writes: [] as any[],
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    rpc: state.rpc,
    from: (table: string) => {
      const q: any = {
        update: (value: any) => {
          state.writes.push({ table, value });
          return q;
        },
        upsert: (value: any) => {
          state.writes.push({ table, value });
          return q;
        },
        select: () => q,
        maybeSingle: async () => ({ data: state.billing, error: null }),
        eq: () => q,
        neq: () => q,
        then: (resolve: any) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return q;
    },
  }),
}));
import { reconcileGiftRefund } from "../src/lib/gifts/refunds";
import {
  giftCheckoutParams,
  nativeGiftPayment,
} from "../src/lib/gifts/billing";
let i: any,
  session: any,
  invoice: any,
  record: any,
  stripe: any,
  allocations: any[],
  pi: any;
beforeEach(() => {
  vi.clearAllMocks();
  state.writes = [];
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("GIFT_CARDS_ENABLED", "true");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3115");
  i = {
    id: "intent",
    customer_id: "cus_own",
    parent_id: "parent",
    session_id: "cs_own",
    currency: "eur",
    expected_amount: 4000,
    expected_subtotal: 10000,
    gift_credit_amount: 5000,
    expires_at: new Date(Date.now() + 1860000).toISOString(),
    discount: { promotion_id: "promo_real", duration: "forever", amount: 9000 },
    product: {
      name: "Tarif",
      kind: "subscription",
      price: {
        id: "price_original",
        product_id: "prod_original",
        amount: 10000,
      },
    },
  };
  session = {
    id: "cs_own",
    mode: "payment",
    livemode: false,
    status: "complete",
    payment_status: "paid",
    customer: "cus_own",
    created: 1700000000,
    client_reference_id: i.id,
    metadata: { product_intent_id: i.id, gift_payment: "invoice_v1" },
    amount_subtotal: 4000,
    amount_total: 4000,
    currency: "eur",
    payment_intent: "pi_cash",
    total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
  };
  pi = {
    id: "pi_cash",
    customer: "cus_own",
    payment_method: "pm_saved",
    livemode: false,
    status: "succeeded",
    amount_received: 4000,
    currency: "eur",
    latest_charge: {
      livemode: false,
      amount: 4000,
      paid: true,
      refunded: false,
      disputed: false,
      amount_refunded: 0,
    },
  };
  invoice = {
    id: "in_own",
    livemode: false,
    customer: "cus_own",
    currency: "eur",
    status: "draft",
    total: 9000,
    amount_paid: 0,
    amount_remaining: 9000,
    total_taxes: [
      {
        amount: 639,
        type: "tax_rate_details",
        tax_rate_details: { tax_rate: "txr_de19" },
      },
    ],
    parent: { subscription_details: { subscription: "sub_own" } },
  };
  state.billing = {
    intent_id: i.id,
    livemode: false,
    started_at: new Date().toISOString(),
    invoice_id: null,
    subscription_id: null,
    payment_record_id: null,
    state: "preparing",
  };
  state.rpc.mockImplementation(async () => ({
    data: state.billing,
    error: null,
  }));
  record = {
    id: "pr_own",
    livemode: false,
    amount_guaranteed: { currency: "eur", value: 5000 },
    amount_refunded: { value: 0 },
    processor_details: { custom: { payment_reference: i.id } },
  };
  allocations = [
    {
      livemode: false,
      currency: "eur",
      amount_paid: 5000,
      payment: { type: "payment_record", payment_record: "pr_own" },
    },
    {
      livemode: false,
      currency: "eur",
      amount_paid: 4000,
      payment: { type: "payment_intent", payment_intent: "pi_cash" },
    },
  ];
  const sub = () => ({
    id: "sub_own",
    livemode: false,
    status: "active",
    customer: "cus_own",
    latest_invoice: invoice,
    items: {
      has_more: false,
      data: [{ id: "si_own", price: { id: "price_original" } }],
    },
  });
  stripe = {
    checkout: {
      sessions: {
        retrieve: vi.fn(async () => session),
        listLineItems: vi.fn(async () => ({
          has_more: false,
          data: [
            {
              quantity: 1,
              price: {
                unit_amount: i.expected_amount,
                product: {
                  id: "prod_cash",
                  metadata: {
                    product_intent_id: i.id,
                    original_price_id: "price_original",
                  },
                },
              },
            },
          ],
        })),
      },
    },
    paymentIntents: { retrieve: vi.fn(async () => pi) },
    setupIntents: {
      retrieve: vi.fn(async () => ({
        status: "succeeded",
        livemode: false,
        customer: "cus_own",
        payment_method: "pm_saved",
      })),
    },
    taxRates: {
      list: async function* () {
        yield {
          id: "txr_de19",
          livemode: false,
          percentage: 19,
          inclusive: true,
          country: "DE",
          metadata: { pa_gift: "de_19_inclusive" },
        };
      },
    },
    products: {
      retrieve: async (id: string) => ({
        id,
        active: true,
        livemode: false,
        metadata: {
          pa_gift_component: id.endsWith("vat_clearing")
            ? "vat_clearing"
            : "prepaid_value",
        },
      }),
    },
    subscriptions: {
      create: vi.fn(async () => sub()),
      retrieve: vi.fn(async () => sub()),
      update: vi.fn(async () => sub()),
    },
    invoices: {
      create: vi.fn(async () => invoice),
      retrieve: vi.fn(async () => invoice),
      finalizeInvoice: vi.fn(async () => ({ ...invoice, status: "open" })),
      attachPayment: vi.fn(async () => {
        invoice = {
          ...invoice,
          status: "paid",
          amount_paid: 9000,
          amount_remaining: 0,
        };
        return invoice;
      }),
    },
    invoiceItems: { create: vi.fn(async () => ({})) },
    invoicePayments: {
      list: async function* () {
        for (const p of allocations) yield p;
      },
    },
    rawRequest: vi.fn(async (method: string, path: string) => {
      if (path.endsWith("attach_payment")) {
        invoice = {
          ...invoice,
          status: i.expected_amount ? "open" : "paid",
          amount_paid: i.gift_credit_amount,
          amount_remaining: i.expected_amount,
        };
        return invoice;
      }
      return record;
    }),
  };
});
afterEach(() => vi.unstubAllEnvs());
it("collects only the explicit top-up and obtains a future payment method for a fully gift-funded subscription", () => {
  const partial = giftCheckoutParams(i, "cus_own");
  expect(partial.mode).toBe("payment");
  expect(partial.payment_intent_data?.setup_future_usage).toBe("off_session");
  expect(partial.discounts).toBeUndefined();
  expect(partial.line_items?.[0].price_data?.unit_amount).toBe(4000);
  i.expected_amount = 0;
  expect(giftCheckoutParams(i, "cus_own").mode).toBe("setup");
  i.product.kind = "camp";
  expect(giftCheckoutParams(i, "cus_own").mode).toBe("payment");
});
it("settles the full invoice with a separate gift payment, preserves the recurring price and promotion, then restores automatic billing", async () => {
  const result = await nativeGiftPayment(i, stripe);
  expect(result).toMatchObject({
    paymentId: "in_own",
    proof: { total: 4000, gift_invoice_total: 9000, gift_credit_amount: 5000 },
  });
  const params = stripe.subscriptions.create.mock.calls[0][0];
  expect(params.collection_method).toBe("send_invoice");
  expect(params.items).toEqual([
    {
      price: "price_original",
      quantity: 1,
      tax_rates: ["txr_de19"],
      discounts: [{ promotion_code: "promo_real" }],
    },
  ]);
  expect(
    params.add_invoice_items.map((p: any) => p.price_data.unit_amount),
  ).toEqual([-5000, 5000]);
  expect(stripe.subscriptions.update).toHaveBeenCalledWith(
    "sub_own",
    {
      collection_method: "charge_automatically",
      default_payment_method: "pm_saved",
      metadata: { pa_gift_pending: "" },
    },
    expect.anything(),
  );
  expect(state.billing.state).toBe("settled");
  await nativeGiftPayment(i, stripe);
  expect(stripe.subscriptions.create).toHaveBeenCalledTimes(1);
  expect(
    stripe.rawRequest.mock.calls.filter((c: any) =>
      c[1].endsWith("report_payment"),
    ),
  ).toHaveLength(1);
});
it("does not activate a subscription or consume credit while the top-up is pending", async () => {
  session.status = "open";
  expect(await nativeGiftPayment(i, stripe)).toEqual({
    status: "pending_payment",
  });
  expect(state.rpc).not.toHaveBeenCalled();
  expect(stripe.subscriptions.create).not.toHaveBeenCalled();
});
it("rejects a changed top-up before creating an invoice", async () => {
  session.amount_total = 1;
  await expect(nativeGiftPayment(i, stripe)).rejects.toThrow(/Zuzahlung/);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("does not recreate financial objects after an uncertain idempotency window", async () => {
  state.billing.started_at = new Date(Date.now() - 24 * 3600000).toISOString();
  await expect(nativeGiftPayment(i, stripe)).rejects.toThrow(/zweite Rechnung/);
  expect(stripe.subscriptions.create).not.toHaveBeenCalled();
});
it("rejects a fully paid invoice whose payments belong to someone else", async () => {
  allocations[1].payment.payment_intent = "pi_other";
  await expect(nativeGiftPayment(i, stripe)).rejects.toThrow(
    /fremde Zahlungen/,
  );
  expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  expect(state.billing.state).toBe("preparing");
});
it("creates one-off clearing lines only on its dedicated draft invoice", async () => {
  i.product.kind = "camp";
  invoice.parent = null;
  await nativeGiftPayment(i, stripe);
  expect(
    stripe.invoices.create.mock.calls[0][0].pending_invoice_items_behavior,
  ).toBe("exclude");
  expect(stripe.invoiceItems.create).toHaveBeenCalledTimes(3);
  for (const [params] of stripe.invoiceItems.create.mock.calls)
    expect(params.invoice).toBe("in_own");
  expect(stripe.subscriptions.create).not.toHaveBeenCalled();
});

it("returns a fully gift-funded purchase only through an explicit admin return or verified Stripe return", async () => {
  i.expected_amount = 0;
  invoice.total = 5000;
  invoice.total_taxes = [];
  state.billing = {
    ...state.billing,
    state: "settled",
    invoice_id: "in_own",
    payment_record_id: "pr_own",
    return_started_at: new Date().toISOString(),
  };
  stripe.creditNotes = {
    list: async function* () {},
    create: vi.fn(async () => ({
      id: "cn_own",
      livemode: false,
      currency: "eur",
      amount: 5000,
    })),
  };
  expect(await reconcileGiftRefund(i, stripe)).toBe(false);
  stripe.rawRequest = vi.fn(async (_m: string, path: string) => {
    if (path.endsWith("report_refund")) record.amount_refunded.value = 5000;
    return record;
  });
  expect(await reconcileGiftRefund(i, stripe, true)).toBe(true);
  expect(state.rpc).toHaveBeenCalledWith("gift_complete_return", {
    input: expect.objectContaining({
      id: "intent",
      record_id: "pr_own",
      credit_note_id: "cn_own",
      amount: 5000,
    }),
  });
  expect(stripe.creditNotes.create.mock.calls[0][0]).toMatchObject({
    out_of_band_amount: 5000,
    email_type: "none",
  });
});
it("does not return gift value while a cash top-up has not been refunded", async () => {
  state.billing = {
    ...state.billing,
    state: "settled",
    cash_payment_id: "pi_cash",
    payment_record_id: "pr_own",
  };
  await expect(reconcileGiftRefund(i, stripe, true)).rejects.toThrow(
    /Zuzahlung/,
  );
  expect(stripe.rawRequest.mock.calls.some((c: any) => c[0] === "POST")).toBe(
    false,
  );
});
it("links an existing full cash refund and returns the gift without creating a second cash refund", async () => {
  state.billing = {
    ...state.billing,
    state: "settled",
    invoice_id: "in_own",
    payment_record_id: "pr_own",
    cash_payment_id: "pi_cash",
    return_started_at: new Date().toISOString(),
  };
  pi.latest_charge.refunded = true;
  pi.latest_charge.amount_refunded = 4000;
  stripe.refunds = {
    list: async function* () {
      yield { id: "re_cash", status: "succeeded", amount: 4000 };
    },
  };
  stripe.creditNotes = {
    list: async function* () {},
    create: vi.fn(async () => ({
      id: "cn_own",
      livemode: false,
      currency: "eur",
      amount: 9000,
      total_taxes: invoice.total_taxes,
    })),
  };
  stripe.rawRequest = vi.fn(async (_m: string, path: string) => {
    if (path.endsWith("report_refund")) record.amount_refunded.value = 5000;
    return record;
  });
  expect(await reconcileGiftRefund(i, stripe)).toBe(true);
  expect(stripe.creditNotes.create.mock.calls[0][0]).toMatchObject({
    out_of_band_amount: 5000,
    refunds: [{ refund: "re_cash", amount_refunded: 4000 }],
  });
});
it("does not repeat an already completed return", async () => {
  state.billing.state = "returned";
  expect(await reconcileGiftRefund(i, stripe, true)).toBe(true);
  expect(stripe.rawRequest).not.toHaveBeenCalled();
});

it("settles a member-priced Camp with its real Stripe promotion and additional PA credit", async () => {
  i.product.kind = "camp";
  i.product.camp_member_base_price = { ...i.product.price, amount: 20000 };
  i.product.camp_member_percent = 20;
  i.product.price = { ...i.product.price, id: "price_member", amount: 16000 };
  i.expected_subtotal = 16000;
  i.expected_amount = 9400;
  i.discount = { ...i.discount, promotion_id: "promo_normal10", amount: 14400 };
  session.amount_subtotal = 9400;
  session.amount_total = 9400;
  pi.amount_received = 9400;
  pi.latest_charge.amount = 9400;
  invoice.parent = null;
  invoice.total = 14400;
  invoice.amount_remaining = 14400;
  allocations[1].amount_paid = 9400;
  stripe.invoices.attachPayment.mockImplementation(async () => {
    invoice = {
      ...invoice,
      status: "paid",
      amount_paid: 14400,
      amount_remaining: 0,
    };
    return invoice;
  });
  stripe.checkout.sessions.listLineItems.mockResolvedValue({
    has_more: false,
    data: [
      {
        quantity: 1,
        price: {
          unit_amount: 9400,
          product: {
            id: "prod_cash",
            metadata: {
              product_intent_id: i.id,
              original_price_id: "price_member",
            },
          },
        },
      },
    ],
  });
  const result = await nativeGiftPayment(i, stripe);
  expect(result).toMatchObject({
    proof: {
      subtotal: 16000,
      total: 9400,
      gift_invoice_total: 14400,
      gift_credit_amount: 5000,
      price_id: "price_member",
    },
  });
  expect(stripe.invoiceItems.create.mock.calls[0][0]).toMatchObject({
    pricing: { price: "price_member" },
    discounts: [{ promotion_code: "promo_normal10" }],
  });
  expect(stripe.subscriptions.create).not.toHaveBeenCalled();
});
