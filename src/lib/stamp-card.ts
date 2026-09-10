import { attendanceStats } from "./domain";
import type { Period, Player } from "./types";
import type { ReportSnapshot } from "./pdf";

/** Explicit public fields only: internal notes and other participants never leave here. */
export function stampCardSnapshot(
  player: Player,
  period: Period,
  events: ReportSnapshot["events"],
  createdAt: string,
  whatsapp: string,
): ReportSnapshot {
  const rows = events
    .map((event) => ({
      id: event.id,
      title: event.title,
      event_type: event.event_type,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      status: event.status,
      location_name: event.location_name,
      trainer_name: event.trainer_name,
    }))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const stats = attendanceStats(rows);
  return {
    player_name: `${player.first_name} ${player.last_name}`,
    product_name: period.product_name,
    starts_at: period.starts_at,
    ends_at: period.ends_at,
    included_units: period.included_units,
    athletics_units: period.athletics_units ?? 0,
    completed: stats.completed,
    minutes: stats.minutes,
    created_at: createdAt,
    version: 1,
    attendance_policy: "charged_absences_v1",
    whatsapp,
    events: rows,
  };
}
