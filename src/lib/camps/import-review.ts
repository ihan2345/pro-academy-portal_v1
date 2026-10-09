import "server-only";
import Stripe from "stripe";
import { z } from "zod";
import { campSession, getCamp, childBenefit } from "./service";
import { requireCampAccess } from "./guard";
import { campReview, reviewReference } from "./local-review";
import { serviceDb } from "@/lib/server/service-db";
import { HttpError } from "@/lib/server/security";
import { prepareCampImport, reviewDraftSchema } from "./import-core";
import { campImportIssue } from "./import-issues";
export async function saveCampReview(raw: unknown, add: boolean) {
  await requireCampAccess();
  const session = await campSession(true);
  const reference = z
    .object({ camp_id: z.uuid(), payment_id: z.string().max(100) })
    .parse(raw);
  await getCamp(reference.camp_id);
  const review = await campReview(reference.camp_id, true);
  const record = review.records.find((r) =>
    session.role === "admin"
      ? r.payment_id === reference.payment_id
      : reviewReference(r.payment_id) === reference.payment_id ||
        r.payment_id === reference.payment_id,
  );
  const data = reviewDraftSchema.parse({
    ...(raw as object),
    payment_id: record?.payment_id ?? "pi_missing",
  });
  if (!record)
    throw new HttpError(
      404,
      "Stripe-Buchung nicht im Camp-Prüfstand gefunden.",
    );
  const db = serviceDb();
  const existing = await db
    .from("camp_bookings")
    .select("id")
    .eq("stripe_payment_id", data.payment_id)
    .maybeSingle();
  if (existing.error)
    throw new HttpError(503, "Buchungsstatus konnte nicht geprüft werden.");
  if (existing.data)
    throw new HttpError(409, "Die Buchung wurde bereits übernommen.");
  if (add) {
    if (record.status !== "paid")
      throw new HttpError(400, "Zahlung benötigt Klärung.");
    const key =
      process.env.CAMP_STRIPE_READ_KEY ?? process.env.STRIPE_SECRET_KEY ?? "";
    if (!/^(sk|rk)_live_/.test(key))
      throw new HttpError(503, "Stripe-Lesezugang fehlt.");
    try {
      const benefit = data.player_id
        ? await childBenefit(data.player_id)
        : { group: "new", percent: 0 };
      const input = await prepareCampImport(
        db,
        new Stripe(key, {
          httpClient: Stripe.createFetchHttpClient(),
          timeout: 10000,
          maxNetworkRetries: 1,
        }),
        data,
        record.session_id!,
        session.user.id,
        benefit,
      );
      const result = await db.rpc(
        data.new_parent || data.new_child
          ? "camp_import_review_booking"
          : "camp_import_paid_booking",
        { input },
      );
      if (result.error) throw new Error(campImportIssue(result.error.message));
      return { ok: true, id: result.data };
    } catch (e) {
      throw new HttpError(
        400,
        e instanceof Error ? e.message : "Übernahme fehlgeschlagen.",
      );
    }
  }
  const saved = await db.from("camp_review_drafts").upsert({
    payment_id: data.payment_id,
    camp_id: data.camp_id,
    data,
    updated_by: session.user.id,
    updated_at: new Date().toISOString(),
  });
  if (saved.error)
    throw new HttpError(503, "Prüfangaben konnten nicht gespeichert werden.");
  return { ok: true };
}
