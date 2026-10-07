import { Temporal } from "@js-temporal/polyfill";
import { disciplineUnits, TIMEZONE } from "./domain";
import type { Period } from "./types";

export const TRAINING_GRACE_WARNING =
  "Die Einheit liegt außerhalb des Abozeitraums, bitte prüfen";

/** Exclusive boundary: midnight after the following Berlin calendar day. */
export function trainingPlanningEnd(endsAt: string): number {
  return Temporal.Instant.from(endsAt)
    .toZonedDateTimeISO(TIMEZONE)
    .startOfDay()
    .add({ days: 2 }).epochMilliseconds;
}

export function trainingGraceConfirmation(
  period: Period,
  startsAt: string,
  eventType: string,
) {
  return {
    player_id: period.player_id,
    period_id: period.id,
    period_ends_at: period.ends_at,
    starts_at: startsAt,
    event_type: eventType,
  };
}

/** Prefer a regular entitlement; grace never extends the actual subscription. */
export function trainingPeriod(
  periods: Period[],
  playerId: string,
  startsAt: string,
  eventType: string,
): { period?: Period; issue?: string; requiresConfirmation?: boolean } {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start))
    return {
      issue:
        "Bitte ein gültiges Trainingsdatum und eine eindeutige Beginnzeit wählen.",
    };
  const candidates = periods
    .filter(
      (period) =>
        period.player_id === playerId &&
        Date.parse(period.starts_at) <= start &&
        trainingPlanningEnd(period.ends_at) > start,
    )
    .sort(
      (a, b) =>
        Number(start >= Date.parse(a.ends_at)) -
          Number(start >= Date.parse(b.ends_at)) ||
        Date.parse(b.starts_at) - Date.parse(a.starts_at),
    );
  const active = candidates.filter((period) =>
    ["active", "trialing"].includes(period.status),
  );
  const eligible = active.find(
    (period) => disciplineUnits(period, eventType) > 0,
  );
  if (eligible)
    return {
      period: eligible,
      requiresConfirmation: start >= Date.parse(eligible.ends_at),
    };
  const period = active[0] ?? candidates[0];
  if (!period)
    return {
      issue:
        "Kein Leistungszeitraum zum gewählten Trainingsbeginn. Bitte Datum und Abo-Zuordnung prüfen.",
    };
  if (!active.length) {
    const issue =
      period.status === "suspended"
        ? period.subscription_status === "past_due"
          ? "Leistungszeitraum gesperrt: Die Abo-Zahlung ist überfällig. Bitte den Zahlungsstatus prüfen."
          : "Leistungszeitraum gesperrt. Bitte den Abo-Status prüfen."
        : period.status === "void"
          ? "Leistungszeitraum ungültig. Bitte die Abo-Zuordnung prüfen."
          : "Leistungszeitraum nicht aktiv. Bitte den Abo-Status prüfen.";
    return { period, issue };
  }
  return {
    period,
    issue: "Kein Kontingent für diese Trainingsart im Leistungszeitraum.",
  };
}
