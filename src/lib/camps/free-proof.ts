import "server-only";
import { z } from "zod";
import type Stripe from "stripe";
import { HttpError } from "@/lib/server/security";
import { reviewDraftSchema } from "./import-core";
const objectId = (v: unknown) =>
  typeof v === "string" ? v : (v as { id?: string } | null)?.id;
export const freeApprovalSchema = reviewDraftSchema
  .omit({ payment_id: true })
  .extend({
    booking_id: z.uuid().optional(),
    session_id: z
      .string()
      .regex(/^cs_live_[A-Za-z0-9]+$/)
      .optional(),
    special_discount_approved: z.literal(true),
    notes: z.string().trim().min(3).max(2000),
  })
  .refine(
    (d) => !!d.booking_id !== !!d.session_id,
    "Genau eine Buchung oder Checkout-ID auswählen.",
  )
  .refine(
    (d) =>
      d.new_parent
        ? !d.parent_id && !d.player_id && !d.new_child
        : !!d.parent_id && (d.new_child ? !d.player_id : !!d.player_id),
    "Bitte Familie und Kind ausdrücklich auswählen.",
  );
/** Stripe remains the authority; request bodies can never supply payment facts. */
export async function verifyFreeCampProof(
  stripe: Pick<Stripe, "checkout" | "paymentIntents">,
  b: any,
  offer: any,
) {
  if (!b.stripe_session_id || !offer || b.status !== "review")
    throw new HttpError(
      409,
      "Diese Buchung kann nicht als Sonderrabatt freigegeben werden.",
    );
  const session = await stripe.checkout.sessions.retrieve(b.stripe_session_id);
  const lines = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 100,
  });
  if (
    !session.livemode ||
    session.mode !== "payment" ||
    session.status !== "complete" ||
    !["paid", "no_payment_required"].includes(session.payment_status) ||
    session.amount_total == null ||
    session.amount_total < 0 ||
    !session.amount_subtotal ||
    session.amount_subtotal !== b.expected_amount ||
    !session.total_details?.amount_discount ||
    session.total_details.amount_discount > session.amount_subtotal ||
    session.amount_total + session.total_details.amount_discount !==
      session.amount_subtotal ||
    session.total_details?.amount_shipping ||
    session.total_details?.amount_tax ||
    session.currency !== "eur" ||
    b.currency !== "eur" ||
    (b.booking_origin === "stripe_import"
      ? !!session.client_reference_id
      : session.client_reference_id !== b.id) ||
    objectId(session.payment_link) !== b.stripe_payment_link_id ||
    offer.stripe_payment_link_id !== b.stripe_payment_link_id ||
    offer.stripe_price_id !== b.stripe_price_id ||
    offer.camp_id !== b.camp_id ||
    offer.amount !== b.expected_amount ||
    lines.has_more ||
    lines.data.length !== 1 ||
    lines.data[0].quantity !== 1 ||
    (b.booking_origin === "stripe_import" &&
      lines.data[0].price?.unit_amount !== session.amount_subtotal) ||
    lines.data[0].price?.id !== b.stripe_price_id ||
    objectId(lines.data[0].price?.product) !== offer.stripe_product_id ||
    (b.stripe_customer_id &&
      objectId(session.customer) !== b.stripe_customer_id)
  )
    throw new HttpError(
      409,
      "Stripe bestätigt keine passende, vollständig abgeschlossene Campbuchung mit Sonderrabatt. Bitte manuell klären.",
    );
  let paymentId: string | null = null;
  let chargeId: string | null = null;
  if (session.amount_total === 0) {
    if (session.payment_intent)
      throw new HttpError(
        409,
        "Kostenloser Checkout mit unerwarteter Zahlungsreferenz.",
      );
  } else {
    paymentId = objectId(session.payment_intent) ?? null;
    if (!paymentId || session.payment_status !== "paid")
      throw new HttpError(409, "Restbetrag ist nicht bezahlt.");
    const payment = await stripe.paymentIntents.retrieve(paymentId, {
      expand: ["latest_charge"],
    });
    const charge =
      typeof payment.latest_charge === "object" ? payment.latest_charge : null;
    if (
      payment.id !== paymentId ||
      !payment.livemode ||
      payment.status !== "succeeded" ||
      payment.currency !== "eur" ||
      payment.amount_received !== session.amount_total ||
      !charge?.livemode ||
      !charge.paid ||
      charge.currency !== "eur" ||
      objectId(charge.payment_intent) !== paymentId ||
      charge.amount !== session.amount_total ||
      charge.refunded ||
      charge.amount_refunded ||
      charge.disputed
    )
      throw new HttpError(
        409,
        "Restzahlung ist nicht uneingeschränkt bestätigt; Erstattung oder Zahlungsstatus prüfen.",
      );
    chargeId = charge.id;
  }
  return {
    session_id: session.id,
    customer_id: objectId(session.customer) ?? null,
    payment_link_id: b.stripe_payment_link_id,
    price_id: b.stripe_price_id,
    product_id: offer.stripe_product_id,
    subtotal: session.amount_subtotal,
    discount: session.total_details.amount_discount,
    total: session.amount_total,
    percent:
      Math.round(
        (session.total_details.amount_discount / session.amount_subtotal) *
          10000,
      ) / 100,
    quantity: 1,
    currency: "eur",
    livemode: true,
    session_status: session.status,
    payment_status: session.payment_status,
    payment_intent: paymentId,
    charge_id: chargeId,
    refunded: false,
    disputed: false,
    client_reference_id: session.client_reference_id ?? null,
    created_at: new Date(session.created * 1000).toISOString(),
  };
}
