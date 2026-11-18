/*
 * Signierte Kalender-Links für Mails.
 *
 * Der Termin steckt im Link selbst (keine Datenbank), signiert mit HMAC-SHA256.
 * Schlüssel: ICS_LINK_SECRET oder – falls nicht gesetzt – abgeleitet aus dem
 * vorhandenen SUPABASE_SERVICE_ROLE_KEY (nie im Link, nur als HMAC-Material).
 * Links laufen 60 Tage nach dem letzten Termin ab.
 */
import { calendarLinks, icsFile, type CalendarEvent } from "./calendar";

const VERSION = "proacademy-ics-v1";
const enc = new TextEncoder();

function secret() {
  return (
    process.env.ICS_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  );
}

function b64url(data: Uint8Array) {
  let bin = "";
  for (const b of data) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string) {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

async function hmac(data: string, key: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(`${VERSION}:${key}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

type Packed = {
  i: string;
  t: string;
  s: [string, string][];
  l?: string;
  d?: string;
  u?: string;
  x: number;
};

export async function signCalendarEvent(
  event: CalendarEvent,
  key = secret(),
): Promise<string | null> {
  if (!key) return null;
  const last = Math.max(...event.slots.map((s) => Date.parse(s.ends_at)));
  const packed: Packed = {
    i: event.uid,
    t: event.title,
    s: event.slots.map((s) => [s.starts_at, s.ends_at]),
    l: event.location,
    d: event.description,
    u: event.url,
    x: Math.floor(last / 1000) + 60 * 86_400,
  };
  const body = b64url(enc.encode(JSON.stringify(packed)));
  return `${body}.${b64url(await hmac(body, key))}`;
}

export async function verifyCalendarToken(
  token: string,
  key = secret(),
  now = Date.now(),
): Promise<CalendarEvent | null> {
  if (!key || token.length > 4000) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    if (!equal(fromB64url(sig), await hmac(body, key))) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Packed;
    if (!p || typeof p.x !== "number" || p.x * 1000 < now) return null;
    if (!Array.isArray(p.s) || !p.s.length || p.s.length > 31) return null;
    return {
      uid: String(p.i),
      title: String(p.t),
      slots: p.s.map(([starts_at, ends_at]) => ({
        starts_at: new Date(starts_at).toISOString(),
        ends_at: new Date(ends_at).toISOString(),
      })),
      location: p.l,
      description: p.d,
      url: p.u,
    };
  } catch {
    return null;
  }
}

/**
 * Alles, was eine Termin-Mail braucht: Buttons (Apple über signierten Link,
 * Google, Outlook) und die .ics-Datei als Anhang.
 */
export async function mailCalendar(
  event: CalendarEvent,
  appUrl = process.env.APP_URL ?? "",
) {
  const token = await signCalendarEvent(event);
  const ics = icsFile(event);
  const attachment = {
    filename: "ProAcademy-Termin.ics",
    content: Buffer.from(ics, "utf8"),
    contentType: "text/calendar; charset=utf-8; method=PUBLISH",
  };
  const links =
    token && appUrl
      ? calendarLinks(
          event,
          new URL(`/api/public/kalender/${token}`, appUrl).href,
        )
      : null;
  return { links, attachment };
}
