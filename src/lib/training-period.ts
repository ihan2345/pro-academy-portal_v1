import { disciplineUnits } from "./domain";
import type { Period } from "./types";

/** Match the database's start-inclusive, end-exclusive training eligibility. */
export function trainingPeriod(
  periods: Period[],
  playerId: string,
  startsAt: string,
  eventType: string,
): { period?: Period; issue?: string } {
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
        Date.parse(period.ends_at) > start,
    )
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  const active = candidates.filter((period) =>
    ["active", "trialing"].includes(period.status),
  );
  const eligible = active.find(
    (period) => disciplineUnits(period, eventType) > 0,
  );
  if (eligible) return { period: eligible };
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
