import { beforeEach, it, expect, vi } from "vitest";
import { importDirectCampPayment } from "../src/lib/camps/automatic-import";
import { prepareCampImport } from "../src/lib/camps/import-core";

const camp = "a0000000-0000-4000-8000-000000000001";
const token = "a0000000-0000-4000-8000-000000000002";
let session: any, charge: any, payment: any, stripe: any, db: any;
let tables: Record<string, any>;
const record = () => ({
  camp_id: camp,
  payment_id: "pi_age",
  session_id: "cs_live_age",
  booking_reference: null,
  status: "paid",
  child_name: "Mehmet Tahir Kaya",
  age_at_booking: "8",
  clothing_size: "152",
  issues: [] as string[],
});
beforeEach(() => {
  session = {
    id: "cs_live_age",
    created: Date.parse("2026-09-30T22:30:00Z") / 1000,
    livemode: true,
    mode: "payment",
    payment_status: "paid",
    payment_intent: "pi_age",
    payment_link: "plink_age",
    currency: "eur",
    amount_total: 20610,
    amount_subtotal: 20610,
    customer: "cus_age",
    customer_details: {
      name: "Havva Kaya",
      email: "havva@example.invalid",
      phone: "123456",
    },
    custom_fields: [],
  };
  charge = {
    livemode: true,
    paid: true,
    payment_intent: "pi_age",
    currency: "eur",
    refunded: false,
    amount_refunded: 0,
    disputed: false,
    amount: 20610,
    created: session.created,
  };
  payment = {
    id: "pi_age",
    livemode: true,
    status: "succeeded",
    amount_received: 20610,
    currency: "eur",
    latest_charge: charge,
  };
  stripe = {
    checkout: {
      sessions: {
        retrieve: vi.fn(async () => session),
        listLineItems: vi.fn(async () => ({
          has_more: false,
          data: [
            { quantity: 1, price: { id: "price_age", product: "prod_age" } },
          ],
        })),
      },
    },
    paymentIntents: { retrieve: vi.fn(async () => payment) },
  };
  tables = {
    camp_stripe_sources: {
      camp_id: camp,
      payment_link_id: "plink_age",
      price_id: "price_age",
      product_id: "prod_age",
    },
  };
  db = {
    rpc: vi.fn(async () => ({ data: "booking", error: null })),
    from: vi.fn((table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: tables[table] ?? null, error: null }),
        maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
      };
      return chain;
    }),
  };
});
it("rechecks Stripe payment and sends dated age and identity to the atomic importer", async () => {
  await importDirectCampPayment(db, stripe, record(), token);
  expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_live_age");
  expect(db.rpc).toHaveBeenCalledWith("camp_import_review_booking", {
    input: expect.objectContaining({
      automatic: true,
      processing_token: token,
      actor_id: null,
      customer_id: "cus_age",
      parent: {
        name: "Havva Kaya",
        email: "havva@example.invalid",
        phone: "123456",
      },
      child: {
        first_name: "Mehmet Tahir",
        last_name: "Kaya",
        age_at_booking: 8,
        age_recorded_on: "2026-10-01",
        gender: "keine Angabe",
        clothing_size: "152",
      },
    }),
  });
});
it.each(["review", "refunded"])(
  "does not auto import %s payments",
  async (status) => {
    await importDirectCampPayment(db, stripe, { ...record(), status }, token);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  },
);
it("does not duplicate imported/removed bookings, portal references or manual drafts", async () => {
  tables.camp_bookings = { id: "removed" };
  await importDirectCampPayment(db, stripe, record(), token);
  delete tables.camp_bookings;
  tables.camp_review_drafts = { payment_id: "pi_age" };
  const row = record();
  await importDirectCampPayment(db, stripe, row, token);
  expect(row.issues[0]).toContain("Prüfentwurf");
  await importDirectCampPayment(
    db,
    stripe,
    { ...record(), booking_reference: camp },
    token,
  );
  expect(db.rpc).not.toHaveBeenCalled();
});
it.each(["", "8 Jahre", "8.5", "-1", "100"])(
  "keeps invalid/missing age %s for manual correction",
  async (age) => {
    const row = { ...record(), age_at_booking: age };
    await importDirectCampPayment(db, stripe, row, token);
    expect(row.issues).toHaveLength(1);
    expect(db.rpc).not.toHaveBeenCalled();
  },
);
it("handles a payment refunded between scan and import per record", async () => {
  charge.refunded = true;
  const row = record();
  await importDirectCampPayment(db, stripe, row, token);
  expect(row.issues[0]).toContain(
    "Zahlung ist nicht uneingeschränkt bestätigt",
  );
  expect(db.rpc).not.toHaveBeenCalled();
});
it("rejects a charge belonging to another payment", async () => {
  charge.payment_intent = "pi_other";
  const row = record();
  await importDirectCampPayment(db, stripe, row, token);
  expect(row.issues).toHaveLength(1);
  expect(db.rpc).not.toHaveBeenCalled();
});
it("keeps ambiguous matches visible but propagates infrastructure errors", async () => {
  db.rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "P0001", message: "Familie nicht eindeutig" },
  });
  const row = record();
  await importDirectCampPayment(db, stripe, row, token);
  expect(row.issues).toEqual(["Familie nicht eindeutig"]);
  expect(row.status).toBe("paid");
  db.rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "PGRST202", message: "missing migration" },
  });
  await expect(
    importDirectCampPayment(db, stripe, record(), token),
  ).rejects.toThrow("konnte nicht ausgeführt");
  stripe.checkout.sessions.retrieve.mockRejectedValueOnce(new Error("offline"));
  await expect(
    importDirectCampPayment(db, stripe, record(), token),
  ).rejects.toThrow("offline");
});
it("never accepts worker authorization, observation date or automatic age confirmation from a review form", async () => {
  const value = await prepareCampImport(
    db,
    stripe,
    {
      camp_id: camp,
      payment_id: "pi_age",
      new_parent: { name: "Havva Kaya", email: "havva@example.invalid" },
      automatic: true,
      processing_token: token,
      child: {
        first_name: "Mehmet Tahir",
        last_name: "Kaya",
        age_at_booking: 8,
        age_recorded_on: "2010-01-01",
        gender: "keine Angabe",
        clothing_size: "152",
      },
    },
    "cs_live_age",
    camp,
    { group: "new", percent: 0 },
  );
  expect(value).not.toHaveProperty("automatic");
  expect(value).not.toHaveProperty("processing_token");
  expect(value.child.age_recorded_on).toBe("2026-10-01");
});
