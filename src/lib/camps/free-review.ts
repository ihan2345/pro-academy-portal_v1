import "server-only";
import { z } from "zod";
import { serviceDb } from "@/lib/server/service-db";
import { HttpError } from "@/lib/server/security";
import { campSession } from "./service";
import { requireCampAccess } from "./guard";
import { campReadStripe } from "./processing";
import { reviewDraftSchema, campImportSource } from "./import-core";
import { ageAt } from "./domain";
import { freeApprovalSchema, verifyFreeCampProof } from "./free-proof";
export { freeApprovalSchema, verifyFreeCampProof } from "./free-proof";
async function admin() {
  await requireCampAccess();
  const s = await campSession(true);
  if (s.role !== "admin")
    throw new HttpError(403, "Sonderrabatte dürfen nur Admins freigeben.");
  return s;
}
function checked<T>(r: { data: T; error: unknown }): NonNullable<T> {
  if (r.error)
    throw new HttpError(
      503,
      "Camp-Prüfung konnte nicht vollständig geladen werden. Bitte die vorbereitete Migration prüfen.",
    );
  return r.data as NonNullable<T>;
}
export async function freeCampReview(rawId: string) {
  await admin();
  const campId = z.uuid().parse(rawId),
    db = serviceDb();
  const [bookings, families] = await Promise.all([
    db
      .from("camp_bookings")
      .select(
        "id,camp_id,parent_data,child_data,stripe_session_id,review_reason,created_at,paid_amount",
      )
      .eq("camp_id", campId)
      .eq("status", "review")
      .eq("booking_origin", "checkout")
      .order("created_at"),
    db
      .from("parents")
      .select(
        "id,full_name,parent_players(players(id,first_name,last_name,camp_birth_date,camp_gender,camp_clothing_size,archived_at))",
      )
      .is("archived_at", null)
      .order("full_name"),
  ]);
  return { bookings: checked(bookings), families: checked(families) };
}
async function proof(reference: {
  booking_id?: string;
  session_id?: string;
  camp_id?: string;
}) {
  if (!reference.booking_id) {
    const campId = z.uuid().parse(reference.camp_id);
    const sessionId = z
      .string()
      .regex(/^cs_live_[A-Za-z0-9]+$/)
      .parse(reference.session_id);
    const stripe = campReadStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const linkId =
      typeof session.payment_link === "string"
        ? session.payment_link
        : session.payment_link?.id;
    const source = await campImportSource(serviceDb(), campId, linkId ?? "");
    if (!source)
      throw new HttpError(409, "Stripe-Link ist diesem Camp nicht zugeordnet.");
    const b = {
      camp_id: campId,
      status: "review",
      booking_origin: "stripe_import",
      stripe_session_id: sessionId,
      stripe_payment_link_id: source.payment_link_id,
      stripe_price_id: source.price_id,
      expected_amount: session.amount_subtotal,
      currency: "eur",
    };
    const offer = {
      camp_id: campId,
      stripe_payment_link_id: source.payment_link_id,
      stripe_price_id: source.price_id,
      stripe_product_id: source.product_id,
      amount: source.amount ?? session.amount_subtotal,
    };
    return { b, evidence: await verifyFreeCampProof(stripe, b, offer) };
  }
  const bookingId = reference.booking_id;
  const db = serviceDb();
  const b = checked(
    await db
      .from("camp_bookings")
      .select("*")
      .eq("id", z.uuid().parse(bookingId))
      .maybeSingle(),
  );
  if (!b) throw new HttpError(404, "Campbuchung nicht gefunden.");
  const offer = checked(
    await db.from("camp_offers").select("*").eq("id", b.offer_id).maybeSingle(),
  );
  return { b, evidence: await verifyFreeCampProof(campReadStripe(), b, offer) };
}
export async function freeCampProof(
  reference:
    string | { booking_id?: string; session_id?: string; camp_id?: string },
) {
  await admin();
  return (
    await proof(
      typeof reference === "string" ? { booking_id: reference } : reference,
    )
  ).evidence;
}
export async function approveFreeCampBooking(raw: unknown) {
  const s = await admin(),
    data = freeApprovalSchema.parse(raw);
  const { b, evidence } = await proof(data);
  if (b.camp_id !== data.camp_id)
    throw new HttpError(409, "Camp stimmt nicht mit der Buchung überein.");
  const child = reviewDraftSchema.shape.child
    .extend({
      first_name: z.string().trim().min(1).max(80),
      last_name: z.string().trim().min(1).max(80),
      clothing_size: z.string().trim().min(1).max(20),
    })
    .parse(data.child);
  if (!child.birth_date && child.age_at_booking == null)
    throw new HttpError(400, "Alter oder Geburtsdatum des Kindes fehlt.");
  const recordedOn = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
  }).format(new Date(evidence.created_at));
  const result = await serviceDb().rpc("camp_approve_discount_booking", {
    input: {
      ...data,
      actor_id: s.user.id,
      child: {
        ...child,
        age_recorded_on: recordedOn,
        age_at_booking:
          child.age_at_booking ??
          (child.birth_date
            ? ageAt(child.birth_date, evidence.created_at)
            : null),
      },
      proof: evidence,
    },
  });
  if (result.error)
    throw new HttpError(
      400,
      result.error.code === "PGRST202"
        ? "Die vorbereitete Sonderrabatt-Migration ist noch nicht aktiviert."
        : result.error.message,
    );
  return { ok: true, id: result.data };
}
