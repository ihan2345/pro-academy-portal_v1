import type { TrainingBackfill } from "./types";
import type { ReportSnapshot } from "./pdf";

/** Timestamps are ordering metadata only; a backfill's actual date is occurred_on. */
export function backfillEvent(
  row: TrainingBackfill,
): ReportSnapshot["events"][number] {
  return {
    id: row.id,
    title: row.title,
    event_type: row.event_type,
    starts_at: row.created_at,
    ends_at: row.created_at,
    status: "attended_manual",
    retrospective: true,
    occurred_on: row.occurred_on,
    duration_minutes: row.duration_minutes,
    parent_note: row.parent_note,
    location_name: row.locations?.name ?? "",
    trainer_name: row.staff_profiles?.display_name ?? "",
  };
}
export const backfillColumns =
  "id,period_id,player_id,title,event_type,occurred_on,duration_minutes,parent_note,created_at,locations(name),staff_profiles(display_name)";
