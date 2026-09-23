import { Temporal } from "@js-temporal/polyfill";
export const TIMEZONE = "Europe/Berlin";
export type Role = "parent" | "staff" | "admin";
export type Attendance =
  | "planned"
  | "attended_auto"
  | "attended_manual"
  | "absent"
  | "excused"
  | "cancelled";
export const STATUS_LABELS: Record<Attendance, string> = {
  planned: "Geplant",
  attended_auto: "Absolviert",
  attended_manual: "Absolviert",
  absent: "Nicht erschienen",
  excused: "Entschuldigt",
  cancelled: "Abgesagt",
};
/** Legacy tariff values. Live entitlements always use the price-specific frozen snapshot. */
export const LEGACY_PLAN_UNITS = {
  FirstTouch: 4,
  GameChanger: 8,
  "Pro-Player": 10,
} as const;
export const isAttended = (status: Attendance) =>
  status === "attended_auto" || status === "attended_manual";
export const isChargedAbsence = (status: Attendance) =>
  status === "cancelled" || status === "absent";
export const countsAsUnit = (status: Attendance) =>
  isAttended(status) || isChargedAbsence(status);
/** Legacy editor removals predate the dedicated migration column. */
export const isRemovedParticipant = (row: {
  removed_from_event?: boolean;
  status: Attendance;
  reason?: string | null;
}) =>
  row.removed_from_event ??
  (row.status === "cancelled" && row.reason === "Aus Termin entfernt");
