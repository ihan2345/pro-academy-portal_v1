import { z } from "zod";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { childSchema } from "./domain";
export const reviewDraftSchema = z.object({
  camp_id: z.uuid(),
  payment_id: z.string().regex(/^pi_[A-Za-z0-9]+$/),
  parent_id: z.uuid().nullable().default(null),
  player_id: z.uuid().nullable().default(null),
  child: z.object({
    first_name: z.string().trim().max(80),
    last_name: z.string().trim().max(80),
    birth_date: z.union([z.iso.date(), z.literal("")]).optional(),
    age_at_booking: z.number().int().min(0).max(99).nullable().optional(),
    gender: childSchema.shape.gender,
    clothing_size: z.string().trim().max(20),
  }),
  new_child: z.boolean().default(false),
  age_range_confirmed: z.boolean().default(false),
  new_parent: z
    .object({
      name: z.string().trim().min(2).max(160),
      email: z.email().max(254),
      phone: z.string().trim().max(80).default(""),
    })
    .nullable()
    .default(null),
  notes: z.string().trim().max(2000).default(""),
});
export class CampImportReviewError extends Error {}

/** Both legacy payment links and current portal offers are approved Camp sources. */
export async function campImportSource(
  db: SupabaseClient,
  campId: string,
  linkId: string,
) {
  const legacy = await db
    .from("camp_stripe_sources")
    .select("*")
    .eq("camp_id", campId)
    .eq("payment_link_id", linkId)
    .maybeSingle();
  if (legacy.error) throw new Error("Camp-Quelle konnte nicht geprüft werden.");
  if (legacy.data) return legacy.data;
  const offer = await db
    .from("camp_offers")
    .select(
      "camp_id,stripe_payment_link_id,stripe_price_id,stripe_product_id,amount",
    )
    .eq("camp_id", campId)
    .eq("stripe_payment_link_id", linkId)
    .maybeSingle();
  if (offer.error) throw new Error("Camp-Angebot konnte nicht geprüft werden.");
  return offer.data
    ? {
        camp_id: campId,
        payment_link_id: offer.data.stripe_payment_link_id,
        price_id: offer.data.stripe_price_id,
        product_id: offer.data.stripe_product_id,
        amount: offer.data.amount,
      }
    : null;
}

const id = (v: unknown): string | undefined =>
  typeof v === "string" ? v : (v as { id?: string } | null)?.id;
