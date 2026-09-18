import { describe, it, expect, vi } from "vitest";
import { collectCampReview } from "../scripts/camp/stripe-review-lib.mjs";

const source = {
  camp_id: "camp",
  payment_link_id: "plink_camp",
  price_id: "price_camp",
  product_id: "prod_camp",
};
function fixture() {
  const session = {
    id: "cs_live_paid",
    mode: "payment",
    livemode: true,
    payment_link: source.payment_link_id,
    payment_intent: "pi_paid",
    payment_status: "paid",
    currency: "eur",
    amount_total: 18549,
    created: 100,
    customer_details: { name: "Parent" },
    custom_fields: [
      { label: { custom: "Name des Kindes" }, text: { value: "Child" } },
    ],
  };
  const charge = {
    id: "ch_paid",
    livemode: true,
    payment_intent: "pi_paid",
    paid: true,
    currency: "eur",
    amount: 18549,
    amount_refunded: 0,
    refunded: false,
    disputed: false,
  };
  const lines = {
    has_more: false,
    data: [
      {
        quantity: 1,
        price: { id: source.price_id, product: source.product_id },
      },
    ],
  };
  // Deliberately exposes only read methods. A write or unrelated API access fails the test.
  const stripe = {
    paymentLinks: {
      retrieve: vi.fn(async () => ({
        id: source.payment_link_id,
        livemode: true,
      })),
    },
    checkout: {
      sessions: {
        list: vi.fn(async () => ({ has_more: false, data: [session] })),
        listLineItems: vi.fn(async () => lines),
      },
    },
    paymentIntents: {
      retrieve: vi.fn(async () => ({
        id: "pi_paid",
        livemode: true,
        latest_charge: "ch_paid",
        status: "succeeded",
        currency: "eur",
        amount_received: 18549,
      })),
    },
    charges: { retrieve: vi.fn(async () => charge) },
  };
  return { session, stripe, charge, lines };
}
describe("read-only local Camp reconciliation", () => {
  it("reads only the approved link and retains missing child details without inventing dates", async () => {
    const { stripe } = fixture();
    const result = await collectCampReview(stripe, [source]);
    expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({
      payment_link: source.payment_link_id,
      limit: 100,
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      child_name: "Child",
      status: "paid",
      age_at_booking: "",
      clothing_size: "",
    });
    expect(result.records[0]).not.toHaveProperty("birth_date");
    expect(result.records[0]).not.toHaveProperty("customer_details");
  });
  it("paginates, skips unpaid sessions and deduplicates repeated payments", async () => {
    const { stripe, session } = fixture();
    stripe.checkout.sessions.list
      .mockResolvedValueOnce({
        has_more: true,
        data: [
          { ...session, id: "cs_unpaid", payment_status: "unpaid" },
          session,
        ],
      })
      .mockResolvedValueOnce({ has_more: false, data: [session] });
    const result = await collectCampReview(stripe, [source]);
    expect(result.records).toHaveLength(1);
    expect(stripe.checkout.sessions.list).toHaveBeenLastCalledWith({
      payment_link: source.payment_link_id,
      limit: 100,
      starting_after: session.id,
    });
  });
  it("rejects foreign and test sessions rather than assigning them to the camp", async () => {
    const { stripe, session } = fixture();
    session.payment_link = "plink_other";
    await expect(collectCampReview(stripe, [source])).rejects.toThrow(
      "approved source",
    );
    session.payment_link = source.payment_link_id;
    session.livemode = false;
    await expect(collectCampReview(stripe, [source])).rejects.toThrow(
      "approved source",
    );
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });
  it("keeps refunds and disputes visible for review", async () => {
    const { stripe, charge } = fixture();
    charge.refunded = true;
    charge.amount_refunded = 18549;
    expect((await collectCampReview(stripe, [source])).records[0].status).toBe(
      "refunded",
    );
    charge.refunded = false;
    charge.amount_refunded = 100;
    charge.disputed = true;
    const row = (await collectCampReview(stripe, [source])).records[0];
    expect(row.status).toBe("review");
    expect(row.issues).toHaveLength(2);
  });
  it("flags wrong quantities and amounts", async () => {
    const { stripe, session, lines } = fixture();
    lines.data[0].quantity = 2;
    session.amount_total = 1;
    const row = (await collectCampReview(stripe, [source])).records[0];
    expect(row.status).toBe("review");
    expect(row.issues).toHaveLength(2);
  });
  it("fails a partial source fetch instead of reporting an incomplete list as complete", async () => {
    const { stripe, session } = fixture();
    stripe.checkout.sessions.list
      .mockResolvedValueOnce({ has_more: true, data: [session] })
      .mockRejectedValueOnce(new Error("Offline"));
    await expect(collectCampReview(stripe, [source])).rejects.toThrow(
      "Offline",
    );
  });
});
