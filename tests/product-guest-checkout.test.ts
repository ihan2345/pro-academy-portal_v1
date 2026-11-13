import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { emptyProduct, visitorContext } from "../src/lib/products/domain";
const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  reads: [] as string[],
  rpc: [] as any[],
  stripe: {} as any,
  product: {} as any,
  context: null as any,
  benefit: 0,
  giftCredit: 0,
  knownParent: false,
  lookupError: false,
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      state.reads.push(table);
      let patch: any,
        single = false;
      const filters: any[] = [];
      const b: any = {
        select: () => b,
        eq: (k: string, v: any) => {
          filters.push((r: any) => r[k] === v);
          return b;
        },
        in: (k: string, values: any[]) => {
          filters.push((r: any) => values.includes(r[k]));
          return b;
        },
        neq: (k: string, v: any) => {
          filters.push((r: any) => r[k] !== v);
          return b;
        },
        is: (k: string, v: any) => {
          filters.push((r: any) => (r[k] ?? null) === v);
          return b;
        },
        update: (p: any) => {
          patch = p;
          return b;
        },
        single: () => {
          single = true;
          return b;
        },
        maybeSingle: () => {
          single = true;
          return b;
        },
        order: () => b,
        limit: () => b,
        gt: () => b,
        then: (resolve: any) => {
          const rows = (state.tables[table] ?? []).filter((r) =>
            filters.every((f) => f(r)),
          );
          if (patch) rows.forEach((r) => Object.assign(r, patch));
          return Promise.resolve({
            data: single ? (rows[0] ?? null) : rows,
            error: null,
          }).then(resolve);
        },
      };
      return b;
    },
    rpc: async (name: string, args: any) => {
      if (name === "parent_email_requires_login")
        return {
          data: state.knownParent,
          error: state.lookupError ? { message: "lookup unavailable" } : null,
        };
      state.rpc.push({ name, args });
      if (name === "reserve_product_purchase") {
        const i = {
          ...args.input,
          product: {
            ...state.product.published,
            price:
              args.input.camp_member_price ??
              args.input.booking_option_price ??
              state.product.published.price,
          },
          expected_amount: args.input.amount - state.giftCredit,
          expected_subtotal: (
            args.input.camp_member_price ??
            args.input.booking_option_price ??
            state.product.published.price
          ).amount,
          gift_credit_amount: state.giftCredit,
          expires_at: new Date(Date.now() + 1800000).toISOString(),
        };
        state.tables.product_purchase_intents.push(i);
        return { data: i, error: null };
      }
      throw Error("Unexpected RPC");
    },
  }),
}));
vi.mock("../src/lib/server/products/catalog", () => ({
  productById: async () => state.product,
}));
vi.mock("../src/lib/server/products/context", () => ({
  checked: (r: any) => {
    if (r.error) throw Error("DB");
    return r.data;
  },
  collect: async (make: any) => (await make()).data,
  loadProductContext: vi.fn(async () => state.context ?? visitorContext()),
}));
vi.mock("../src/lib/server/products/stripe", () => ({
  productStripe: () => state.stripe,
  verifyStoredPrice: async (p: any) => p.price,
}));
vi.mock("../src/lib/server/products/booking-option", () => ({
  bookingOptionPrice: async (p: any) => ({
    ...p.price,
    id: "price_camp_option",
    amount: p.booking_option.amount,
  }),
}));
vi.mock("../src/lib/camps/service", () => ({
  childBenefit: async () => ({ percent: state.benefit }),
}));
vi.mock("../src/lib/server/products/camp-member-price", () => ({
  campMemberPrice: async (base: any, percent: number) => ({
    ...base,
    id: "price_member",
    amount: base.amount - Math.round((base.amount * percent) / 100),
    source: "stripe",
  }),
}));
vi.mock("../src/lib/server/stripe", () => ({ syncSubscription: vi.fn() }));
import { checkoutProduct } from "../src/lib/server/products/checkout";
const productId = "90000000-0000-4000-8000-000000000001",
  requestId = "90000000-0000-4000-8000-000000000002";
