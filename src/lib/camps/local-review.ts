import { includeTrialCampFamilies } from "./trial-children";
import "server-only";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { requireCampAccess } from "./guard";
import { campLocalEnabled } from "./runtime";
import { campReviewEnabled } from "./processing-config";
import { campSession, getCamp } from "./service";
import { hashToken, HttpError } from "@/lib/server/security";
import { serviceDb } from "@/lib/server/service-db";

export const snapshotSchema = z.object({
  running: z.boolean(),
  checked_at: z.string().nullable(),
  interval_seconds: z.number(),
  error: z.string().nullable(),
  sources: z.array(
    z.object({ camp_id: z.uuid(), payment_link_id: z.string() }),
  ),
  records: z.array(
    z.object({
      camp_id: z.uuid(),
      payment_link_id: z.string(),
      session_id: z.string(),
      payment_id: z.string(),
      parent_name: z.string(),
      parent_email: z.string().default(""),
      parent_phone: z.string().default(""),
      customer_id: z.string().nullable().default(null),
      child_name: z.string(),
      age_at_booking: z.string(),
      clothing_size: z.string(),
      amount: z.number(),
      discount: z.number().optional(),
      subtotal: z.number().nullable().optional(),
      currency: z.string(),
      status: z.enum(["paid", "review", "refunded"]),
      issues: z.array(z.string()),
      created_at: z.string(),
    }),
  ),
});
export const reviewReference = (paymentId: string) =>
  `review_${hashToken(paymentId)}`;

export async function campReview(campId: string, internal = false) {
  await requireCampAccess();
  const session = await campSession(true);
  await getCamp(campId);
  if (!campReviewEnabled())
    throw new HttpError(404, "Camp-Abgleich ist nicht eingerichtet.");
  let snapshot: unknown;
  if (campLocalEnabled()) {
    try {
      snapshot = JSON.parse(
        await readFile("output/camp-v0/stripe-review.private.json", "utf8"),
      );
    } catch {
      throw new HttpError(503, "Der erste Camp-Abgleich steht noch aus.");
    }
  } else {
    const { readServerReview } = await import("./processing");
    snapshot = await readServerReview(campId);
  }
  const result = snapshotSchema.safeParse(snapshot);
  if (!result.success)
    throw new HttpError(503, "Der Prüfstand konnte nicht gelesen werden.");
  const { sources, records, ...state } = result.data;
  const db = serviceDb();
  const [bookings, drafts, families] = await Promise.all([
    db
      .from("camp_bookings")
      .select("stripe_payment_id,status,payment_details")
      .eq("camp_id", campId)
      .not("stripe_payment_id", "is", null),
    db
      .from("camp_review_drafts")
      .select("payment_id,data")
      .eq("camp_id", campId),
    db
      .from("parents")
      .select(
        "id,full_name,parent_players(players(id,first_name,last_name,camp_birth_date,camp_gender,camp_clothing_size,archived_at))",
      )
      .is("archived_at", null)
      .order("full_name"),
  ]);
  if (bookings.error || drafts.error || families.error)
    throw new HttpError(503, "Camp-Prüfung ist noch nicht eingerichtet.");
  const imported = new Set(bookings.data.map((b) => b.stripe_payment_id));
  const removed = new Set(
    bookings.data
      .filter((b) => b.status === "cancelled")
      .map((b) => b.stripe_payment_id),
  );
  const resultData = {
    ...state,
    stale:
      !state.checked_at ||
      Date.now() - Date.parse(state.checked_at) >
        (state.interval_seconds * 2 + 60) * 1000,
    sources: sources.filter((s) => s.camp_id === campId),
    imported_count: imported.size - removed.size,
    records: records
      .filter(
        (r) =>
          r.camp_id === campId &&
          !bookings.data.some(
            (b) =>
              b.stripe_payment_id === r.payment_id &&
              b.status === "paid" &&
              b.payment_details?.special_discount_approval?.session_id ===
                r.session_id &&
              r.issues.every(
                (issue) =>
                  issue ===
                    "Kostenloser Checkout; Sonderrabatt manuell prüfen" ||
                  issue ===
                    "Sonderrabatt benötigt eine ausdrückliche Admin-Freigabe.",
              ),
          ) &&
          !removed.has(r.payment_id) &&
          (!imported.has(r.payment_id) || r.status !== "paid"),
      )
      .map((r) => ({
        ...r,
        imported: imported.has(r.payment_id),
        special_discount_review:
          session.role === "admin" &&
          !imported.has(r.payment_id) &&
          r.status !== "refunded" &&
          ((r.discount ?? 0) > 0 ||
            r.issues.some((issue) => /Sonderrabatt/.test(issue))),
        draft:
          drafts.data.find((d) => d.payment_id === r.payment_id)?.data ?? null,
      })),
    families: await includeTrialCampFamilies(families.data),
  };
  if (internal || session.role === "admin") return resultData;
  return {
    ...resultData,
    error: resultData.error
      ? "Camp-Prüfung vorübergehend nicht verfügbar."
      : null,
    sources: resultData.sources.map(() => ({
      camp_id: campId,
      payment_link_id: "",
    })),
    records: resultData.records.map((r) => ({
      camp_id: r.camp_id,
      payment_id: reviewReference(r.payment_id),
      session_id: undefined,
      parent_name: r.parent_name,
      parent_email: r.parent_email,
      parent_phone: r.parent_phone,
      child_name: r.child_name,
      age_at_booking: r.age_at_booking,
      clothing_size: r.clothing_size,
      created_at: r.created_at,
      status: r.status,
      imported: r.imported,
      issues: [
        ...new Set(
          r.issues.map((issue) =>
            /Zahl|Erstatt|Betrag|Stripe|Rabatt/i.test(issue)
              ? "Buchung muss durch die Verwaltung geprüft werden."
              : issue,
          ),
        ),
      ],
      // Drafts are validated at write time; never return the stored payment reference.
      draft: r.draft
        ? { ...r.draft, payment_id: reviewReference(r.payment_id) }
        : null,
    })),
  };
}
