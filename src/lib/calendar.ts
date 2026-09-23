import { formatDate, formatTime, remainingActiveMinutes } from "./domain";

const berlinDay = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Berlin",
});

export function calendarDate(value: string | Date = new Date()) {
  return berlinDay.format(new Date(value));
}

// Calendar arithmetic uses date-only UTC values; event grouping uses Berlin above.
export function addDays(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function monthStart(day: string) {
  return `${day.slice(0, 7)}-01`;
}

export function addMonths(day: string, amount: number) {
  const date = new Date(`${monthStart(day)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 10);
}

export function weekStart(day: string) {
  return addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
}

export function monthDays(month: string): (string | null)[] {
  const start = monthStart(month);
  const first = weekStart(start);
  return Array.from({ length: 42 }, (_, index) => {
    const day = addDays(first, index);
    return day.slice(0, 7) === start.slice(0, 7) ? day : null;
  });
}

/** Keep the cancelled history after every active appointment, in both views. */
export function compareTrainings(
  a: { status: string; starts_at: string },
  b: { status: string; starts_at: string },
) {
  return (
    Number(a.status === "cancelled") - Number(b.status === "cancelled") ||
    a.starts_at.localeCompare(b.starts_at)
  );
}

export function confirmationHint(
  event: { status: string; ends_at: string; auto_attendance_at: string },
  now = new Date().toISOString(),
): string | null {
  if (event.status === "cancelled") return null;
  const planned = `Automatische Bestätigung vorgesehen am ${formatDate(event.auto_attendance_at)} um ${formatTime(event.auto_attendance_at)} Uhr (Berliner Zeit).`;
  if (Date.parse(now) < Date.parse(event.ends_at))
    return `${planned} Die zwölf aktiven Pufferstunden beginnen nach Trainingsende; zwischen 00:00 und 06:00 Uhr pausiert die Zeit.`;
  const remaining = remainingActiveMinutes(now, event.auto_attendance_at);
  return remaining > 0
    ? `${planned} Noch ${remaining} aktive Puffer-Minuten; zwischen 00:00 und 06:00 Uhr pausiert die Zeit.`
    : `${planned} Die Pufferzeit ist abgelaufen. Noch offene Teilnahmen werden beim nächsten automatischen Prüflauf bestätigt.`;
}