export async function prepareCampImport(
  db: SupabaseClient,
  stripe: Stripe,
  raw: unknown,
  sessionId: string,
  actorId: string | null,
  benefit: { group: string; percent: number },
  processingToken?: string,
) {
  const data = reviewDraftSchema
    .extend({
      child: reviewDraftSchema.shape.child
        .extend({
          first_name: childSchema.shape.first_name,
          last_name: childSchema.shape.last_name,
          clothing_size: childSchema.shape.clothing_size,
        })
        .refine(
          (c) => c.age_at_booking != null || !!c.birth_date,
          "Alter bei Buchung fehlt.",
        ),
    })
    .refine(
      (d) =>
        processingToken
          ? !d.parent_id && !d.player_id && !d.new_parent
          : d.new_parent
            ? !d.parent_id && !d.player_id && !d.new_child
            : !!d.parent_id && (d.new_child ? !d.player_id : !!d.player_id),
      "Vorhandene Familie auswählen oder neue Elternangaben ergänzen.",
    )
    .parse(raw);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const source = await campImportSource(
    db,
    data.camp_id,
    id(session.payment_link) ?? "",
  );
  if (!source) throw new Error("Stripe-Link ist diesem Camp nicht zugeordnet.");
  const lines = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 100,
  });
  if (
    !session.livemode ||
    session.mode !== "payment" ||
    session.payment_status !== "paid" ||
    id(session.payment_intent) !== data.payment_id ||
    session.currency !== "eur" ||
    lines.has_more ||
    lines.data.length !== 1 ||
    lines.data[0].quantity !== 1 ||
    lines.data[0].price?.id !== source.price_id ||
    id(lines.data[0].price?.product) !== source.product_id
  )
    throw new CampImportReviewError(
      "Zahlung oder Artikel passt nicht zur Buchung.",
    );
  const payment = await stripe.paymentIntents.retrieve(data.payment_id, {
    expand: ["latest_charge"],
  });
  const charge =
    typeof payment.latest_charge === "object" ? payment.latest_charge : null;
  if (
    payment.id !== data.payment_id ||
    id(charge?.payment_intent) !== data.payment_id ||
    payment.currency !== "eur" ||
    charge?.currency !== "eur" ||
    !payment.livemode ||
    payment.status !== "succeeded" ||
    !charge?.livemode ||
    !charge.paid ||
    charge.refunded ||
    charge.amount_refunded ||
    charge.disputed ||
    payment.amount_received !== session.amount_total ||
    charge.amount !== session.amount_total ||
    !session.amount_total
  )
    throw new CampImportReviewError(
      "Zahlung ist nicht uneingeschränkt bestätigt; bitte prüfen.",
    );
  let parent = data.new_parent
    ? {
        full_name: data.new_parent.name,
        contact_email: data.new_parent.email,
      }
    : {
        full_name: session.customer_details?.name ?? "",
        contact_email: session.customer_details?.email ?? "",
      };
  if (!processingToken && !data.new_parent) {
    const family = data.new_child
      ? await db
          .from("parents")
          .select("id,full_name,contact_email,archived_at")
          .eq("id", data.parent_id)
          .single()
      : await db
          .from("parent_players")
          .select(
            "parents!inner(id,full_name,contact_email,archived_at),players!inner(id,archived_at)",
          )
          .eq("parent_id", data.parent_id)
          .eq("player_id", data.player_id)
          .single();
    if (family.error || !family.data)
      throw new Error("Eltern-Kind-Zuordnung fehlt.");
    const row = family.data as unknown as {
      full_name: string;
      contact_email: string;
      archived_at: string | null;
      parents?: typeof parent & { archived_at: string | null };
      players?: { archived_at: string | null };
    };
    const selected = row.parents ?? row;
    if (selected.archived_at || row.players?.archived_at)
      throw new Error("Archivierte Familie kann nicht übernommen werden.");
    parent = selected;
  }
  // The date comes from Stripe, never from an editable form or the worker's clock.
  const recordedOn = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
  }).format(new Date(session.created * 1000));
  return {
    camp_id: data.camp_id,
    actor_id: actorId,
    ...(processingToken
      ? { automatic: true, processing_token: processingToken }
      : {}),
    new_child: data.new_child,
    age_range_confirmed: !processingToken && data.age_range_confirmed,
    parent_id: data.parent_id,
    player_id: data.player_id,
    new_parent: data.new_parent,
    child: { ...data.child, age_recorded_on: recordedOn },
    parent: {
      name: parent.full_name,
      email: parent.contact_email,
      phone: data.new_parent?.phone || session.customer_details?.phone || "",
    },
    customer_group: benefit.group,
    benefit_percent: benefit.percent,
    payment_link_id: source.payment_link_id,
    price_id: source.price_id,
    product_id: source.product_id,
    session_id: session.id,
    payment_id: data.payment_id,
    customer_id: id(session.customer) ?? null,
    livemode: true,
    payment_status: "paid",
    refunded: false,
    disputed: false,
    quantity: 1,
    currency: "eur",
    amount: session.amount_total,
    subtotal: session.amount_subtotal,
    paid_at: new Date(charge.created * 1000).toISOString(),
    evidence: {
      customer_details: session.customer_details,
      custom_fields: session.custom_fields,
      discount: session.total_details?.amount_discount,
      notes: data.notes,
    },
  };
}