export function calculateAutoAttendanceAt(
  eventEnd: string | Date,
  timezone = TIMEZONE,
): string {
  let current = Temporal.Instant.from(
    eventEnd instanceof Date ? eventEnd.toISOString() : eventEnd,
  ).toZonedDateTimeISO(timezone);
  let remaining = 12 * 3600;
  while (remaining > 0) {
    if (current.hour < 6)
      current = current.with({
        hour: 6,
        minute: 0,
        second: 0,
        millisecond: 0,
        microsecond: 0,
        nanosecond: 0,
      });
    const midnight = current.startOfDay().add({ days: 1 });
    const available =
      Number(midnight.epochNanoseconds - current.epochNanoseconds) / 1e9;
    if (remaining < available)
      return current.add({ seconds: remaining }).toInstant().toString();
    remaining -= available;
    current = midnight.with({ hour: 6 });
  }
  return current.toInstant().toString();
}
export function remainingActiveMinutes(
  now: string,
  deadline: string,
  timezone = TIMEZONE,
): number {
  let current = Temporal.Instant.from(now).toZonedDateTimeISO(timezone);
  const end = Temporal.Instant.from(deadline);
  let seconds = 0;
  while (Temporal.Instant.compare(current.toInstant(), end) < 0) {
    if (current.hour < 6)
      current = current.with({
        hour: 6,
        minute: 0,
        second: 0,
        millisecond: 0,
        microsecond: 0,
        nanosecond: 0,
      });
    if (Temporal.Instant.compare(current.toInstant(), end) >= 0) break;
    const midnight = current.startOfDay().add({ days: 1 });
    const stop =
      Temporal.Instant.compare(midnight.toInstant(), end) < 0
        ? midnight.toInstant()
        : end;
    seconds += Number(stop.epochNanoseconds - current.epochNanoseconds) / 1e9;
    current = midnight;
  }
  return Math.max(0, Math.ceil(seconds / 60));
}
export function localToUtc(date: string, time: string, timezone = TIMEZONE) {
  return Temporal.PlainDateTime.from(`${date}T${time}`)
    .toZonedDateTime(timezone, { disambiguation: "reject" })
    .toInstant()
    .toString();
}
export function periodFromStripe(start: number, end: number) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    end <= start
  )
    throw new Error("Ungültiger Stripe-Leistungszeitraum");
  return {
    starts_at: new Date(start * 1000).toISOString(),
    ends_at: new Date(end * 1000).toISOString(),
  };
}
export function periodLabel(start: string, end: string) {
  return `${formatDate(start)} – ${formatDate(new Date(new Date(end).getTime() - 1).toISOString())}`;
}
export function formatDate(
  value: string,
  opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  },
) {
  return new Intl.DateTimeFormat("de-DE", {
    ...opts,
    timeZone: TIMEZONE,
  }).format(new Date(value));
}
export function formatTime(value: string) {
  return formatDate(value, { hour: "2-digit", minute: "2-digit" });
}
export function durationMinutes(start: string, end: string) {
  const value = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("Ungültige Trainingsdauer");
  return Math.round(value);
}
export function durationLabel(minutes: number) {
  return `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
}
export function attendanceStats(
  rows: {
    status: Attendance;
    starts_at: string;
    ends_at: string;
    retrospective?: boolean;
    duration_minutes?: number;
  }[],
) {
  const completed = rows.filter((row) => isAttended(row.status));
  const charged = rows.filter((row) => isChargedAbsence(row.status)).length;
  return {
    completed: completed.length + charged,
    charged,
    retrospective: completed.filter((row) => row.retrospective).length,
    planned: rows.filter((row) => row.status === "planned").length,
    minutes: completed.reduce(
      (n, row) =>
        n +
        (row.retrospective
          ? (row.duration_minutes ?? 0)
          : durationMinutes(row.starts_at, row.ends_at)),
      0,
    ),
    neutral: rows.filter((row) => row.status === "excused").length,
  };
}
export function stampSlots(
  units: number,
  completed: number,
  planned: number,
  charged = 0,
  retrospective = 0,
): ("done" | "retrospective" | "charged" | "planned" | "open")[] {
  return Array.from({ length: units }, (_, i) =>
    i < completed - charged - retrospective
      ? "done"
      : i < completed - charged
        ? "retrospective"
        : i < completed
          ? "charged"
          : i < completed + planned
            ? "planned"
            : "open",
  );
}
export function reportDueAt(
  end: string,
  sendTime = "08:00",
  timezone = TIMEZONE,
) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime))
    throw new Error("Ungültige Berichtszeit");
  const local = Temporal.Instant.from(end).toZonedDateTimeISO(timezone);
  const [hour, minute] = sendTime.split(":").map(Number);
  const due = local.with({
    hour,
    minute,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  });
  return (Temporal.ZonedDateTime.compare(due, local) < 0 ? local : due)
    .toInstant()
    .toString();
}
export function whatsappLink(
  number: string,
  child: string,
  start: string,
  id: string,
  discrepancy = false,
) {
  const message = discrepancy
    ? `Hallo ProAcademy-Team, ich möchte eine Unstimmigkeit zum Training von ${child} am ${formatDate(start)} um ${formatTime(start)} melden. Termin-ID: ${id}.`
    : `Hallo ProAcademy-Team, ich habe eine Frage oder Änderung zum Training von ${child} am ${formatDate(start)} um ${formatTime(start)}. Termin-ID: ${id}.`;
  return `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

export function trainingDiscipline(
  eventType?: string,
): "football" | "athletics" {
  return eventType === "Athletiktraining" ? "athletics" : "football";
}
export function disciplineStats(
  rows: {
    status: Attendance;
    starts_at: string;
    ends_at: string;
    event_type?: string;
    retrospective?: boolean;
    duration_minutes?: number;
  }[],
) {
  return {
    football: attendanceStats(
      rows.filter((r) => trainingDiscipline(r.event_type) === "football"),
    ),
    athletics: attendanceStats(
      rows.filter((r) => trainingDiscipline(r.event_type) === "athletics"),
    ),
  };
}
export function disciplineUnits(
  period: { included_units: number; athletics_units?: number } | undefined,
  eventType: string,
) {
  if (!period) return 0;
  return trainingDiscipline(eventType) === "athletics"
    ? (period.athletics_units ?? 0)
    : period.included_units - (period.athletics_units ?? 0);
}
