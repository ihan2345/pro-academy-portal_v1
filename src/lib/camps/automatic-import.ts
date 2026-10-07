import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CampImportReviewError, prepareCampImport } from "./import-core";
import { ZodError } from "zod";
import { campImportIssue } from "./import-issues";

type Record = {
  camp_id: string;
  payment_id: string;
  session_id: string;
  booking_reference?: string | null;
  status: string;
  child_name: string;
  age_at_booking: string;
  clothing_size: string;
  issues: string[];
};

/** Runs only after a complete Stripe scan, with the processor's fencing token. */
export async function importDirectCampPayment(
  db: SupabaseClient,
  stripe: Stripe,
  record: Record,
  token: string,
) {
  if (
    record.booking_reference ||
    record.status !== "paid" ||
    record.issues.length
  )
    return;
  const existing = await db
    .from("camp_bookings")
    .select("id")
    .eq("stripe_payment_id", record.payment_id)
    .maybeSingle();
  if (existing.error)
    throw new Error("Buchungsstatus konnte nicht gelesen werden.");
  // Never recreate a removed booking, or reassign an already imported payment.
  if (existing.data) return;
  const draft = await db
    .from("camp_review_drafts")
    .select("payment_id")
    .eq("payment_id", record.payment_id)
    .maybeSingle();
  if (draft.error) throw new Error("Prüfentwurf konnte nicht gelesen werden.");
  if (draft.data) {
    record.issues.push(
      "Gespeicherter Prüfentwurf vorhanden. Bitte manuell übernehmen.",
    );
    return;
  }
  const names = record.child_name.trim().split(/\s+/);
  if (
    names.length < 2 ||
    !/^\d{1,2}$/.test((record.age_at_booking ?? "").trim()) ||
    !record.clothing_size?.trim()
  ) {
    record.issues.push(
      "Kindesname, Alter bei Buchung oder Kleidergröße fehlen. Bitte Angaben ergänzen.",
    );
    return;
  }
  let input;
  try {
    input = await prepareCampImport(
      db,
      stripe,
      {
        camp_id: record.camp_id,
        payment_id: record.payment_id,
        child: {
          first_name: names.slice(0, -1).join(" "),
          last_name: names.at(-1),
          age_at_booking: Number(record.age_at_booking),
          gender: "keine Angabe",
          clothing_size: record.clothing_size,
        },
      },
      record.session_id,
      null,
      { group: "new", percent: 0 },
      token,
    );
  } catch (error) {
    if (error instanceof CampImportReviewError || error instanceof ZodError) {
      record.issues.push(
        error instanceof CampImportReviewError
          ? error.message
          : "Kindesangaben ungültig. Bitte Angaben prüfen.",
      );
      return;
    }
    throw error;
  }
  const imported = await db.rpc("camp_import_review_booking", { input });
  if (imported.error) {
    // Validation is per payment. Database/transport failures must retain the last scan.
    if (imported.error.code !== "P0001")
      throw new Error("Automatische Übernahme konnte nicht ausgeführt werden.");
    record.issues.push(campImportIssue(imported.error.message));
  }
}
