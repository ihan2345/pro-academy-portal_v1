import { formatDate, formatTime } from "@/lib/domain";
import type { ReportSnapshot } from "@/lib/pdf";

/** Public appointment details only; staff reasons and private notes stay private. */
export function ExcusedNotes({ events }: { events: ReportSnapshot["events"] }) {
  const excused = events.filter(
    (event) => event.status === "excused" || event.event_cancelled,
  );
  if (!excused.length) return null;
  return (
    <section className="excused-notes" aria-label="Termine ohne Anrechnung">
      <h3>Termine ohne Anrechnung</h3>
      <p>
        Diese Termine verbrauchen keine Einheit und zählen nicht zur
        Trainingszeit.
      </p>
      <ul>
        {excused.map((event) => (
          <li key={event.id}>
            <strong>
              {event.title} ·{" "}
              {event.event_cancelled ? "Vom Team abgesagt" : "Entschuldigt"}
            </strong>
            <span>
              {formatDate(event.starts_at)} · {formatTime(event.starts_at)}–
              {formatTime(event.ends_at)} Uhr
            </span>
            {(event.event_type ||
              event.location_name ||
              event.trainer_name) && (
              <span>
                {[
                  event.event_type,
                  event.location_name,
                  event.trainer_name && `Coach: ${event.trainer_name}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BackfillNotes({
  events,
}: {
  events: ReportSnapshot["events"];
}) {
  const rows = events.filter((event) => event.retrospective);
  if (!rows.length) return null;
  return (
    <section className="backfill-notes" aria-label="Nachgetragene Trainings">
      <h3>
        Nachgetragen · {rows.length}{" "}
        {rows.length === 1 ? "Einheit" : "Einheiten"}
      </h3>
      <ul>
        {rows.map((event) => (
          <li key={event.id}>
            <strong>
              {event.title} · {event.duration_minutes} Minuten
            </strong>
            <span>
              {event.occurred_on
                ? formatDate(`${event.occurred_on}T12:00:00Z`)
                : "Trainingsdatum nicht angegeben"}{" "}
              · {event.event_type}
            </span>
            <span className="preserve-lines">{event.parent_note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
