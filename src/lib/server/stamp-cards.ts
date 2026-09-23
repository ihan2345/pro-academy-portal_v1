import "server-only";
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
  input: { period_id: string; parent_id: string; request_id: string },
) {
  assertRole(role, "team");
  const card = await loadStampCard(db, role, input.period_id);
  const recipients = await stampCardRecipients(role, card.playerId);
  const parent = recipients.find((item) => item.id === input.parent_id);
  if (!parent)
    throw new HttpError(400, "Dieser Empfänger ist dem Kind nicht zugeordnet.");
  const key = `stamp-card:${actorId}:${input.request_id}`;
  const adminDb = serviceDb();
  const { data: existing, error: readError } = await adminDb
    .from("notification_jobs")
    .select("id,payload")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) {
    if (
      existing.payload.period_id !== input.period_id ||
      existing.payload.parent_id !== input.parent_id
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
        recipient: parent.email,
        payload: {
          actor_id: actorId,
          parent_id: parent.id,
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
      .select("id,payload")
      .eq("idempotency_key", key)
      .single();
    if (retry.error) throw retry.error;
    if (
      retry.data.payload.period_id !== input.period_id ||
      retry.data.payload.parent_id !== input.parent_id
    )
      throw new HttpError(
        409,
        "Diese Versandanfrage gehört zu einer anderen Stempelkarte.",
      );
    return retry.data.id as string;
  }
  return data.id as string;
}
