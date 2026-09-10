import { formatDate, formatTime } from "@/lib/domain";
import type { ReportSnapshot } from "@/lib/pdf";

/** Public appointment details only; staff reasons and private notes stay private. */
export function ExcusedNotes({ events }: { events: ReportSnapshot["events"] }) {
  const excused = events.filter((event) => event.status === "excused");
  if (!excused.length) return null;
  return (
    <section className="excused-notes" aria-label="Entschuldigte Termine">
      <h3>Entschuldigt · ohne Anrechnung</h3>
      <p>
        Diese Termine verbrauchen keine Einheit und zählen nicht zur
        Trainingszeit.
      </p>
      <ul>
        {excused.map((event) => (
          <li key={event.id}>
            <strong>{event.title}</strong>
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
