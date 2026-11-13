import { campSchema, campEditState, maximumSeats } from "./domain";
import { z } from "zod";
import { bookingOptionSchema } from "./booking-option";
import "server-only";
import { serviceDb } from "@/lib/server/service-db";
import { HttpError } from "@/lib/server/security";
import { campSession, getCamp } from "./service";

export async function deleteUnusedCamp(id: string) {
  const actor = await campSession(true);
  if (actor.role !== "admin")
    throw new HttpError(403, "Camps löschen kann nur der Admin.");
  const { camp, offers } = await getCamp(id);
  if (camp.status !== "draft" || offers.length)
    throw new HttpError(
      409,
      "Nur ungenutzte Entwürfe ohne Zahlungsangebote können gelöscht werden. Bitte archiviere dieses Camp.",
    );
  // Restrictive foreign keys retain every booking, payment source and Stripe asset.
  // The status condition also prevents deleting a concurrently opened camp.
  const result = await serviceDb()
    .from("camps")
    .delete()
    .eq("id", id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (result.error?.code === "23503")
    throw new HttpError(
      409,
      "Dieses Camp ist bereits mit Buchungen oder Zahlungsdaten verknüpft. Bitte archiviere es.",
    );
  if (result.error)
    throw new HttpError(503, "Camp konnte nicht gelöscht werden.");
  if (!result.data)
    throw new HttpError(
      409,
      "Das Camp wurde inzwischen verändert. Bitte lade die Übersicht neu.",
    );
  return { ok: true, message: "Camp-Entwurf gelöscht." };
}

export async function saveCampBookingOption(input: unknown) {
  await campSession(true);
  const body = z
    .object({
      camp_id: z.uuid(),
      booking_option: bookingOptionSchema.nullable(),
      member_benefits_enabled: z.boolean().optional(),
      expected_version: z.number().int().nonnegative(),
    })
    .strict()
    .parse(input);
  const { camp } = await getCamp(body.camp_id);
  const r = await serviceDb()
    .from("camps")
    .update({
      booking_option: body.booking_option,
      ...(body.member_benefits_enabled === undefined
        ? {}
        : { member_benefits_enabled: body.member_benefits_enabled }),
    })
    .eq("payment_mode", camp.payment_mode)
    .eq("id", body.camp_id)
    .eq("booking_option_version", body.expected_version)
    .select("id")
    .maybeSingle();
  if (r.error)
    throw new HttpError(
      503,
      "Die Camp-Buchungsoption konnte nicht gespeichert werden.",
    );
  if (!r.data)
    throw new HttpError(
      409,
      "Das Camp wurde geändert. Bitte neu laden und erneut prüfen.",
    );
  return { ok: true };
}

export async function updateCamp(input: unknown) {
  await campSession(true);
  const body = z
    .object({ id: z.uuid(), expected_state: z.string().max(20000) })
    .parse(input);
  const fields = campSchema.parse(input);
  const { camp, offers, occupied } = await getCamp(body.id);
  const baseline = campEditState(camp);
  if (body.expected_state !== JSON.stringify(baseline))
    throw new HttpError(
      409,
      "Das Camp wurde geändert. Bitte neu laden und erneut prüfen.",
    );
  if (maximumSeats(fields) < occupied)
    throw new HttpError(
      409,
      "Die Platzzahl darf nicht unter den bereits belegten Plätzen liegen.",
    );
  if (
    fields.status === "open" &&
    (!offers.some((o) => o.kind === "main") ||
      (fields.early_bird_until && !offers.some((o) => o.kind === "early")))
  )
    throw new HttpError(
      400,
      "Vor dem Öffnen müssen die passenden Zahlungsangebote hinterlegt sein.",
    );
  const { id, main, early, ...data } = fields;
  let query = serviceDb()
    .from("camps")
    .update(data)
    .eq("id", body.id)
    .eq("payment_mode", camp.payment_mode);
  for (const [key, value] of Object.entries(baseline))
    query =
      value === null
        ? query.is(key, null)
        : query.eq(key, key === "days" ? JSON.stringify(value) : value);
  const result = await query.select("id").maybeSingle();
  if (result.error)
    throw new HttpError(
      503,
      "Camp-Einstellungen konnten nicht gespeichert werden.",
    );
  if (!result.data)
    throw new HttpError(
      409,
      "Das Camp wurde geändert. Bitte neu laden und erneut prüfen.",
    );
  return { ok: true };
}
