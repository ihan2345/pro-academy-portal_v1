import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  role: "admin" as string,
  from: vi.fn(),
  rpc: vi.fn(),
  session: {} as any,
  lines: [] as any[],
  payment: {} as any,
}));
vi.mock("../src/lib/camps/service", () => ({
  campSession: async () => ({ role: f.role, user: { id: "actor" } }),
}));
vi.mock("../src/lib/camps/guard", () => ({
  requireCampAccess: async () => {},
}));
vi.mock("../src/lib/camps/processing", () => ({
  campReadStripe: () => ({
    paymentIntents: { retrieve: async () => f.payment },
    checkout: {
      sessions: {
        retrieve: async () => f.session,
        listLineItems: async () => ({ data: f.lines, has_more: false }),
      },
    },
  }),
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ from: f.from, rpc: f.rpc }),
}));
import {
  verifyFreeCampProof,
  freeApprovalSchema,
  freeCampReview,
  freeCampProof,
  approveFreeCampBooking,
} from "../src/lib/camps/free-review";
const uuid = "d0000000-0000-4000-8000-000000000001";
const booking = {
  id: uuid,
  camp_id: uuid,
  offer_id: uuid,
  status: "review",
  expected_amount: 22900,
  stripe_session_id: "cs_live_free",
  stripe_price_id: "price_free",
  stripe_payment_link_id: "plink_free",
  stripe_customer_id: "cus_free",
  currency: "eur",
};
const offer = {
  camp_id: uuid,
  stripe_price_id: "price_free",
  stripe_payment_link_id: "plink_free",
  stripe_product_id: "prod_free",
  amount: 22900,
};
const stripe: any = {
  paymentIntents: { retrieve: vi.fn(async () => f.payment) },
  checkout: {
    sessions: {
      retrieve: async () => f.session,
      listLineItems: async () => ({ data: f.lines, has_more: false }),
    },
  },
};
const draft = {
  camp_id: uuid,
  booking_id: uuid,
  special_discount_approved: true,
  notes: "Sonderrabatt für diesen Fall genehmigt",
  new_parent: { name: "Elternteil", email: "parent@example.invalid" },
  child: {
    first_name: "Kind",
    last_name: "Test",
    birth_date: "2015-01-01",
    gender: "keine Angabe",
    clothing_size: "140",
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  f.role = "admin";
  f.session = {
    id: "cs_live_free",
    created: 1790848800,
    livemode: true,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    payment_intent: null,
    currency: "eur",
    amount_subtotal: 22900,
    amount_total: 0,
    total_details: {
      amount_discount: 22900,
      amount_shipping: 0,
      amount_tax: 0,
    },
    client_reference_id: uuid,
    payment_link: "plink_free",
    customer: "cus_free",
  };
  f.lines = [
    { quantity: 1, price: { id: "price_free", product: "prod_free" } },
  ];
  f.from.mockImplementation((table) => {
    const q: any = {};
    for (const k of ["select", "eq", "is", "order"]) q[k] = () => q;
    q.maybeSingle = async () => ({
      data: table === "camp_bookings" ? booking : offer,
      error: null,
    });
    return q;
  });
  f.rpc.mockResolvedValue({ data: uuid, error: null });
});
it.each(["paid", "no_payment_required"])(
  "accepts complete 100%% checkouts with status %s and no PaymentIntent",
  async (status) => {
    f.session.payment_status = status;
    expect(await verifyFreeCampProof(stripe, booking, offer)).toMatchObject({
      total: 0,
      subtotal: 22900,
      discount: 22900,
      payment_intent: null,
    });
  },
);
it.each([
  ["subtotal", 100],
  ["amount_total", 1],
  ["status", "open"],
  ["mode", "subscription"],
  ["payment_status", "unpaid"],
  ["livemode", false],
  ["payment_intent", "pi_paid"],
  ["client_reference_id", "another-booking"],
  ["payment_link", "plink_other"],
  ["customer", "cus_other"],
])("rejects mismatching proof %s", async (key, value) => {
  if (key === "subtotal") f.session.amount_subtotal = value;
  else f.session[key] = value;
  await expect(verifyFreeCampProof(stripe, booking, offer)).rejects.toThrow(
    key === "payment_intent"
      ? "unerwarteter Zahlungsreferenz"
      : "keine passende",
  );
});
it("rejects wrong products, quantity and incomplete discounts", async () => {
  f.lines[0].price.product = "prod_other";
  await expect(verifyFreeCampProof(stripe, booking, offer)).rejects.toThrow();
  f.lines[0].price.product = "prod_free";
  f.lines[0].quantity = 2;
  await expect(verifyFreeCampProof(stripe, booking, offer)).rejects.toThrow();
  f.lines[0].quantity = 1;
  f.session.total_details.amount_discount = 20000;
  await expect(verifyFreeCampProof(stripe, booking, offer)).rejects.toThrow();
});
it.each(["staff", "parent"])(
  "blocks %s before database or Stripe reads",
  async (role) => {
    f.role = role;
    for (const action of [
      () => freeCampReview(uuid),
      () => freeCampProof(uuid),
      () => approveFreeCampBooking(draft),
    ])
      await expect(action()).rejects.toThrow("nur Admins");
    expect(f.from).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  },
);
it("requires explicit approval, a reason and an unambiguous family selection", () => {
  expect(freeApprovalSchema.safeParse(draft).success).toBe(true);
  for (const change of [
    { special_discount_approved: false },
    { notes: "" },
    { parent_id: uuid },
    { new_parent: null },
  ])
    expect(freeApprovalSchema.safeParse({ ...draft, ...change }).success).toBe(
      false,
    );
});
it("constructs proof on the server and ignores injected payment facts from the browser", async () => {
  await approveFreeCampBooking({
    ...draft,
    proof: { total: 999, session_id: "cs_forged" },
    actor_id: "forged",
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
    "camp_approve_discount_booking",
    {
      input: expect.objectContaining({
        actor_id: "actor",
        proof: expect.objectContaining({
          session_id: "cs_live_free",
          total: 0,
        }),
        child: expect.objectContaining({ age_recorded_on: "2026-10-01" }),
      }),
    },
  );
});

function partial(percent: number) {
  const discount = (22900 * percent) / 100;
  const total = 22900 - discount;
  f.session.amount_total = total;
  f.session.total_details.amount_discount = discount;
  f.session.payment_intent = "pi_partial";
  f.payment = {
    id: "pi_partial",
    livemode: true,
    status: "succeeded",
    currency: "eur",
    amount_received: total,
    latest_charge: {
      id: "ch_partial",
      livemode: true,
      paid: true,
      currency: "eur",
      amount: total,
      payment_intent: "pi_partial",
      refunded: false,
      amount_refunded: 0,
      disputed: false,
    },
  };
  return { total, discount };
}
it.each([1, 10, 50, 99])(
  "verifies %s%% discount and the actual successful remainder payment",
  async (percent) => {
    const amounts = partial(percent);
    expect(await verifyFreeCampProof(stripe, booking, offer)).toMatchObject({
      ...amounts,
      percent,
      payment_intent: "pi_partial",
      charge_id: "ch_partial",
      refunded: false,
      disputed: false,
    });
  },
);
it.each([
  "refunded",
  "partial_refund",
  "disputed",
  "failed",
  "amount",
  "foreign_charge",
  "unpaid",
])("blocks unsafe remainder payment: %s", async (change) => {
  partial(99);
  if (change === "refunded") f.payment.latest_charge.refunded = true;
  if (change === "partial_refund") f.payment.latest_charge.amount_refunded = 1;
  if (change === "disputed") f.payment.latest_charge.disputed = true;
  if (change === "failed") f.payment.status = "processing";
  if (change === "amount") f.payment.amount_received = 0;
  if (change === "foreign_charge")
    f.payment.latest_charge.payment_intent = "pi_other";
  if (change === "unpaid") f.session.payment_status = "no_payment_required";
  await expect(verifyFreeCampProof(stripe, booking, offer)).rejects.toThrow();
  await expect(approveFreeCampBooking(draft)).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalled();
});
it("binds a direct-link discount to the approved product, list price and absence of a portal reference", async () => {
  partial(99);
  f.session.client_reference_id = null;
  f.lines[0].price.unit_amount = 22900;
  const direct = { ...booking, booking_origin: "stripe_import" };
  expect(await verifyFreeCampProof(stripe, direct, offer)).toMatchObject({
    total: 229,
    percent: 99,
  });
  f.lines[0].price.unit_amount = 20000;
  await expect(verifyFreeCampProof(stripe, direct, offer)).rejects.toThrow();
  f.lines[0].price.unit_amount = 22900;
  f.session.client_reference_id = uuid;
  await expect(verifyFreeCampProof(stripe, direct, offer)).rejects.toThrow();
});
it("requires exactly one checkout or booking reference for special approval", () => {
  expect(
    freeApprovalSchema.safeParse({
      ...draft,
      booking_id: undefined,
      session_id: "cs_live_partial",
    }).success,
  ).toBe(true);
  expect(
    freeApprovalSchema.safeParse({ ...draft, booking_id: undefined }).success,
  ).toBe(false);
  expect(
    freeApprovalSchema.safeParse({ ...draft, session_id: "cs_live_partial" })
      .success,
  ).toBe(false);
});
it("rechecks direct-link proof server-side and uses only an approved camp source", async () => {
  partial(99);
  f.session.client_reference_id = null;
  f.lines[0].price.unit_amount = 22900;
  f.from.mockImplementation(() => {
    const q: any = {};
    for (const k of ["select", "eq"]) q[k] = () => q;
    q.maybeSingle = async () => ({
      data: {
        camp_id: uuid,
        payment_link_id: "plink_free",
        price_id: "price_free",
        product_id: "prod_free",
      },
      error: null,
    });
    return q;
  });
  await approveFreeCampBooking({
    ...draft,
    booking_id: undefined,
    session_id: "cs_live_free",
    proof: { total: 0 },
  });
  expect(f.rpc).toHaveBeenCalledWith("camp_approve_discount_booking", {
    input: expect.objectContaining({
      session_id: "cs_live_free",
      proof: expect.objectContaining({
        total: 229,
        discount: 22671,
        payment_intent: "pi_partial",
      }),
    }),
  });
});
