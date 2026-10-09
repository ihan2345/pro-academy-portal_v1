import { monthDays } from "@/lib/calendar";
import { formatDate } from "@/lib/domain";

export function MonthCalendar({
  month,
  selected,
  today,
  counts,
  select,
  markers,
}: {
  month: string;
  selected: string;
  today: string;
  counts: Map<string, number>;
  select: (day: string) => void;
  markers?: Record<string, { attended: number; planned: number }>;
}) {
  const heading = `month-${month}`;
  return (
    <section className="month-calendar" aria-labelledby={heading}>
      <h2 id={heading}>
        {formatDate(`${month}T12:00:00Z`, { month: "long", year: "numeric" })}
      </h2>
      <div className="month-weekdays" aria-hidden="true">
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="month-days">
        {monthDays(month).map((day, index) =>
          day ? (
            <button
              type="button"
              key={day}
              className={`month-day${day === selected ? " is-selected" : ""}${day === today ? " is-today" : ""}`}
              aria-pressed={day === selected}
              aria-current={day === today ? "date" : undefined}
              aria-label={`${markers ? `${markers[day]?.attended ?? 0} Teilnahmen, ${markers[day]?.planned ?? 0} geplant. ` : ""}${formatDate(`${day}T12:00:00Z`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${counts.get(day) ?? 0} Termine`}
              data-date={day}
              onClick={() => select(day)}
            >
              <span>{Number(day.slice(8))}</span>
              {(counts.get(day) ?? 0) > 0 &&
                (markers ? (
                  <span className="profile-day-dots" aria-hidden="true">
                    {!!markers[day]?.attended && (
                      <span className="month-day-dot attended" />
                    )}
                    {!!markers[day]?.planned && (
                      <span className="month-day-dot planned" />
                    )}
                  </span>
                ) : (
                  <span className="month-day-dot" aria-hidden="true" />
                ))}
            </button>
          ) : (
            <span key={`empty-${index}`} aria-hidden="true" />
          ),
        )}
      </div>
    </section>
  );
}