const form = {
  request_id: requestId,
  guest_parent: { full_name: "Neue Familie", email: "family@example.invalid" },
  new_child: {
    first_name: "Neues",
    last_name: "Kind",
    birth_date: "2016-01-01",
  },
};
beforeEach(() => {
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3110");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
  vi.stubEnv("PRODUCT_MANAGEMENT_ENABLED", "true");
  vi.stubEnv("PRODUCT_PAYMENTS_ENABLED", "true");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "local-test-only-hash-secret");
  state.tables = { product_purchase_intents: [] };
  state.context = null;
  state.benefit = 0;
  state.giftCredit = 0;
  state.reads = [];
  state.rpc = [];
  state.knownParent = false;
  state.lookupError = false;
  const product = {
    ...emptyProduct(),
    status: "active",
    kind: "other",
    channels: ["catalog"],
    price: {
      id: "price_test",
      product_id: "prod_test",
      amount: 9900,
      currency: "eur",
      livemode: false,
    },
  };
  state.product = { id: productId, published: product, published_revision: 1 };
  state.stripe = {
    customers: {
      create: vi.fn(async () => ({ id: "cus_guest", livemode: false })),
    },
    checkout: {
      sessions: {
        create: vi.fn(async () => ({
          id: "cs_test_guest",
          livemode: false,
          url: "https://checkout.stripe.com/c/pay/cs_test_guest",
        })),
      },
    },
    promotionCodes: {
      list: vi.fn(async () => ({
        data: [
          {
            id: "promo_public",
            code: "START",
            active: true,
            livemode: false,
            customer: null,
            restrictions: {},
            coupon: {
              id: "coupon_public",
              valid: true,
              percent_off: 20,
              amount_off: null,
              duration: "once",
              duration_in_months: null,
            },
          },
        ],
      })),
    },
  };
});
afterEach(() => vi.unstubAllEnvs());
it("reserves unregistered parent/child data and opens Checkout without creating any portal identity", async () => {
  const r = await checkoutProduct(null, productId, form, "a".repeat(64));
  expect(r.url).toContain("checkout.stripe.com");
  expect(state.reads).not.toContain("parents");
  expect(state.reads).not.toContain("players");
  expect(state.reads).not.toContain("profiles");
  const input = state.rpc.find((r) => r.name === "reserve_product_purchase")
    .args.input;
  expect(input).toMatchObject({
    parent_id: null,
    auth_id: undefined,
    guest_data: form.guest_parent,
    guest_token_hash: "a".repeat(64),
    player_data: form.new_child,
    amount: 9900,
  });
  expect(state.stripe.checkout.sessions.create.mock.calls[0][0]).toMatchObject({
    customer: "cus_guest",
    client_reference_id: requestId,
    mode: "payment",
  });
});
it("reserves the discounted total and applies exactly the checked Stripe promotion", async () => {
  await checkoutProduct(
    null,
    productId,
    { ...form, discount_code: "START" },
    "a".repeat(64),
  );
  expect(state.rpc[0].args.input).toMatchObject({
    amount: 7920,
    discount: { promotion_id: "promo_public", amount: 7920 },
  });
  expect(
    state.stripe.checkout.sessions.create.mock.calls[0][0].discounts,
  ).toEqual([{ promotion_code: "promo_public" }]);
});
it("rejects forged existing identities and missing guest details before creating payment resources", async () => {
  await expect(
    checkoutProduct(
      null,
      productId,
      { ...form, player_id: productId },
      "a".repeat(64),
    ),
  ).rejects.toThrow(/Gastbestellung/);
  await expect(
    checkoutProduct(
      null,
      productId,
      { request_id: requestId, new_child: form.new_child },
      "a".repeat(64),
    ),
  ).rejects.toThrow(/Gastbestellung/);
  expect(state.stripe.customers.create).not.toHaveBeenCalled();
  expect(state.rpc).toEqual([]);
});
it("does not grant member-only eligibility to a guest with a claimed membership email", async () => {
  state.product.published.rules.purchase.clauses[0].include = ["subscriber"];
  await expect(
    checkoutProduct(null, productId, form, "a".repeat(64)),
  ).rejects.toThrow();
  expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
});
it("blocks manually entered camp membership codes even when their Stripe coupon is public", async () => {
  state.tables.camp_offers = [{ id: productId, codes: { "20": "START" } }];
  await expect(
    checkoutProduct(
      null,
      productId,
      { ...form, discount_code: "START" },
      "a".repeat(64),
    ),
  ).rejects.toThrow(/Mitgliederrabatte/);
  expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
});
it("releases only definitively rejected Checkout creation, while retaining ambiguous remote attempts", async () => {
  state.stripe.checkout.sessions.create.mockRejectedValueOnce(
    new Stripe.errors.StripeInvalidRequestError({
      message: "promotion expired",
      type: "invalid_request_error",
    }),
  );
  await expect(
    checkoutProduct(
      null,
      productId,
      { ...form, discount_code: "START" },
      "a".repeat(64),
    ),
  ).rejects.toThrow(/Rabattcode/);
  expect(state.tables.product_purchase_intents[0].status).toBe("expired");
  state.tables.product_purchase_intents = [];
  state.stripe.checkout.sessions.create.mockRejectedValueOnce(
    Error("connection lost after remote create"),
  );
  await expect(
    checkoutProduct(null, productId, form, "a".repeat(64)),
  ).rejects.toThrow(/connection lost/);
  expect(state.tables.product_purchase_intents[0].status).not.toBe("expired");
});

