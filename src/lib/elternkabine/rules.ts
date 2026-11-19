// Reine Regeln der Elternkabine (ohne Datenbank), damit sie testbar bleiben.

export type AccessLevel = "none" | "locked" | "read" | "write" | "ask";
export type Access = {
  level: AccessLevel;
  reason?: "region" | "consent_photos" | "consent_child_photos";
  grace_until?: string;
  team?: boolean;
};
export type PostKind = "text" | "question" | "tip" | "info" | "ride" | "swap";
export const POST_KINDS: PostKind[] = [
  "text",
  "question",
  "tip",
  "info",
  "ride",
  "swap",
];
export const REACTIONS = ["👍", "❤️", "🙌", "😂", "⚽", "🙏"] as const;
export const NAME_STYLES = ["full", "first_initial", "initials"] as const;
export const REPORT_REASONS = [
  "insult",
  "ads",
  "photo",
  "privacy",
  "other",
] as const;
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const AUTO_HIDE_REPORTS = 3;
export const CO_CHANGES_PER_MONTH = 2;
export const CO_INVITE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const QUESTION_ALERT_MS = 24 * 60 * 60 * 1000;
export const CONSENT_VERSION = "2026-11-19";

/** Darf dieser Beitrag mit dieser Zugriffsstufe geschrieben werden? */
export function postAllowed(input: {
  access: Access;
  kind: PostKind;
  isReply: boolean;
  channelKind: string;
  ownThread?: boolean;
}): string | null {
  const { access, kind, isReply, channelKind } = input;
  if (access.team) return null;
  if (kind === "info") return "Infos kann nur das Team veröffentlichen.";
  if (access.level === "write") return null;
  if (access.level === "ask") {
    if (!isReply)
      return kind === "question" ? null : "Hier kannst du nur Fragen stellen.";
    if (channelKind === "ask_team" && input.ownThread) return null;
    return "Antworten kommen hier vom Team.";
  }
  if (access.level === "read" && access.grace_until)
    return "Dein Abo ist beendet. Du kannst hier nur noch mitlesen.";
  if (access.level === "locked")
    return access.reason === "region"
      ? "Bitte wähle zuerst deine Region aus."
      : "Für diesen Kanal muss die Fotomediathek aktiviert sein.";
  return "In diesem Kanal kannst du nicht schreiben.";
}

const LINK = /(https?:\/\/|www\.)\S+/i;
// Telefonnummer: beginnt mit +, 00 oder 0 und hat mindestens 9 Ziffern.
// Datumsangaben (19.11.2026), Uhrzeiten und Zahlenreihen (128 140 152) bleiben erlaubt.
const PHONE_CANDIDATE = /(?:\+|(?<![\d.,:])0)\d[\d \/()-]{6,}\d/g;
export function looksLikePhone(text: string) {
  return (text.match(PHONE_CANDIDATE) ?? []).some(
    (m) => m.replace(/\D/g, "").length >= 9,
  );
}
/** Blacklist-Eintrag: „contains“ trifft auch Wortteile und Schreibtricks
 *  (A.r.s.c.h, 4rschl0ch), „word“ nur das ganze Wort bzw. den ganzen Satz. */
export type BlockedTerm = { term: string; match: "contains" | "word" };
/** Startliste, falls die Datenbank-Liste noch fehlt (vor Release 052). */
export const DEFAULT_BLOCKED_TERMS: BlockedTerm[] = [
  { term: "arschloch", match: "contains" },
  { term: "hurensohn", match: "contains" },
  { term: "wichser", match: "contains" },
  { term: "fotze", match: "contains" },
  { term: "missgeburt", match: "contains" },
  { term: "spast", match: "word" },
  { term: "behindert", match: "word" },
  { term: "halt die fresse", match: "word" },
  { term: "du opfer", match: "word" },
];
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
};
/** Kleinbuchstaben, Umlaute/Leetspeak auflösen, Buchstaben-Wiederholungen
 *  zusammenziehen, alles außer Buchstaben wird zu Leerzeichen. */
