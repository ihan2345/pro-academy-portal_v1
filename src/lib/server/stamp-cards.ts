import "server-only";
import { z } from "zod";
import { renderReport } from "../pdf";
import {
  CaptureProvider,
  ProtonProvider,
  safeRecipient,
  htmlEmail,
  type MailProvider,
} from "../mail";
import { optionalBackfills } from "./v2-availability";
import { backfillColumns, backfillEvent } from "../backfills";
import type { TrainingBackfill } from "../types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "./service-db";
import { assertRole, HttpError } from "./security";
import { isRemovedParticipant } from "../domain";
import { stampCardSnapshot } from "../stamp-card";
import type { Period, Player } from "../types";
import type { ReportSnapshot } from "../pdf";

export async function loadStampCard(
  db: SupabaseClient,
  role: string,
  periodId: string,
) {
  assertRole(role, "team");
  const { data: period, error } = await db
    .from("entitlement_periods")
    .select("*")
    .eq("id", periodId)
    .maybeSingle();
  if (error) throw error;
  if (!period) throw new HttpError(404, "Leistungszeitraum nicht gefunden.");
  const [playerResult, eventsResult, backfillsResult] = await Promise.all([
    db
      .from("players")
      .select("id,first_name,last_name,birth_year,team")
      .eq("id", period.player_id)
      .is("archived_at", null)
      .maybeSingle(),
    db
      .from("event_participants")
      .select(
        "*,training_events!inner(id,title,event_type,status,starts_at,ends_at,locations(name),staff_profiles(display_name))",
      )
      .eq("period_id", periodId)
      .eq("player_id", period.player_id)
      .limit(1000),
    optionalBackfills(
      db
        .from("training_backfills")
        .select(`${backfillColumns},training_backfill_private_notes(note)`)
        .eq("period_id", periodId)
        .eq("player_id", period.player_id)
        .limit(1000),
    ),
  ]);
  if (playerResult.error) throw playerResult.error;
  if (eventsResult.error) throw eventsResult.error;
  if (backfillsResult.error) throw backfillsResult.error;
  if (!playerResult.data)
    throw new HttpError(404, "Kind nicht gefunden oder archiviert.");
  // Never silently export a truncated card.
  if (
    (eventsResult.data?.length ?? 0) >= 1000 ||
    (backfillsResult.data?.length ?? 0) >= 1000
  )
    throw new HttpError(
      400,
      "Zu viele Einträge für einen einzelnen Stempelkartenexport.",
    );
  const events = (eventsResult.data ?? [])
    .filter(
      (row) =>
        !isRemovedParticipant(
          row as Parameters<typeof isRemovedParticipant>[0],
        ),
    )
    .map((row) => ({
      ...(row.training_events as unknown as Omit<
        ReportSnapshot["events"][number],
        "status"
      >),
      event_cancelled: (row.training_events as any).status === "cancelled",
      status: row.status,
      location_name: (row.training_events as any).locations?.name ?? "",
      trainer_name:
        (row.training_events as any).staff_profiles?.display_name ?? "",
    }));
  return {
    playerId: period.player_id as string,
    backfillsAvailable: backfillsResult.available,
    privateNotes: Object.fromEntries(
      (backfillsResult.data ?? []).map((row: any) => [
        row.id,
        row.training_backfill_private_notes?.note ?? "",
      ]),
    ),
    snapshot: stampCardSnapshot(
      playerResult.data as Player,
      period as Period,
      [
        ...events,
        ...((backfillsResult.data ?? []) as unknown as TrainingBackfill[]).map(
          backfillEvent,
        ),
      ],
      new Date().toISOString(),
      process.env.WHATSAPP_NUMBER ?? "",
    ),
  };
}

export async function stampCardRecipients(role: string, playerId: string) {
  assertRole(role, "team");
  // Staff sees only the minimal contacts linked to this card, not the parents table.
  const { data, error } = await serviceDb()
    .from("parent_players")
    .select("parents!inner(id,full_name,contact_email,archived_at)")
    .eq("player_id", playerId)
    .is("parents.archived_at", null);
  if (error) throw error;
  return (data ?? [])
    .map(
      (row) =>
        row.parents as unknown as {
          id: string;
          full_name: string;
          contact_email: string;
        },
    )
    .map((parent) => ({
      id: parent.id,
      name: parent.full_name,
      email: parent.contact_email,
    }));
}