it.each([
  [7900, true],
  [19900, true],
  [19900, false],
])(
  "uses the selected Camp price %i (code: %s) while retaining the original offer identity",
  async (optionAmount, withCode) => {
    const offer = {
      id: productId,
      camp_id: requestId,
      kind: "main",
      stripe_price_id: "price_test",
      stripe_product_id: "prod_test",
      amount: 9900,
      currency: "eur",
      codes: {},
    };
    const camp = {
      id: requestId,
      title: "Testcamp",
      status: "open",
      payment_mode: "test",
      min_age: 5,
      max_age: 18,
      early_bird_until: null,
      days: [{ starts_at: new Date(Date.now() + 86400000 * 30).toISOString() }],
      camp_offers: [offer],
      booking_option: {
        amount: optionAmount,
        title: "Tagesoption",
        description: "Ein Tag",
        alert: "Tag abstimmen",
      },
      booking_option_version: 1,
    };
    state.tables.camp_offers = [{ ...offer, camps: camp }];
    state.tables.camps = [camp];
    state.product.published = {
      ...state.product.published,
      kind: "camp",
      camp_offer_id: productId,
      booking_option: {
        amount: optionAmount,
        title: "Tagesoption",
        description: "Ein Tag",
        alert: "Tag abstimmen",
      },
    };
    await checkoutProduct(
      null,
      productId,
      {
        ...form,
        booking_option_selected: true,
        booking_option_revision: 1,
        booking_option_version: 1,
        ...(withCode ? { discount_code: "START" } : {}),
        camp_details: {
          birth_date: form.new_child.birth_date,
          gender: "keine Angabe",
          clothing_size: "M",
        },
      },
      "a".repeat(64),
    );
    expect(
      state.rpc.find((r) => r.name === "reserve_product_purchase").args.input,
    ).toMatchObject({
      camp_offer_id: productId,
      booking_option_selected: true,
      booking_option_price: { id: "price_camp_option", amount: optionAmount },
      amount: withCode ? Math.round(optionAmount * 0.8) : optionAmount,
      ...(withCode
        ? {
            discount: {
              amount: Math.round(optionAmount * 0.8),
              promotion_id: "promo_public",
            },
          }
        : {}),
    });
    expect(
      state.stripe.checkout.sessions.create.mock.calls[0][0],
    ).toMatchObject({
      line_items: [{ price: "price_camp_option", quantity: 1 }],
      ...(withCode ? { discounts: [{ promotion_code: "promo_public" }] } : {}),
    });
  },
);
it("rejects stale selected options before opening Checkout", async () => {
  await expect(
    checkoutProduct(
      null,
      productId,
      { ...form, booking_option_selected: true, booking_option_revision: 99 },
      "a".repeat(64),
    ),
  ).rejects.toThrow(/Buchungsoption wurde geändert/);
  expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
});

it("stops an existing family before reserving or creating a Stripe payment", async () => {
  state.knownParent = true;
  await expect(
    checkoutProduct(null, productId, form, "a".repeat(64)),
  ).rejects.toThrow(/aktiviere deinen Zugang/);
  expect(state.rpc).toHaveLength(0);
  expect(state.stripe.customers.create).not.toHaveBeenCalled();
  expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
});
it("fails closed if the pre-payment family lookup is unavailable", async () => {
  state.lookupError = true;
  await expect(
    checkoutProduct(null, productId, form, "a".repeat(64)),
  ).rejects.toMatchObject({ status: 503 });
  expect(state.rpc).toHaveLength(0);
  expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
});