export function normalizeForFilter(text: string) {
  return text
    .toLowerCase()
    .replace(/[0134578@$äöüß]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]+/g, " ")
    .replace(/([a-z])\1+/g, "$1")
    .trim();
}
/** Welcher Blacklist-Eintrag trifft? (null = keiner) */
export function blockedTermHit(body: string, terms: BlockedTerm[]) {
  const words = ` ${normalizeForFilter(body)} `;
  const compact = words.replace(/ /g, "");
  for (const t of terms) {
    const n = normalizeForFilter(t.term);
    if (!n) continue;
    if (
      t.match === "word"
        ? words.includes(` ${n} `)
        : compact.includes(n.replace(/ /g, ""))
    )
      return t.term;
  }
  return null;
}
/** Wortfilter für Eltern-Beiträge (Team ist ausgenommen). */
export function bodyProblem(
  body: string,
  terms: BlockedTerm[] = DEFAULT_BLOCKED_TERMS,
): string | null {
  const text = body.trim();
  if (!text) return "Bitte schreib etwas.";
  if (text.length > 4000)
    return "Der Beitrag ist zu lang (max. 4.000 Zeichen).";
  if (LINK.test(text))
    return "Links sind hier nur für das Team erlaubt. Schreib die Info gern als Text.";
  if (looksLikePhone(text))
    return "Bitte keine Telefonnummern öffentlich posten. Nutze dafür „Frag das Team“ oder tauscht euch persönlich aus.";
  if (blockedTermHit(text, terms))
    return "Bitte bleib freundlich. Dieser Beitrag verstößt gegen die Regeln der Elternkabine.";
  return null;
}

/** Tage bis zum Ende der Lesefrist nach Abo-Ende (für den Hinweis unten im Chat). */
export function graceDaysLeft(
  graceUntil: string | undefined,
  now = Date.now(),
) {
  if (!graceUntil) return null;
  return Math.max(0, Math.ceil((Date.parse(graceUntil) - now) / 86400000));
}

/** Zweitkonto-Wechsel: höchstens 2 neue Zweitkonten pro Kalendermonat. */
export function coChangesLeft(createdAt: string[], now = new Date()) {
  const month = now.toISOString().slice(0, 7);
  return Math.max(
    0,
    CO_CHANGES_PER_MONTH -
      createdAt.filter((d) => d.slice(0, 7) === month).length,
  );
}
/** Gesperrtes Zweitkonto: 1 Monat ab Sperre darf das Hauptkonto es weder
 *  ändern noch entfernen. Gibt das Ende der Frist zurück (oder null). */
export const CO_BAN_LOCK_DAYS = 30;
export function coBanLockedUntil(
  bannedAt: string | null | undefined,
  now = Date.now(),
) {
  if (!bannedAt) return null;
  const until = Date.parse(bannedAt) + CO_BAN_LOCK_DAYS * 86400000;
  return until > now ? new Date(until).toISOString() : null;
}
/** Einladung höchstens einmal pro Tag. Gibt die Wartezeit in Stunden zurück. */
export function inviteWaitHours(sentAt: string | null, now = Date.now()) {
  if (!sentAt) return 0;
  const left = Date.parse(sentAt) + CO_INVITE_COOLDOWN_MS - now;
  return left > 0 ? Math.ceil(left / 3600000) : 0;
}

/** Altersklasse wie im Verein: Saison wechselt am 1. Juli. */
export function uAge(birthYear: number, now = new Date()) {
  return now.getFullYear() + (now.getMonth() >= 6 ? 1 : 0) - birthYear;
}
export const AGE_GROUPS = [
  { from: 4, to: 5 },
  { from: 6, to: 8 },
  { from: 9, to: 12 },
  { from: 13, to: 16 },
];
