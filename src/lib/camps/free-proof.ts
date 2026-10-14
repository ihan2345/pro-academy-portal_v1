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
    booking_id: z.uuid(),
    special_discount_approved: z.literal(true),
    notes: z.string().trim().min(3).max(2000),
  })
  .refine(
    (d) =>
      d.new_parent
        ? !d.parent_id && !d.player_id && !d.new_child
        : !!d.parent_id && (d.new_child ? !d.player_id : !!d.player_id),
    "Bitte Familie und Kind ausdrücklich auswählen.",
  );
/** Stripe remains the authority; request bodies can never supply payment facts. */
export async function verifyFreeCampProof(
  stripe: Pick<Stripe, "checkout">,
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
    session.payment_intent ||
    session.amount_total !== 0 ||
    !session.amount_subtotal ||
    session.amount_subtotal !== b.expected_amount ||
    session.total_details?.amount_discount !== session.amount_subtotal ||
    session.total_details?.amount_shipping ||
    session.total_details?.amount_tax ||
    session.currency !== "eur" ||
    b.currency !== "eur" ||
    session.client_reference_id !== b.id ||
    objectId(session.payment_link) !== b.stripe_payment_link_id ||
    offer.stripe_payment_link_id !== b.stripe_payment_link_id ||
    offer.stripe_price_id !== b.stripe_price_id ||
    offer.camp_id !== b.camp_id ||
    offer.amount !== b.expected_amount ||
    lines.has_more ||
    lines.data.length !== 1 ||
    lines.data[0].quantity !== 1 ||
    lines.data[0].price?.id !== b.stripe_price_id ||
    objectId(lines.data[0].price?.product) !== offer.stripe_product_id ||
    (b.stripe_customer_id &&
      objectId(session.customer) !== b.stripe_customer_id)
  )
    throw new HttpError(
      409,
      "Stripe bestätigt keine passende, vollständig abgeschlossene Campbuchung mit 100 % Rabatt. Bitte manuell klären.",
    );
  return {
    session_id: session.id,
    customer_id: objectId(session.customer) ?? null,
    payment_link_id: b.stripe_payment_link_id,
    price_id: b.stripe_price_id,
    product_id: offer.stripe_product_id,
    subtotal: session.amount_subtotal,
    discount: session.total_details.amount_discount,
    total: 0,
    quantity: 1,
    currency: "eur",
    livemode: true,
    session_status: session.status,
    payment_status: session.payment_status,
    payment_intent: null,
    created_at: new Date(session.created * 1000).toISOString(),
  };
}
