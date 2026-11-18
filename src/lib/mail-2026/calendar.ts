/*
 * Kalender-Links für Termin-Mails (Design 2026, Vorschau).
 *
 * - Google (auch Android): Vorlage-URL, Wiederholung bei mehrtägigen Camps
 * - Outlook (privat / Microsoft 365): Deeplink, nur erster Termin
 * - Apple (iPhone/Mac) und alle anderen: .ics mit Erinnerungen (Anhang
 *   und/oder Download-Link aus dem Portal)
 *
 * Reine Funktionen ohne Abhängigkeiten. Zeiten immer als ISO-Zeitpunkte.
 */

export interface CalendarEvent {
  uid: string;
  title: string;
  /** Ein oder mehrere Termine (Camp = mehrere Tage). */
  slots: { starts_at: string; ends_at: string }[];
  location?: string;
  description?: string;
  url?: string;
  /** Erinnerungen in Minuten vor Beginn. Standard: 1 Tag und 2 Stunden. */
  remindersMinutes?: number[];
}

export interface CalendarLinks {
  google: string;
  outlook: string;
  office365: string;
  ics: string;
}

const utc = (iso: string) =>
  new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const outlookTime = (iso: string) =>
  new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");

function sorted(e: CalendarEvent) {
  return [...e.slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** Gleiche Uhrzeit an aufeinanderfolgenden Tagen → als tägliche Serie darstellbar. */
function dailySeries(slots: CalendarEvent["slots"]) {
  if (slots.length < 2) return false;
  const day = 86_400_000;
  return slots.every(
    (s, i) =>
      i === 0 ||
      (Date.parse(s.starts_at) - Date.parse(slots[i - 1].starts_at) === day &&
        Date.parse(s.ends_at) - Date.parse(s.starts_at) ===
          Date.parse(slots[0].ends_at) - Date.parse(slots[0].starts_at)),
  );
}

export function calendarLinks(
  e: CalendarEvent,
  icsUrl: string,
): CalendarLinks {
  const slots = sorted(e);
  const first = slots[0];
  const details = [e.description, e.url].filter(Boolean).join("\n\n");
  const google = new URL("https://calendar.google.com/calendar/render");
  google.searchParams.set("action", "TEMPLATE");
  google.searchParams.set("text", e.title);
  google.searchParams.set("dates", `${utc(first.starts_at)}/${utc(first.ends_at)}`);
  google.searchParams.set("ctz", "Europe/Berlin");
  if (e.location) google.searchParams.set("location", e.location);
  if (details) google.searchParams.set("details", details);
  if (dailySeries(slots))
    google.searchParams.set("recur", `RRULE:FREQ=DAILY;COUNT=${slots.length}`);

  const outlookFor = (host: string) => {
    const u = new URL(`https://${host}/calendar/0/deeplink/compose`);
    u.searchParams.set("path", "/calendar/action/compose");
    u.searchParams.set("rru", "addevent");
    u.searchParams.set("subject", e.title);
    u.searchParams.set("startdt", outlookTime(first.starts_at));
    u.searchParams.set("enddt", outlookTime(first.ends_at));
    if (e.location) u.searchParams.set("location", e.location);
    if (details) u.searchParams.set("body", details);
    return u.href;
  };
  return {
    google: google.href,
    outlook: outlookFor("outlook.live.com"),
    office365: outlookFor("outlook.office.com"),
    ics: icsUrl,
  };
}

function icsText(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC-5545-Zeilen auf 75 Oktette falten. */
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

/** .ics-Datei mit allen Terminen und Erinnerungen (Apple, Outlook, Android, …). */
export function icsFile(e: CalendarEvent, now = new Date()) {
  const reminders = e.remindersMinutes ?? [24 * 60, 120];
  const stamp = utc(now.toISOString());
  const events = sorted(e).flatMap((s, i) => [
    "BEGIN:VEVENT",
    `UID:${e.uid}-${i + 1}@proacademy-ak.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${utc(s.starts_at)}`,
    `DTEND:${utc(s.ends_at)}`,
    `SUMMARY:${icsText(e.title)}`,
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    ...(e.description || e.url
      ? [
          `DESCRIPTION:${icsText([e.description, e.url].filter(Boolean).join("\n\n"))}`,
        ]
      : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    ...reminders.flatMap((m) => [
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(e.title)}`,
      `TRIGGER:-PT${m}M`,
      "END:VALARM",
    ]),
    "END:VEVENT",
  ]);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ProAcademy by Ayhan & Karaman//Portal//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
  ]
    .map(fold)
    .join("\r\n")
    .concat("\r\n");
}
