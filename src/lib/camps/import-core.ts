import { z } from "zod";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ageAt, childSchema } from "./domain";
export const reviewDraftSchema = z.object({
  camp_id: z.uuid(),
  payment_id: z.string().regex(/^pi_[A-Za-z0-9]+$/),
  parent_id: z.uuid().nullable().default(null),
  player_id: z.uuid().nullable().default(null),
  child: z.object({
    first_name: z.string().trim().max(80),
    last_name: z.string().trim().max(80),
    birth_date: z.union([z.iso.date(), z.literal("")]),
    gender: childSchema.shape.gender,
    clothing_size: z.string().trim().max(20),
  }),
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
const id = (v: unknown): string | undefined =>
  typeof v === "string" ? v : (v as { id?: string } | null)?.id;
export async function prepareCampImport(
  db: SupabaseClient,
  stripe: Stripe,
  raw: unknown,
  sessionId: string,
  actorId: string,
  benefit: { group: string; percent: number },
) {
  const data = reviewDraftSchema
    .extend({ child: childSchema })
    .refine(
      (d) =>
        d.new_parent
          ? !d.parent_id && !d.player_id
          : !!d.parent_id && !!d.player_id,
      "Vorhandene Familie auswählen oder neue Elternangaben ergänzen.",
    )
    .parse(raw);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const source = await db
    .from("camp_stripe_sources")
    .select("*")
    .eq("camp_id", data.camp_id)
    .eq("payment_link_id", id(session.payment_link) ?? "")
    .single();
  if (source.error || !source.data)
    throw new Error("Stripe-Link ist diesem Camp nicht zugeordnet.");
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
    lines.data[0].price?.id !== source.data.price_id ||
    id(lines.data[0].price?.product) !== source.data.product_id
  )
    throw new Error("Zahlung oder Artikel passt nicht zur Buchung.");
  const payment = await stripe.paymentIntents.retrieve(data.payment_id, {
    expand: ["latest_charge"],
  });
  const charge =
    typeof payment.latest_charge === "object" ? payment.latest_charge : null;
  if (
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
    throw new Error(
      "Zahlung ist nicht uneingeschränkt bestätigt; bitte prüfen.",
    );
  const [family, camp] = await Promise.all([
    data.new_parent
      ? Promise.resolve({ data: null, error: null })
      : db
          .from("parent_players")
          .select(
            "parents!inner(id,full_name,contact_email,archived_at),players!inner(id,archived_at)",
          )
          .eq("parent_id", data.parent_id)
          .eq("player_id", data.player_id)
          .single(),
    db
      .from("camps")
      .select("days,min_age,max_age")
      .eq("id", data.camp_id)
      .single(),
  ]);
  if (family.error || camp.error)
    throw new Error("Eltern-Kind-Zuordnung oder Camp fehlt.");
  const parent = data.new_parent
    ? {
        full_name: data.new_parent.name,
        contact_email: data.new_parent.email,
        archived_at: null,
      }
    : (family.data!.parents as unknown as {
        full_name: string;
        contact_email: string;
        archived_at: string | null;
      });
  const player = data.new_parent
    ? { archived_at: null }
    : (family.data!.players as unknown as {
        archived_at: string | null;
      });
  if (parent.archived_at || player.archived_at)
    throw new Error("Archivierte Familie kann nicht übernommen werden.");
  const first = [...camp.data.days].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at),
  )[0];
  const age = ageAt(data.child.birth_date, first.starts_at);
  if (
    age < camp.data.min_age ||
    age > camp.data.max_age ||
    Date.parse(data.child.birth_date) > Date.now()
  )
    throw new Error("Geburtsdatum passt nicht zum Altersbereich des Camps.");
  return {
    camp_id: data.camp_id,
    actor_id: actorId,
    parent_id: data.parent_id,
    player_id: data.player_id,
    new_parent: data.new_parent,
    child: data.child,
    parent: {
      name: parent.full_name,
      email: parent.contact_email,
      phone: data.new_parent?.phone || session.customer_details?.phone || "",
    },
    customer_group: benefit.group,
    benefit_percent: benefit.percent,
    payment_link_id: source.data.payment_link_id,
    price_id: source.data.price_id,
    product_id: source.data.product_id,
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