it.each([0, 5000])(
  "applies a normal Stripe promotion after the Camp member benefit, keeping %i PA credit separate",
  async (giftCredit) => {
    state.giftCredit = giftCredit;
    vi.stubEnv("GIFT_CARDS_ENABLED", "true");
    vi.stubEnv("GIFT_ENCRYPTION_KEY", "local-test-only-gift-key-32-characters");
    const parentId = "90000000-0000-4000-8000-000000000005",
      kid = "90000000-0000-4000-8000-000000000006",
      uid = "90000000-0000-4000-8000-000000000007";
    state.context = {
      ...visitorContext(),
      auth_id: uid,
      role: "parent",
      parent_id: parentId,
      children: [
        {
          id: kid,
          first_name: "Kind",
          last_name: "Test",
          birth_date: "2016-01-01",
          memberships: [],
          camp_ids: [],
          purchases: [],
        },
      ],
    };
    state.benefit = 20;
    const offer = {
      id: productId,
      camp_id: requestId,
      kind: "main",
      stripe_price_id: "price_test",
      stripe_product_id: "prod_test",
      amount: 20000,
      currency: "eur",
      codes: { "20": "ABO20" },
    };
    const camp = {
      id: requestId,
      title: "Camp",
      status: "open",
      payment_mode: "test",
      member_benefits_enabled: true,
      min_age: 5,
      max_age: 18,
      early_bird_until: null,
      days: [{ starts_at: new Date(Date.now() + 30 * 86400000).toISOString() }],
      camp_offers: [offer],
    };
    state.tables.camps = [camp];
    state.tables.camp_offers = [{ ...offer, camps: camp }];
    state.tables.parents = [
      {
        id: parentId,
        full_name: "Testfamilie",
        contact_email: "test@example.invalid",
      },
    ];
    state.tables.parent_stripe_customers = [];
    state.product.published = {
      ...state.product.published,
      kind: "camp",
      camp_offer_id: productId,
      price: { ...state.product.published.price, amount: 20000 },
    };
    state.stripe.promotionCodes.list.mockImplementation(
      async ({ code }: any) => ({
        data: [
          {
            id: code === "ABO20" ? "promo_member" : "promo_public",
            code,
            active: true,
            livemode: false,
            customer: null,
            restrictions: {},
            coupon: {
              id: "coupon",
              valid: true,
              percent_off: code === "ABO20" ? 20 : 10,
              amount_off: null,
              duration: "once",
              duration_in_months: null,
            },
          },
        ],
      }),
    );
    await checkoutProduct(
      {
        role: "parent",
        user: { id: uid, email_confirmed_at: new Date().toISOString() },
      } as any,
      productId,
      {
        request_id: requestId,
        player_id: kid,
        discount_code: "START",
        gift_code: "PA-" + "A".repeat(24),
        camp_details: {
          birth_date: "2016-01-01",
          gender: "keine Angabe",
          clothing_size: "140",
        },
      },
    );
    const saved = state.rpc.find((r) => r.name === "reserve_product_purchase")
      .args.input;
    expect(saved).toMatchObject({
      amount: 14400,
      benefit_percent: 20,
      camp_member_price: { id: "price_member", amount: 16000 },
      discount: { promotion_id: "promo_public", amount: 14400, source: "code" },
    });
    expect(saved.gift_code_hash).toBeTruthy();
    const checkout = state.stripe.checkout.sessions.create.mock.calls[0][0];
    if (giftCredit) {
      expect(checkout).toMatchObject({
        line_items: [{ price_data: { unit_amount: 9400 }, quantity: 1 }],
        metadata: { gift_payment: "invoice_v1" },
      });
      expect(checkout.discounts).toBeUndefined(); // Promotion is applied once on the final service invoice.
    } else
      expect(checkout).toMatchObject({
        line_items: [{ price: "price_member", quantity: 1 }],
        discounts: [{ promotion_code: "promo_public" }],
      });
  },
);