export async function queueStampCard(
  db: SupabaseClient,
  role: string,
  actorId: string,
  input: {
    period_id: string;
    parent_id?: string;
    email?: string;
    request_id: string;
  },
  manual = false,
) {
  assertRole(role, "team");
  const card = await loadStampCard(db, role, input.period_id);
  const recipients = await stampCardRecipients(role, card.playerId);
  const parent = recipients.find((item) => item.id === input.parent_id);
  if ((!manual || !input.email) && !parent)
    throw new HttpError(400, "Dieser Empfänger ist dem Kind nicht zugeordnet.");
  const recipient = z
    .email()
    .parse(manual && input.email ? input.email.trim() : parent!.email);
  const key = `stamp-card:${actorId}:${input.request_id}`;
  const adminDb = serviceDb();
  const { data: existing, error: readError } = await adminDb
    .from("notification_jobs")
    .select("id,payload,recipient")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) {
    if (
      existing.payload.period_id !== input.period_id ||
      existing.payload.parent_id !== input.parent_id ||
      existing.recipient !== recipient ||
      Boolean(existing.payload.manual_email) !== manual
    )
      throw new HttpError(
        409,
        "Diese Versandanfrage gehört zu einer anderen Stempelkarte.",
      );
    return existing.id as string;
  }
  const { data, error } = await adminDb
    .from("notification_jobs")
    .upsert(
      {
        idempotency_key: key,
        kind: "stamp_card",
        recipient,
        ...(manual ? { status: "held" } : {}),
        payload: {
          actor_id: actorId,
          ...(input.parent_id ? { parent_id: input.parent_id } : {}),
          ...(manual ? { manual_email: true } : {}),
          player_id: card.playerId,
          period_id: input.period_id,
          snapshot: card.snapshot,
        },
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (error) throw error;
  // A simultaneous retry may have inserted the same request first.
  if (!data) {
    const retry = await adminDb
      .from("notification_jobs")
      .select("id,payload,recipient")
      .eq("idempotency_key", key)
      .single();
    if (retry.error) throw retry.error;
    if (
      retry.data.payload.period_id !== input.period_id ||
      retry.data.payload.parent_id !== input.parent_id ||
      retry.data.recipient !== recipient ||
      Boolean(retry.data.payload.manual_email) !== manual
    )
      throw new HttpError(
        409,
        "Diese Versandanfrage gehört zu einer anderen Stempelkarte.",
      );
    return retry.data.id as string;
  }
  return data.id as string;
}

/** A deliberate team action claims only its own card; automatic delivery gates stay untouched. */
export async function sendStampCard(
  db: SupabaseClient,
  role: string,
  actorId: string,
  input: {
    period_id: string;
    parent_id?: string;
    email?: string;
    request_id: string;
  },
  provider: MailProvider = process.env.MAIL_PROVIDER === "proton"
    ? new ProtonProvider()
    : new CaptureProvider(),
) {
  assertRole(role, "team");
  if (process.env.CAMP_SIDE_EFFECTS_BLOCKED === "true")
    throw new HttpError(403, "Versand im lokalen Camp-Test gesperrt.");
  const id = await queueStampCard(db, role, actorId, input, true);
  const adminDb = serviceDb();
  const { data: previous, error: previousError } = await adminDb
    .from("notification_jobs")
    .select("status,attempts")
    .eq("id", id)
    .single();
  if (previousError) throw previousError;
  const { data: job, error } = await adminDb
    .from("notification_jobs")
    .update({
      status: "processing",
      locked_at: new Date().toISOString(),
      lease_token: crypto.randomUUID(),
      attempts: previous.attempts + 1,
    })
    .eq("id", id)
    .eq("kind", "stamp_card")
    .eq("payload->>actor_id", actorId)
    .eq("payload->>manual_email", "true")
    .eq("status", "held")
    .eq("attempts", previous.attempts)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!job) {
    const { data: existing, error: readError } = await adminDb
      .from("notification_jobs")
      .select("status")
      .eq("id", id)
      .single();
    if (readError) throw readError;
    if (existing.status === "sent")
      return { id, captured: provider.name === "capture" };
    throw new HttpError(
      409,
      "Versand läuft oder Ergebnis unklar. Bitte Versandprotokoll prüfen; nicht erneut senden.",
    );
  }
  let started = false;
  let recipient = job.recipient;
  try {
    recipient =
      provider.name === "capture"
        ? job.recipient
        : safeRecipient(job.recipient);
    const snapshot = job.payload.snapshot as ReportSnapshot;
    const subject = `Stempelkarte für ${snapshot.player_name}`;
    const text = `Hallo,\nim Anhang findest du die aktuelle Stempelkarte für ${snapshot.player_name}. Zum Öffnen des PDFs ist keine Anmeldung im Elternportal erforderlich.`;
    const mail = {
      to: recipient,
      subject,
      text,
      html: htmlEmail(subject, text, `${process.env.APP_URL}/stempelkarte`),
      messageId: `<${id}@proacademy-portal.local>`,
      attachments: [
        {
          filename: "ProAcademy-Stempelkarte.pdf",
          content: Buffer.from(await renderReport(snapshot, "stamp_card")),
          contentType: "application/pdf",
        },
      ],
    };
    started = true;
    const result = await provider.send(mail);
    const final = await adminDb.rpc("finish_notification", {
      input: {
        id,
        lease_token: job.lease_token,
        recipient,
        provider: provider.name,
        status: "sent",
        message_id: result.id,
      },
    });
    if (final.error) throw final.error;
    return { id, captured: provider.name === "capture" };
  } catch (error) {
    const final = await adminDb.rpc("finish_notification", {
      input: {
        id,
        lease_token: job.lease_token,
        recipient,
        provider: provider.name,
        status: started ? "uncertain" : "held",
        error:
          error instanceof Error ? error.message : "Versand fehlgeschlagen",
      },
    });
    if (final.error) throw final.error;
    throw new HttpError(
      502,
      started
        ? "Versandergebnis unklar. Bitte Versandprotokoll prüfen, bevor erneut gesendet wird."
        : "Versand fehlgeschlagen. Bitte E-Mail-Konfiguration prüfen.",
    );
  }
}
