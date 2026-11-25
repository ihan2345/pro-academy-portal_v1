"use client";
// Design 2026: Benachrichtigungszentrale (Glocke) im Kopfmenü. Rollenbasiert,
// nach Dringlichkeit sortiert. Liest nur bestehende Daten (PortalData) und
// bestehende, rein lesende Endpunkte. Die Stripe-Prüfung höchstens alle
// 30 Minuten je Browser. Gelesen, Zurückstellen und Erledigt
// werden nur im Browser dieses Geräts gespeichert, nichts geht an den Server.
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  EyeOff,
  CreditCard,
  ExternalLink,
  FileText,
  Globe,
  Inbox,
  LogIn,
  Mail,
  Siren,
  Layers,
  Sparkles,
  Star,
  UserPlus,
  UserRoundCheck,
  UserX,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PortalData } from "@/lib/types";
import type { StripeBillingConflictPage } from "@/lib/stripe-conflicts";
import type { Activity, ActivitySummary } from "@/lib/activities";
import { formatDate, formatTime } from "@/lib/domain";
import { addDays, calendarDate } from "@/lib/calendar";
import { CHANGED, useDecisions } from "./decisions";
import type { TrialBellEvent } from "@/lib/trials/bell";
import type { PortalAccessEvent } from "@/lib/portal-events";

type Tone = "sos" | "urgent" | "warn" | "info" | "good";
type Action =
  | { label: string; kind: "snooze"; until: number }
  | { label: string; kind: "done" }
  | { label: string; kind: "ignore" };
export type Note = {
  /** Eindeutig je Stufe: eine neue Eskalationsstufe gilt wieder als ungelesen. */
  id: string;
  /** Stabil je Sachverhalt: Erledigt und Zurückstellen hängen hieran. */
  key: string;
  tone: Tone;
  icon: LucideIcon;
  title: string;
  text: string;
  at?: string;
  href?: string;
  external?: string;
  /** Hauptaktion: springt direkt in den passenden Kontext. */
  open?: { label: string; href: string };
  actions?: Action[];
  group: "now" | "news";
  /** Kategorie für die aufklappbaren Gruppen; sonst aus `key` abgeleitet. */
  cat?: Cat;
  /** Wer, Warum, Wie, Wann – kurze Antwortzeilen unter dem Text. */
  facts?: { label: string; value: string }[];
  /** Zusammengefasste Einzelschritte (neueste zuerst). */
  steps?: { title: string; at: string }[];
};

/** Aufklappbare Kategorien unter "Jetzt wichtig", in dieser Reihenfolge. */
export type Cat = "trial" | "pay" | "training" | "reports" | "portal" | "other";
export const CATS: { id: Cat; label: string; icon: LucideIcon }[] = [
  { id: "trial", label: "Probetraining", icon: UserPlus },
  { id: "pay", label: "Zahlungen & Abos", icon: CreditCard },
  { id: "training", label: "Training", icon: CalendarDays },
  { id: "reports", label: "Berichte", icon: FileText },
  { id: "portal", label: "Portal", icon: Globe },
  { id: "other", label: "Sonstiges", icon: Inbox },
];

/** Kategorie einer Aktivität, abgeleitet aus ihrem Titel. */
export function activityCat(title: string): Cat {
  const t = title.toLowerCase();
  if (t.startsWith("probetraining")) return "trial";
  if (
    t.startsWith("einladung") ||
    t.startsWith("testeinladung") ||
    t.startsWith("elternprofil aktiviert")
  )
    return "portal";
  if (
    ["abo", "zahlung", "stripe", "rechnung", "gutschein", "kündigung"].some(
      (w) => t.includes(w),
    )
  )
    return "pay";
  if (t.includes("bericht")) return "reports";
  if (["training", "teilnahme", "stempel", "termin"].some((w) => t.includes(w)))
    return "training";
  return "other";
}

export function noteCat(n: Pick<Note, "key" | "cat">): Cat {
  if (n.cat) return n.cat;
  const k = n.key.split(":")[0];
  if (k === "trial") return "trial";
  if (["pay", "pay-check", "parent-pay", "ending"].includes(k)) return "pay";
  if (["confirm", "today", "next"].includes(k)) return "training";
  if (k === "report") return "reports";
  if (k === "portal") return "portal";
  return "other";
}

/** Zeitpunkt in ms; Hinweise ohne Zeit beschreiben den Stand jetzt. */
export const noteTime = (n: Pick<Note, "at">, now: number) => {
  const t = n.at ? Date.parse(n.at) : NaN;
  return Number.isFinite(t) ? t : now;
};

/**
 * "Jetzt wichtig" nach Dringlichkeit, dann neu vor alt. Alles andere streng
 * chronologisch, das Neueste oben.
 */
export function sortNotes(notes: Note[], now: number) {
  return [...notes].sort(
    (a, b) =>
      (a.group === "now" && b.group === "now"
        ? rank[a.tone] - rank[b.tone]
        : 0) || noteTime(b, now) - noteTime(a, now),
  );
}

/** Trennzeile innerhalb einer Kategorie. */
export function dayLabel(ms: number, now: number) {
  const day = calendarDate(new Date(Math.min(ms, now)));
  const today = calendarDate(new Date(now));
  if (day === today) return "Heute";
  if (day === addDays(today, -1)) return "Gestern";
  if (day > addDays(today, -7)) return "Diese Woche";
  return "Älter";
}

const DAY = 86400000;
const HOUR = 3600000;
/**
 * Annahme: Stripe versucht eine fehlgeschlagene Abo-Zahlung bis zu 14 Tage
 * erneut und kündigt danach. Muss zur Einstellung im Stripe-Dashboard passen.
 */
export const PAYMENT_RETRY_DAYS = 14;
const rank: Record<Tone, number> = {
  sos: 0,
  urgent: 1,
  warn: 2,
  info: 3,
  good: 4,
};

type Store = {
  seen: Record<string, number>;
  snooze: Record<string, number>;
  done: Record<string, number>;
};
const STORE = "d26-notify-v1";
/** Auf- und Zugeklappt je Kategorie, nur auf diesem Gerät. */
const CAT_STORE = "d26-notify-cats-v1";
type CatState = Partial<Record<Cat, boolean>>;
function loadCats(): CatState {
  try {
    const s = JSON.parse(localStorage.getItem(CAT_STORE) ?? "null");
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
}
const empty = (): Store => ({ seen: {}, snooze: {}, done: {} });
function load(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? "null");
    return s && typeof s === "object" ? { ...empty(), ...s } : empty();
  } catch {
    return empty();
  }
}
function save(s: Store) {
  const cutoff = Date.now() - 90 * DAY;
  const prune = (r: Record<string, number>) =>
    Object.fromEntries(Object.entries(r).filter(([, v]) => v > cutoff));
  try {
    localStorage.setItem(
      STORE,
      JSON.stringify({
        seen: prune(s.seen),
        snooze: prune(s.snooze),
        done: prune(s.done),
      }),
    );
  } catch {
    /* Ohne Speicher bleibt alles nur bis zum Neuladen gemerkt. */
  }
}

/**
 * Liest einen Endpunkt höchstens alle `ttl` Millisekunden. `shared` merkt das
 * Ergebnis für alle Tabs dieses Browsers (localStorage), sonst nur im Tab.
 */
async function cached<T>(
  url: string,
  ttl: number,
  shared = false,
): Promise<{ ok: true; v: T } | { ok: false }> {
  const key = `d26-notify:${url}`;
  const box = () => (shared ? localStorage : sessionStorage);
  const remember = (entry: { ok: boolean; v?: T }) => {
    try {
      box().setItem(key, JSON.stringify({ t: Date.now(), ...entry }));
    } catch {
      /* Egal. */
    }
  };
  try {
    const hit = JSON.parse(box().getItem(key) ?? "null");
    // Fehlschläge werden kürzer gemerkt (5 Min.), damit nicht jeder
    // Seitenaufruf erneut anfragt.
    if (hit && Date.now() - hit.t < (hit.ok === false ? 5 * 60000 : ttl))
      return hit.ok === false ? { ok: false } : { ok: true, v: hit.v as T };
  } catch {
    /* Kein Zwischenspeicher. */
  }
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      remember({ ok: false });
      return { ok: false };
    }
    const v = (await r.json()) as T;
    remember({ ok: true, v });
    return { ok: true, v };
  } catch {
    remember({ ok: false });
    return { ok: false };
  }
}

const inDays = (n: number) => (n <= 1 ? "1 Tag" : `${Math.ceil(n)} Tagen`);
const days = (n: number) => (n <= 1 ? "1 Tag" : `${Math.ceil(n)} Tage`);
const shortDate = (ms: number) =>
  formatDate(new Date(ms).toISOString(), {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/** Eskalationskette für eine fehlgeschlagene Zahlung (14 → 3 → 1 Tag). */
export function paymentNote(
  row: StripeBillingConflictPage["rows"][number],
  now: number,
): Note {
  const who = row.children.map((c) => c.name).join(", ") || row.customer;
  const child = row.children[0];
  const base = {
    key: `pay:${row.subscriptionId || row.id}`,
    icon: CreditCard,
    href: child ? `/admin/spieler/${child.id}` : "/admin/stripe",
    external: row.href,
    at: row.at,
    group: "now" as const,
    open: child
      ? { label: "Spielerkarte öffnen", href: `/admin/spieler/${child.id}` }
      : { label: "Zur Stripe-Zuordnung", href: "/admin/stripe" },
  };
  const failedAt = Date.parse(row.at);
  const deadline = failedAt + PAYMENT_RETRY_DAYS * DAY;
  const left = (deadline - now) / DAY;
  if (
    !["past_due", "unpaid", "incomplete"].includes(row.status) ||
    !Number.isFinite(left) ||
    left <= 0
  ) {
    // Abo ist schon beendet oder gesperrt: kein Countdown mehr, sondern
    // Familie kontaktieren. Nach 14 Tagen rutscht es aus "Jetzt wichtig".
    const old = now - failedAt > PAYMENT_RETRY_DAYS * DAY;
    return {
      ...base,
      id: `${base.key}:ended`,
      tone: old ? "info" : "urgent",
      group: old ? "news" : "now",
      title: row.blocked
        ? `Abo gesperrt · ${row.customer}`
        : `Abo wegen Zahlung beendet · ${row.customer}`,
      text: `${row.reason || "Offene Rechnung"} seit ${shortDate(failedAt)}. Betrifft ${who}. Familie kontaktieren und bei Bedarf neu buchen lassen.`,
      actions: [{ label: "Erledigt", kind: "done" }],
    };
  }
  if (left <= 1)
    return {
      ...base,
      id: `${base.key}:1`,
      tone: "sos",
      icon: Siren,
      title: `Kündigung morgen · ${row.customer}`,
      text: `Zahlung seit ${shortDate(failedAt)} offen. Stripe kündigt voraussichtlich am ${shortDate(deadline)}. Betrifft ${who}.`,
      actions: [
        { label: "In 4 Std. erinnern", kind: "snooze", until: now + 4 * HOUR },
        { label: "Erledigt", kind: "done" },
      ],
    };
  if (left <= 3)
    return {
      ...base,
      id: `${base.key}:3`,
      tone: "urgent",
      title: `Kündigung in ${inDays(left)} · ${row.customer}`,
      text: `Zahlung seit ${shortDate(failedAt)} offen, voraussichtliche Kündigung am ${shortDate(deadline)}. Betrifft ${who}.`,
      actions: [
        {
          label: "Einen Tag vorher erinnern",
          kind: "snooze",
          until: deadline - DAY,
        },
        { label: "Erledigt", kind: "done" },
      ],
    };
  return {
    ...base,
    id: `${base.key}:14`,
    tone: "warn",
    title: `Zahlung fehlgeschlagen · ${row.customer}`,
    text: `Noch ${days(left)} bis zur voraussichtlichen Kündigung am ${shortDate(deadline)}. Betrifft ${who}.`,
    actions: [
      {
        label: "In 7 Tagen erinnern",
        kind: "snooze",
        until: Math.min(now + 7 * DAY, deadline - 3 * DAY),
      },
      { label: "Erledigt", kind: "done" },
    ],
  };
}

const active = (e: PortalData["events"][number]) =>
  e.participants.filter((p) => !p.removed_from_event);
const needsConfirmation = (e: PortalData["events"][number], now: number) =>
  e.status !== "cancelled" &&
  Date.parse(e.ends_at) < now &&
  active(e).some((p) => p.status === "planned");

/** Hinweise, die sich aus den schon geladenen Portaldaten ergeben. */
export function portalNotes(data: PortalData, now: number, base: string) {
  const notes: Note[] = [];
  const name = (id: string) => {
    const p = data.players.find((x) => x.id === id);
    return p ? `${p.first_name} ${p.last_name}`.trim() : "Spieler";
  };
  const today = calendarDate(new Date(now).toISOString());
  const live = data.events.filter((e) => e.status !== "cancelled");
  if (data.role !== "parent") {
    const open = data.events.filter((e) => needsConfirmation(e, now));
    if (open.length) {
      const latest = [...open].sort((a, b) =>
        b.ends_at.localeCompare(a.ends_at),
      )[0];
      notes.push({
        id: `confirm:${latest.id}:${open.length}`,
        key: `confirm:${latest.id}`,
        tone: open.length > 3 ? "urgent" : "warn",
        icon: AlertTriangle,
        title: `${open.length} ${open.length === 1 ? "Termin wartet" : "Termine warten"} auf Bestätigung`,
        text: `Zuletzt ${latest.title} am ${formatDate(latest.starts_at, { day: "numeric", month: "short" })}. Danach zählen die Einheiten auf den Stempelkarten.`,
        at: latest.ends_at,
        href: data.role === "admin" ? "/admin/trainingsplanung" : "/team",
        open: {
          label: "Jetzt bestätigen",
          href: data.role === "admin" ? "/admin/trainingsplanung" : "/team",
        },
        group: "now",
      });
    }
    const todays = live
      .filter((e) => calendarDate(e.starts_at) === today)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const next = todays.find((e) => Date.parse(e.ends_at) > now);
    if (todays.length)
      notes.push({
        id: `today:${today}`,
        key: `today:${today}`,
        tone: "info",
        icon: CalendarDays,
        title: `Heute ${todays.length} ${todays.length === 1 ? "Training" : "Trainings"}`,
        text: next
          ? `Als Nächstes ${formatTime(next.starts_at)} ${next.title} · ${next.location_name}, ${active(next).length} Teilnehmer.`
          : "Alle Trainings für heute sind vorbei.",
        href: data.role === "admin" ? "/admin/trainingsplanung" : "/team",
        open: {
          label: "Tagesplan öffnen",
          href: data.role === "admin" ? "/admin/trainingsplanung" : "/team",
        },
        group: "news",
      });
  }
  // Abo endet bald: nur wenn bekannt ist, dass es nicht weiterläuft.
  const ending = data.periods.filter((p) => {
    const end = Date.parse(p.ends_at);
    return (
      end > now &&
      end - now <= 3 * DAY &&
      p.subscription_status &&
      !["active", "trialing"].includes(p.subscription_status) &&
      !data.periods.some(
        (o) =>
          o.player_id === p.player_id &&
          o.id !== p.id &&
          Date.parse(o.starts_at) >= end - DAY,
      )
    );
  });
  for (const p of ending) {
    const end = Date.parse(p.ends_at);
    const left = (end - now) / DAY;
    notes.push({
      id: `ending:${p.id}`,
      key: `ending:${p.id}`,
      tone: left <= 1 ? "urgent" : "warn",
      icon: CalendarClock,
      title:
        data.role === "parent"
          ? `${p.product_name} endet in ${inDays(left)}`
          : `Abo endet in ${inDays(left)} · ${name(p.player_id)}`,
      text:
        data.role === "parent"
          ? `Der Zeitraum für ${name(p.player_id)} läuft am ${shortDate(end)} aus. In Mein Konto kannst du verlängern.`
          : `${p.product_name} läuft am ${shortDate(end)} aus und verlängert sich nicht automatisch.`,
      href: data.role === "parent" ? "/konto" : `${base}/stempelkarten`,
      open:
        data.role === "parent"
          ? { label: "Verlängern", href: "/konto" }
          : { label: "Stempelkarte öffnen", href: `${base}/stempelkarten` },
      actions:
        data.role === "parent"
          ? undefined
          : [
              {
                label: "Morgen erinnern",
                kind: "snooze",
                until: Math.min(now + DAY, end - 2 * HOUR),
              },
              { label: "Erledigt", kind: "done" },
            ],
      group: "now",
    });
  }
  if (data.role === "parent") {
    const current = data.periods.filter(
      (p) => Date.parse(p.starts_at) <= now && Date.parse(p.ends_at) > now,
    );
    for (const p of current.filter((p) => p.subscription_status === "past_due"))
      notes.push({
        id: `parent-pay:${p.id}`,
        key: `parent-pay:${p.id}`,
        tone: "sos",
        icon: CreditCard,
        title: "Zahlung offen",
        text: `Die letzte Zahlung für ${p.product_name} (${name(p.player_id)}) ist nicht durchgegangen. Bitte prüfe deine Zahlungsmethode in Mein Konto.`,
        href: "/konto",
        open: { label: "Zahlungsmethode prüfen", href: "/konto" },
        group: "now",
      });
    const next = live
      .filter((e) => Date.parse(e.starts_at) > now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    if (next && Date.parse(next.starts_at) - now < 36 * HOUR)
      notes.push({
        id: `next:${next.id}`,
        key: `next:${next.id}`,
        tone: "info",
        icon: CalendarDays,
        title: `${calendarDate(next.starts_at) === today ? "Heute" : "Morgen"} ${formatTime(next.starts_at)} · ${next.title}`,
        text: `${next.location_name}${next.trainer_name ? ` mit ${next.trainer_name}` : ""}. Bitte 10 Minuten vorher da sein.`,
        href: "/termine",
        open: { label: "Termin ansehen", href: "/termine" },
        group: "news",
      });
    for (const r of data.reports.filter(
      (r) => now - Date.parse(r.created_at) < 21 * DAY,
    ))
      notes.push({
        id: `report:${r.id}:${r.version}`,
        key: `report:${r.id}`,
        tone: "good",
        icon: FileText,
        title: `Neuer Bericht · ${r.period_label}`,
        text: `${name(r.player_id)}: ${r.completed} von ${r.units} Einheiten absolviert. Als PDF unter Berichte.`,
        at: r.created_at,
        href: "/berichte",
        open: { label: "Bericht öffnen", href: "/berichte" },
        group: "news",
      });
  }
  return notes;
}

/** Passender Ort für eine Aktivität, abgeleitet aus ihrem Titel. */
function activityTarget(
  a: Activity,
  base: string,
  players: PortalData["players"] = [],
): Note["open"] {
  if (a.help) return { label: a.help.label, href: a.help.href };
  // Abo- und Zahlungsthemen: direkt ins Elternprofil der Familie.
  if (a.parentId && base === "/admin" && activityCat(a.title) === "pay")
    return {
      label: "Elternprofil öffnen",
      href: `/admin/elternprofile/${a.parentId}`,
    };
  // Betrifft die Aktivität ein bekanntes Kind, direkt zu dessen Spielerkarte.
  const subject = a.subject?.trim().toLowerCase();
  const player = subject
    ? players.find(
        (p) =>
          `${p.first_name} ${p.last_name}`.trim().toLowerCase() === subject,
      )
    : undefined;
  if (player && !a.title.toLowerCase().startsWith("elternprofil"))
    return {
      label: "Spielerkarte öffnen",
      href: `${base}/spieler/${player.id}`,
    };
  const admin = base === "/admin";
  const t = a.title.toLowerCase();
  if (t.startsWith("probetraining"))
    return { label: "Probetraining öffnen", href: `${base}/probetraining` };
  if (t.startsWith("spielerprofil"))
    return { label: "Spielerprofile öffnen", href: `${base}/spielerprofile` };
  if (t.startsWith("elternprofil"))
    return { label: "Elternprofile öffnen", href: `${base}/elternprofile` };
  if (t.includes("bericht"))
    return admin
      ? { label: "Berichte öffnen", href: "/admin/protokolle#report_snapshots" }
      : { label: "Stempelkarten öffnen", href: `${base}/stempelkarten` };
  if (t.includes("training") || t.includes("teilnahme"))
    return {
      label: "Trainingsplanung öffnen",
      href: admin ? "/admin/trainingsplanung" : "/team",
    };
  if (t.includes("stempel"))
    return { label: "Stempelkarten öffnen", href: `${base}/stempelkarten` };
  if (admin && (t.includes("nachricht") || t.includes("mail")))
    return {
      label: "Versandhistorie öffnen",
      href: "/admin/protokolle#notification_deliveries",
    };
  if (
    admin &&
    (t.includes("abo") || t.includes("zahlung") || t.includes("stripe"))
  )
    return { label: "Stripe-Zuordnung öffnen", href: "/admin/stripe" };
  return { label: "In Aktivitäten ansehen", href: `${base}/aktivitaeten` };
}

/** Text ohne doppelten Namen, wenn "Wer" schon als Zeile erscheint. */
function activityText(a: Activity) {
  if (a.facts?.some((f) => f.label === "Wer") || !a.subject) return a.text;
  return `${a.subject}: ${a.text}`;
}

/**
 * Fasst Ereignisse zur selben Familie bzw. zum selben Kind am selben Tag zu
 * einem Hinweis zusammen. Leitereignis: Problem vor allem anderen, sonst das
 * neueste. Reihenfolge der Gruppen: neueste zuerst.
 */
export function groupActivities(rows: Activity[]) {
  const groups = new Map<
    string,
    { key: string; label: string; rows: Activity[]; lead: Activity }
  >();
  const sorted = [...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  for (const r of sorted) {
    const who = r.family
      ? `f:${r.family}`
      : r.subject
        ? `s:${r.subject}`
        : `id:${r.id}`;
    const key = `${who}:${calendarDate(new Date(r.at))}`;
    const g = groups.get(key);
    if (!g)
      groups.set(key, {
        key,
        label: r.family ? `Familie ${r.family}` : (r.subject ?? r.title),
        rows: [r],
        lead: r,
      });
    else {
      g.rows.push(r);
      if (g.lead.tone !== "problem" && r.tone === "problem") g.lead = r;
    }
  }
  return [...groups.values()];
}

function activityNotes(
  summary: ActivitySummary | null,
  rows: Activity[],
  base: string,
  players: PortalData["players"] = [],
  issues: Activity[] = [],
  hidden: (key: string) => boolean = () => false,
  trialsShown = false,
  portalShown = false,
): Note[] {
  const notes: Note[] = [];
  // Offene Vorgänge einzeln, damit jeder für sich erledigt, ignoriert oder
  // zurückgestellt werden kann. Bei sehr vielen bleibt ein Sammelhinweis.
  const shown = issues.filter((a) => !hidden(`act:${a.id}`));
  for (const a of shown.slice(0, 20)) {
    const target = activityTarget(a, base, players)!;
    notes.push({
      id: `act-open:${a.id}`,
      key: `act:${a.id}`,
      cat: activityCat(a.title),
      tone: "warn",
      icon: AlertTriangle,
      title: a.title,
      text: activityText(a),
      at: a.at,
      href: target.href,
      open: target,
      group: "now",
      ...(a.facts?.length ? { facts: a.facts } : {}),
    });
  }
  const rest = issues.length ? shown.length - 20 : (summary?.open ?? 0);
  if (rest > 0)
    notes.push({
      id: `act-open:${rest}`,
      key: "act-open",
      tone: "warn",
      icon: Inbox,
      title: issues.length
        ? `${rest} weitere offene ${rest === 1 ? "Vorgang" : "Vorgänge"}`
        : `${rest} ${rest === 1 ? "Aktivität braucht" : "Aktivitäten brauchen"} dich`,
      text: "Offene Vorgänge aus Buchungen, Zahlungen und Trainings.",
      href: `${base}/aktivitaeten`,
      open: { label: "Offene Vorgänge ansehen", href: `${base}/aktivitaeten` },
      group: "now",
    });
  const fresh = rows
    .filter((r) => !issues.some((i) => i.id === r.id))
    // Probetraining-Mails erscheinen schon als eigene Probetraining-Hinweise.
    .filter((r) => !trialsShown || !r.title.startsWith("Probetraining"))
    // Verschickte Einladungen fasst die Kategorie „Portal“ schon zusammen.
    .filter(
      (r) =>
        !portalShown ||
        !(r.title.startsWith("Einladung") && r.tone !== "problem"),
    );
  for (const g of groupActivities(fresh).slice(0, 6)) {
    const a = g.lead,
      target = activityTarget(a, base, players)!;
    const many = g.rows.length > 1;
    notes.push({
      // Neues Ereignis in der Gruppe = wieder ungelesen.
      id: `act:${g.rows[0].id}`,
      key: many ? `act-grp:${g.key}` : `act:${a.id}`,
      cat: activityCat(a.title),
      tone:
        a.tone === "problem" ? "warn" : a.tone === "success" ? "good" : "info",
      icon: a.tone === "problem" ? AlertTriangle : many ? Layers : Sparkles,
      title: many ? `${g.label}: ${g.rows.length} Änderungen` : a.title,
      // Bei mehreren Schritten steht oben das Wichtigste, die Liste darunter.
      text: many ? `${a.title}: ${a.text}` : activityText(a),
      at: g.rows[0].at,
      href: target.href,
      open: target,
      group: "news",
      ...(a.facts?.length
        ? {
            // Die Familie steht schon im Titel, dann nur noch das Kind.
            facts: many
              ? a.facts.flatMap((f) =>
                  f.label !== "Wer"
                    ? [f]
                    : a.subject
                      ? [{ label: "Wer", value: a.subject }]
                      : [],
                )
              : a.facts,
          }
        : {}),
      ...(many
        ? { steps: g.rows.map((r) => ({ title: r.title, at: r.at })) }
        : {}),
    });
  }
  return notes;
}

/** Wer: Familie bzw. Teammitglied, wie in den übrigen Hinweisen. */
export function accessWho(e: Pick<PortalAccessEvent, "name" | "role">) {
  if (!e.role || e.role === "parent")
    return e.name ? `Familie ${e.name}` : "Eine Familie";
  const name = e.name || "Teammitglied";
  return `${name} (${e.role === "viewer" ? "Lesezugriff" : "Team"})`;
}

/** Höchstens so viele Namen je Sammelhinweis, der Rest als Zahl. */
const ACCESS_STEPS = 8;
/** Ab so vielen Ereignissen am Tag wird zusammengefasst. */
const ACCESS_SINGLE = 3;

/**
 * Kategorie „Portal“: verschickte Einladungen, Annahmen, Anmeldungen und wer
 * gerade im Portal ist. Massenereignisse (Einladungswelle, viele Anmeldungen)
 * werden je Tag zu einem Hinweis zusammengefasst; ein neues Ereignis macht den
 * Sammelhinweis wieder ungelesen.
 */
export function accessNotes(rows: PortalAccessEvent[], now: number): Note[] {
  const notes: Note[] = [];
  const recent = rows.filter((r) => now - Date.parse(r.at) < 7 * DAY);
  const byDay = (list: PortalAccessEvent[]) => {
    const m = new Map<string, PortalAccessEvent[]>();
    for (const r of [...list].sort(
      (a, b) => Date.parse(b.at) - Date.parse(a.at),
    )) {
      const d = calendarDate(new Date(r.at));
      m.set(d, [...(m.get(d) ?? []), r]);
    }
    return [...m.entries()];
  };
  const profile = (r: PortalAccessEvent) =>
    r.parent_id
      ? {
          label: "Elternprofil öffnen",
          href: `/admin/elternprofile/${r.parent_id}`,
        }
      : { label: "Elternprofile öffnen", href: "/admin/elternprofile" };
  const steps = (list: PortalAccessEvent[]) =>
    list.slice(0, ACCESS_STEPS).map((r) => ({ title: accessWho(r), at: r.at }));
  const more = (list: PortalAccessEvent[]) =>
    list.length > ACCESS_STEPS
      ? ` Dazu ${list.length - ACCESS_STEPS} weitere.`
      : "";
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;

  /** Einzeln bis ACCESS_SINGLE am Tag, sonst ein Sammelhinweis. */
  const each = (
    type: string,
    list: PortalAccessEvent[],
    single: (r: PortalAccessEvent) => Pick<Note, "title" | "text">,
    many: (n: number) => Pick<Note, "title" | "text">,
    tone: Tone,
    icon: LucideIcon,
  ) => {
    for (const [day, items] of byDay(list)) {
      if (items.length <= ACCESS_SINGLE) {
        for (const r of items)
          notes.push({
            id: `portal-${type}:${r.parent_id ?? r.user_id ?? r.name}:${r.at}`,
            key: `portal:${type}:${r.parent_id ?? r.user_id ?? r.name}:${day}`,
            cat: "portal",
            tone,
            icon,
            ...single(r),
            at: r.at,
            href: profile(r).href,
            open: profile(r),
            group: "news",
          });
        continue;
      }
      const m = many(items.length);
      notes.push({
        id: `portal-${type}:${day}:${items.length}`,
        key: `portal:${type}:${day}`,
        cat: "portal",
        tone,
        icon: Layers,
        title: m.title,
        text: `${m.text}${more(items)}`,
        at: items[0].at,
        href: "/admin/elternprofile",
        open: { label: "Elternprofile öffnen", href: "/admin/elternprofile" },
        group: "news",
        steps: steps(items),
      });
    }
  };

  // 1. Einladungen: Welle je Tag immer als ein Hinweis.
  const invites = recent.filter(
    (r) => r.kind === "invite_sent" || r.kind === "invite_failed",
  );
  for (const [day, items] of byDay(invites.filter((r) => r.wave))) {
    const sent = items.filter((r) => r.kind === "invite_sent");
    const failed = items.length - sent.length;
    notes.push({
      id: `portal-wave:${day}:${sent.length}:${failed}`,
      key: `portal:wave:${day}`,
      cat: "portal",
      tone: failed ? "warn" : "info",
      icon: Mail,
      title: `Einladungswelle: ${plural(sent.length, "Einladung", "Einladungen")} verschickt`,
      text:
        (failed
          ? `${plural(failed, "Einladung konnte", "Einladungen konnten")} nicht verschickt werden.`
          : "Jede Familie bekommt einen eigenen Link, der 14 Tage gilt.") +
        more(sent),
      at: items[0].at,
      href: "/admin/einstellungen",
      open: { label: "Einladungswelle ansehen", href: "/admin/einstellungen" },
      group: "news",
      steps: steps(sent),
    });
  }
  for (const r of invites.filter((r) => r.test))
    notes.push({
      id: `portal-test:${r.at}`,
      key: `portal:test:${r.at}`,
      cat: "portal",
      tone: r.kind === "invite_sent" ? "info" : "warn",
      icon: Mail,
      title:
        r.kind === "invite_sent"
          ? "Testeinladung verschickt"
          : "Testeinladung fehlgeschlagen",
      text:
        r.kind === "invite_sent"
          ? "Die Testeinladung ging an deine eigene Adresse."
          : "Die Testeinladung konnte nicht verschickt werden.",
      at: r.at,
      href: "/admin/einstellungen",
      open: { label: "Einladungswelle ansehen", href: "/admin/einstellungen" },
      group: "news",
    });
  each(
    "invite",
    invites.filter((r) => !r.wave && !r.test && r.kind === "invite_sent"),
    (r) => ({
      title: "Einladung verschickt",
      text: `${accessWho(r)} hat eine Einladung ins Portal bekommen.`,
    }),
    (n) => ({
      title: `${plural(n, "Einladung", "Einladungen")} verschickt`,
      text: "Einzelne Einladungen ins Portal.",
    }),
    "info",
    Mail,
  );

  // 2. Angenommen bzw. selbst aktiviert.
  each(
    "accepted",
    recent.filter((r) => r.kind === "invite_accepted"),
    (r) => ({
      title: "Einladung angenommen",
      text: `${accessWho(r)} hat die Einladung angenommen und ist jetzt im Portal.`,
    }),
    (n) => ({
      title: `${plural(n, "Einladung", "Einladungen")} angenommen`,
      text: "Diese Familien sind jetzt mit dem Portal verbunden.",
    }),
    "good",
    UserRoundCheck,
  );
  each(
    "self",
    recent.filter((r) => r.kind === "self_activated"),
    (r) => ({
      title: "Elternkonto selbst aktiviert",
      text: `${accessWho(r)} hat sich ohne Einladung mit Code angemeldet und das Konto verbunden.`,
    }),
    (n) => ({
      title: `${plural(n, "Elternkonto", "Elternkonten")} selbst aktiviert`,
      text: "Ohne Einladung mit Code angemeldet und verbunden.",
    }),
    "good",
    UserRoundCheck,
  );

  // 3. Zum ersten Mal im Portal.
  const first = recent.filter((r) => r.kind === "login" && r.first);
  each(
    "first",
    first,
    (r) => ({
      title: "Zum ersten Mal im Portal",
      text: `${accessWho(r)} hat sich zum ersten Mal angemeldet.`,
    }),
    (n) => ({
      title: `${n} zum ersten Mal im Portal`,
      text: "Erste Anmeldung im Portal.",
    }),
    "good",
    Sparkles,
  );

  // 4. Weitere Anmeldungen: je Tag ein Hinweis, je Person die letzte.
  const firstDay = new Set(
    first.map((r) => `${r.user_id}:${calendarDate(new Date(r.at))}`),
  );
  for (const [day, items] of byDay(recent.filter((r) => r.kind === "login"))) {
    const people = new Map<string, PortalAccessEvent>();
    for (const r of items) {
      const k = r.user_id ?? r.name ?? r.at;
      if (!people.has(k) && !firstDay.has(`${r.user_id}:${day}`))
        people.set(k, r);
    }
    const list = [...people.values()];
    if (!list.length) continue;
    const families = list.filter((r) => !r.role || r.role === "parent").length;
    const team = list.length - families;
    notes.push({
      id: `portal-login:${day}:${list.length}:${list[0].at}`,
      key: `portal:login:${day}`,
      cat: "portal",
      tone: "info",
      icon: LogIn,
      title: `${plural(list.length, "Anmeldung", "Anmeldungen")} im Portal`,
      text:
        [
          families ? plural(families, "Familie", "Familien") : "",
          team ? `${team} aus dem Team` : "",
        ]
          .filter(Boolean)
          .join(", ") +
        " angemeldet." +
        more(list),
      at: list[0].at,
      href: "/admin/elternprofile",
      open: { label: "Elternprofile öffnen", href: "/admin/elternprofile" },
      group: "news",
      steps: steps(list),
    });
  }

  // 5. Gerade im Portal (letzte Stunde). Neue Person = wieder ungelesen.
  const online = rows
    .filter((r) => r.kind === "online" && now - Date.parse(r.at) < HOUR)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (online.length) {
    const ids = online
      .map((r) => r.user_id ?? r.name)
      .sort()
      .join(",");
    let h = 0;
    for (const c of ids) h = (h * 31 + c.charCodeAt(0)) | 0;
    notes.push({
      id: `portal-online:${calendarDate(new Date(now))}:${(h >>> 0).toString(36)}`,
      key: "portal:online",
      cat: "portal",
      tone: "info",
      icon: Globe,
      title: `Gerade im Portal: ${online.length}`,
      text: "In der letzten Stunde im Portal aktiv." + more(online),
      at: online[0].at,
      href: "/admin/elternprofile",
      open: { label: "Elternprofile öffnen", href: "/admin/elternprofile" },
      group: "news",
      steps: steps(online),
    });
  }
  return notes;
}

/**
 * Probetraining-Ereignisse (Anfrage bis Abo-Übernahme). Was noch das Team
 * braucht, steht unter "Jetzt wichtig", der Rest 7 Tage unter "Neu".
 */
export function trialNotes(
  rows: TrialBellEvent[],
  base: string,
  now: number,
): Note[] {
  const notes: Note[] = [];
  const page = (e: TrialBellEvent) =>
    `${base}/probetraining${e.requestId ? `?request=${e.requestId}` : ""}`;
  const when = (iso?: string) =>
    iso
      ? `${formatDate(iso, { weekday: "short", day: "numeric", month: "short" })}, ${formatTime(iso)}`
      : "";
  const quote = (e: TrialBellEvent) => (e.comment ? `„${e.comment}“ ` : "");
  for (const e of rows) {
    const age = now - Date.parse(e.at);
    const open = !!e.open;
    if (!open && age > 7 * DAY) continue;
    const card = { label: "Probetraining öffnen", href: page(e) };
    let note: Omit<Note, "id" | "key" | "at" | "group"> | null = null;
    switch (e.kind) {
      case "request":
        note = {
          tone: open ? "warn" : "info",
          icon: UserPlus,
          title: `Neue Probetraining-Anfrage · ${e.child}`,
          text: open
            ? `Von ${e.parent}. Wartet auf Kontakt und einen Termin.`
            : `Von ${e.parent}.`,
        };
        break;
      case "planned":
        note = {
          tone: "info",
          icon: CalendarDays,
          title: `Probetraining eingeplant · ${e.child}`,
          text: `${e.eventTitle ?? "Training"} am ${when(e.startsAt)}.`,
        };
        break;
      case "past":
        note = {
          tone: "info",
          icon: CalendarClock,
          title: `Probetraining rückwirkend eingetragen · ${e.child}`,
          text: `${e.eventTitle ?? "Training"} am ${when(e.startsAt)}. Teilnahme ist bestätigt, als Nächstes das Feedback schreiben.`,
        };
        break;
      case "attended":
        note = {
          tone: "good",
          icon: UserRoundCheck,
          title: `Teilnahme bestätigt · ${e.child}`,
          text: "Als Nächstes das Feedback für die Eltern schreiben und freigeben.",
        };
        break;
      case "absent":
      case "excused":
        note = {
          tone: e.kind === "absent" ? "warn" : "info",
          icon: UserX,
          title: `${e.kind === "absent" ? "Nicht erschienen" : "Entschuldigt"} · ${e.child}`,
          text: `${e.eventTitle ? `${e.eventTitle}. ` : ""}Bei Bedarf einen neuen Termin vereinbaren.`,
        };
        break;
      case "closed":
        note = {
          tone: "info",
          icon: Check,
          title: `Probetraining-Anfrage beendet · ${e.child}`,
          text: `Familie ${e.parent}.`,
        };
        break;
      case "feedback":
        note = {
          tone: "good",
          icon: FileText,
          title: `Feedback freigegeben · ${e.child}`,
          text: `Die Feedbackmail an ${e.parent} wird vorbereitet.`,
        };
        break;
      case "mail_sent":
        note = {
          tone: "good",
          icon: Mail,
          title: `Feedbackmail versendet · ${e.child}`,
          text: `An ${e.parent}. Die Eltern können jetzt bewerten.`,
        };
        break;
      case "mail_failed":
        note = {
          tone: "warn",
          icon: Mail,
          title: `Feedbackmail nicht zugestellt · ${e.child}`,
          text: `Der Versand an ${e.parent} ist fehlgeschlagen oder unklar. Bitte in der Versandhistorie prüfen.`,
        };
        break;
      case "rating":
        note =
          (e.rating ?? 5) <= 2
            ? {
                tone: "urgent",
                icon: Star,
                title: `Schlechte Elternbewertung ${e.rating}/5 · ${e.child}`,
                text: `${quote(e)}Von ${e.parent}. Bitte Familie kontaktieren. Folge-Mails an Tag 7 und 14 gehen an diese Familie nicht raus.`,
              }
            : {
                tone: "good",
                icon: Star,
                title: `Elternbewertung ${e.rating}/5 · ${e.child}`,
                text: `${quote(e)}Von ${e.parent}${e.comment ? "" : ", ohne Kommentar"}.`,
              };
        break;
      case "comment":
        note = {
          tone: (e.rating ?? 5) <= 2 ? "warn" : "info",
          icon: Star,
          title: `Elternkommentar nachgereicht · ${e.child}`,
          text: `${quote(e)}Von ${e.parent} (${e.rating}/5).`,
        };
        break;
      case "day7":
      case "day14":
        note = {
          tone: "info",
          icon: Mail,
          title: `Folge-Mail Tag ${e.day} versendet · ${e.parent}`,
          text: `Betrifft ${e.child}.`,
        };
        break;
      case "followup_failed":
        note = {
          tone: "warn",
          icon: Mail,
          title: `Folge-Mail Tag ${e.day} nicht zugestellt · ${e.parent}`,
          text: `Betrifft ${e.child}. Bitte in der Versandhistorie prüfen.`,
        };
        break;
      case "unsubscribed":
        note = {
          tone: "info",
          icon: Mail,
          title: `Von Folge-Mails abgemeldet · ${e.parent}`,
          text: `Betrifft ${e.child}. Tag-7- und Tag-14-Mails gehen nicht mehr raus.`,
        };
        break;
      case "converted":
        note = {
          tone: "good",
          icon: Sparkles,
          title: `Abo übernommen · ${e.child}`,
          text: "Aus dem Probetraining ist ein Spielerprofil mit Abo geworden.",
        };
        break;
    }
    if (!note) continue;
    const mailIssue = e.kind === "mail_failed" || e.kind === "followup_failed";
    const target =
      e.kind === "converted" && e.playerId
        ? {
            label: "Spielerkarte öffnen",
            href: `${base}/spieler/${e.playerId}`,
          }
        : mailIssue && base === "/admin"
          ? {
              label: "Versandhistorie öffnen",
              href: "/admin/protokolle#notification_deliveries",
            }
          : card;
    notes.push({
      ...note,
      id: `trial:${e.id}`,
      key: `trial:${e.id}`,
      at: e.at,
      href: target.href,
      open: target,
      group: open ? "now" : "news",
    });
  }
  // "Neu" bleibt übersichtlich: höchstens 12 Probetraining-Meldungen.
  const news = notes.filter((n) => n.group === "news").slice(12);
  return notes.filter((n) => !news.includes(n));
}

function ago(iso: string | undefined, now: number) {
  if (!iso) return "";
  const d = now - Date.parse(iso);
  if (!Number.isFinite(d)) return "";
  if (d < 0) return "";
  if (d < HOUR) return `vor ${Math.max(1, Math.round(d / 60000))} Min.`;
  if (d < DAY) return `vor ${Math.round(d / HOUR)} Std.`;
  if (d < 7 * DAY) {
    const n = Math.round(d / DAY);
    return n === 1 ? "vor 1 Tag" : `vor ${n} Tagen`;
  }
  return formatDate(iso, { day: "numeric", month: "short" });
}

export function NotificationBell({
  data,
  base,
}: {
  data: PortalData;
  base: string;
}) {
  const [open, setOpen] = useState(false);
  const [store, setStore] = useState<Store>(empty);
  const [now, setNow] = useState(0);
  const [remote, setRemote] = useState<Note[]>([]);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [reload, setReload] = useState(0);
  const [catOpen, setCatOpen] = useState<CatState>({});
  // Kategorien mit Ungelesenem gehen beim Öffnen auf und bleiben es, bis
  // die Glocke wieder zugeht (auch wenn sie inzwischen gelesen sind).
  const [autoOpen, setAutoOpen] = useState<Cat[]>([]);
  useEffect(() => {
    const bump = () => setReload((n) => n + 1);
    window.addEventListener(CHANGED, bump);
    return () => window.removeEventListener(CHANGED, bump);
  }, []);
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter();
  // Sprungmarken (#reiter) brauchen eine echte Navigation, damit die Zielseite
  // den Reiter auch dann wechselt, wenn sie schon offen ist.
  const go = (href: string) => {
    if (!href.includes("#")) return router.push(href);
    if (href.split("#")[0] === window.location.pathname)
      window.location.hash = href.split("#")[1];
    else window.location.assign(href);
  };
  const staff = data.role !== "parent";
  const decisions = useDecisions(staff);

  useEffect(() => {
    setStore(load());
    setCatOpen(loadCats());
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  // Rein lesende Endpunkte, im Tab zwischengespeichert.
  useEffect(() => {
    if (!staff) return;
    let alive = true;
    // Erst nach dem Seitenaufbau laden, damit die Seite selbst Vorrang hat.
    const timer = setTimeout(async () => {
      const [summary, list, issues, conflicts, trials, access] =
        await Promise.all([
          cached<ActivitySummary>("/api/activities/summary", 5 * 60000),
          cached<{ rows: Activity[] }>(
            "/api/activities?window=0&limit=50",
            5 * 60000,
          ),
          cached<{ rows: Activity[] }>(
            "/api/activities?window=issues&limit=50",
            5 * 60000,
          ),
          data.role === "admin"
            ? cached<StripeBillingConflictPage>(
                "/api/admin/stripe-conflicts",
                30 * 60000,
                true,
              )
            : Promise.resolve(null),
          // Probetraining: 404, solange das Modul ausgeschaltet ist.
          cached<{ rows: TrialBellEvent[] }>(
            "/api/probetraining/notices",
            5 * 60000,
          ),
          // Portal (Release 064): nur Admins; ohne 064 bleibt die Liste leer.
          data.role === "admin"
            ? cached<{ ready: boolean; rows: PortalAccessEvent[] }>(
                "/api/admin/portal-events",
                2 * 60000,
              )
            : Promise.resolve(null),
        ]);
      const portal = access?.ok && access.v.ready ? access.v.rows : null;
      if (!alive) return;
      const t = Date.now();
      const unavailable: Note[] =
        conflicts && !conflicts.ok
          ? [
              {
                id: `pay-check:${Math.floor(t / DAY)}`,
                key: "pay-check",
                tone: "warn",
                icon: CreditCard,
                title: "Zahlungsprüfung gerade nicht verfügbar",
                text: "Stripe war nicht erreichbar. Offene Zahlungen siehst du unter Stripe-Zuordnung, die Glocke versucht es in ein paar Minuten erneut.",
                href: "/admin/stripe",
                open: { label: "Zur Stripe-Zuordnung", href: "/admin/stripe" },
                group: "now",
              },
            ]
          : [];
      setRemote([
        ...unavailable,
        ...(conflicts?.ok ? conflicts.v.rows : []).map((r) =>
          paymentNote(r, t),
        ),
        ...activityNotes(
          summary.ok ? summary.v : null,
          list.ok ? list.v.rows : [],
          base,
          data.players,
          issues.ok ? issues.v.rows : [],
          undefined,
          trials.ok,
          !!portal,
        ),
        ...(trials.ok ? trialNotes(trials.v.rows, base, t) : []),
        ...(portal ? accessNotes(portal, t) : []),
      ]);
    }, 2500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [staff, data.role, base, reload]);

  const all = useMemo(() => {
    if (!now) return [];
    return sortNotes([...remote, ...portalNotes(data, now, base)], now);
  }, [remote, data, now, base]);
  // Markierungen: bei Mitarbeitern gemeinsam gespeichert (Release 050),
  // ältere Markierungen aus diesem Browser gelten weiter.
  const remindAt = (key: string) => {
    const d = decisions.map[key];
    return d?.state === "snoozed" && d.remind_at
      ? Math.max(Date.parse(d.remind_at), store.snooze[key] ?? 0)
      : (store.snooze[key] ?? 0);
  };
  const closed = (key: string) =>
    !!store.done[key] ||
    ["done", "ignored"].includes(decisions.map[key]?.state ?? "");
  const visible = all.filter((n) => !closed(n.key) && !(remindAt(n.key) > now));
  const snoozed = all.filter((n) => !closed(n.key) && remindAt(n.key) > now);
  const unseen = visible.filter((n) => !store.seen[n.id]);
  const now_ = visible.filter((n) => n.group === "now");
  const news = visible.filter((n) => n.group === "news");
  // Mitarbeiter: "Neu" nach Art aufklappbar. Eltern haben wenige Hinweise
  // und sehen eine einfache, chronologische Liste.
  const groups = CATS.map((c) => ({
    ...c,
    notes: news.filter((n) => noteCat(n) === c.id),
  })).filter((g) => g.notes.length);
  const isOpen = (c: Cat) => catOpen[c] ?? autoOpen.includes(c);
  const shown = staff
    ? [...now_, ...news.filter((n) => isOpen(noteCat(n)))]
    : visible;
  const shownUnseen = shown.filter((n) => !store.seen[n.id]);
  const sos = visible.some((n) => n.tone === "sos");

  const update = useCallback((fn: (s: Store) => Store) => {
    setStore((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  // Beim Öffnen: Kategorien mit Ungelesenem aufklappen.
  const unseenCats = [
    ...new Set(unseen.filter((n) => n.group === "news").map(noteCat)),
  ]
    .sort()
    .join(",");
  useEffect(() => {
    if (!open) {
      setAutoOpen([]);
      return;
    }
    if (!unseenCats) return;
    setAutoOpen((prev) => {
      const add = (unseenCats.split(",") as Cat[]).filter(
        (c) => !prev.includes(c),
      );
      return add.length ? [...prev, ...add] : prev;
    });
  }, [open, unseenCats]);
  const toggleCat = (c: Cat) =>
    setCatOpen((prev) => {
      const next = { ...prev, [c]: !(prev[c] ?? autoOpen.includes(c)) };
      try {
        localStorage.setItem(CAT_STORE, JSON.stringify(next));
      } catch {
        /* Dann nur bis zum Neuladen. */
      }
      return next;
    });

  // Automatisch gelesen: was im offenen Fenster kurz sichtbar war
  // (zugeklappte Kategorien bleiben ungelesen).
  useEffect(() => {
    if (!open || !shownUnseen.length) return;
    const ids = shownUnseen.map((n) => n.id);
    const t = setTimeout(
      () =>
        update((s) => ({
          ...s,
          seen: {
            ...s.seen,
            ...Object.fromEntries(ids.map((id) => [id, Date.now()])),
          },
        })),
      1200,
    );
    return () => clearTimeout(t);
  }, [open, shownUnseen, update]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function act(n: Note, a: Action) {
    if (staff) {
      void decisions.decide(
        n.key,
        a.kind === "done"
          ? "done"
          : a.kind === "ignore"
            ? "ignored"
            : "snoozed",
        a.kind === "snooze" ? a.until : undefined,
      );
      return;
    }
    update((s) =>
      a.kind === "snooze"
        ? { ...s, snooze: { ...s.snooze, [n.key]: a.until } }
        : { ...s, done: { ...s.done, [n.key]: Date.now() } },
    );
  }
  /** Jeder offene Hinweis für Mitarbeiter: Erinnern, Erledigt, Ignorieren. */
  const actionsFor = (n: Note): Action[] | undefined => {
    if (!staff || n.group !== "now") return n.actions;
    const list = [...(n.actions ?? [])];
    if (!list.some((a) => a.kind === "snooze"))
      list.unshift({
        label: "In 7 Tagen erinnern",
        kind: "snooze",
        until: now + 7 * DAY,
      });
    if (!list.some((a) => a.kind === "done"))
      list.push({ label: "Erledigt", kind: "done" });
    list.push({ label: "Ignorieren", kind: "ignore" });
    return list;
  };

  /** Liste mit Trennzeilen Heute / Gestern / Diese Woche / Älter. */
  const dayList = (list: Note[]) => {
    const labels = list.map((n) => dayLabel(noteTime(n, now), now));
    const split = new Set(labels).size > 1;
    return (
      <ul>
        {list.map((n, i) => (
          <Fragment key={n.id}>
            {split && labels[i] !== labels[i - 1] && (
              <li className="d26-note-day" aria-hidden>
                {labels[i]}
              </li>
            )}
            {item(n)}
          </Fragment>
        ))}
      </ul>
    );
  };
  const item = (n: Note) => (
    <li
      key={n.id}
      className={`d26-note tone-${n.tone} ${store.seen[n.id] ? "" : "is-new"} ${n.href ? "is-link" : ""}`}
      onClick={(e) => {
        if (!n.href || (e.target as HTMLElement).closest("a,button")) return;
        setOpen(false);
        go(n.href);
      }}
    >
      <span className="d26-note-icon">
        <n.icon size={16} />
      </span>
      <div>
        <Link
          href={n.href ?? "#"}
          className="d26-note-title"
          onClick={() => setOpen(false)}
        >
          {n.tone === "sos" && <em>Notsignal</em>}
          {n.title}
        </Link>
        <p>{n.text.replace(/\.\./g, ".")}</p>
        {!!n.facts?.length && (
          <ul className="d26-note-facts">
            {n.facts.map((f) => (
              <li key={f.label}>{f.value}</li>
            ))}
          </ul>
        )}
        {!!n.steps?.length && (
          <ol className="d26-note-steps">
            {n.steps.map((st, i) => (
              <li key={i}>
                <time dateTime={st.at}>{formatTime(st.at)}</time> {st.title}
              </li>
            ))}
          </ol>
        )}
        <div className="d26-note-meta">
          {n.at && <small>{ago(n.at, now)}</small>}
          {n.external && (
            <a href={n.external} target="_blank" rel="noreferrer">
              Stripe <ExternalLink size={11} />
            </a>
          )}
        </div>
        {(!!actionsFor(n)?.length || n.open) && (
          <div className="d26-note-actions">
            {n.open && (
              <Link
                href={n.open.href}
                className="is-open"
                onClick={(e) => {
                  setOpen(false);
                  if (n.open!.href.includes("#")) {
                    e.preventDefault();
                    go(n.open!.href);
                  }
                }}
              >
                {n.open.label} <ArrowRight size={13} />
              </Link>
            )}
            {(actionsFor(n) ?? []).map((a) => (
              <button
                key={a.label}
                type="button"
                className={
                  a.kind === "done"
                    ? "is-done"
                    : a.kind === "ignore"
                      ? "is-ignore"
                      : ""
                }
                onClick={() => act(n, a)}
              >
                {a.kind === "done" ? (
                  <Check size={13} />
                ) : a.kind === "ignore" ? (
                  <EyeOff size={13} />
                ) : (
                  <Clock3 size={13} />
                )}
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );

  return (
    <div className="d26-bell-wrap" ref={root}>
      <button
        type="button"
        className={`d26-bell ${sos ? "is-sos" : ""} ${unseen.length ? "has-new" : ""}`}
        aria-label={`Mitteilungen${unseen.length ? `, ${unseen.length} neu` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={17} />
        {(unseen.length > 0 || sos) && (
          <span className="d26-bell-badge">{unseen.length || "!"}</span>
        )}
      </button>
      {open && (
        <div className="d26-notes" role="dialog" aria-label="Mitteilungen">
          <header>
            <div>
              <b>Mitteilungen</b>
              <small>
                {visible.length
                  ? `${now_.length} wichtig · ${news.length} neu`
                  : "Alles erledigt"}
              </small>
            </div>
            {unseen.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  update((s) => ({
                    ...s,
                    seen: {
                      ...s.seen,
                      ...Object.fromEntries(
                        visible.map((n) => [n.id, Date.now()]),
                      ),
                    },
                  }))
                }
              >
                Alle gelesen
              </button>
            )}
          </header>
          <div className="d26-notes-body">
            {!visible.length && (
              <p className="d26-notes-empty">
                <Check size={18} /> Nichts Offenes. Neue Hinweise erscheinen
                hier automatisch.
              </p>
            )}
            {!!now_.length && (
              <>
                <h4>Jetzt wichtig</h4>
                <ul>{now_.map(item)}</ul>
              </>
            )}
            {!!news.length && !staff && (
              <>
                <h4>Für dich</h4>
                {dayList(news)}
              </>
            )}
            {!!groups.length && staff && (
              <>
                <h4>Neu</h4>
                {groups.map((g) => {
                  const fresh = g.notes.filter((n) => !store.seen[n.id]).length;
                  const expanded = isOpen(g.id);
                  return (
                    <section
                      key={g.id}
                      className={`d26-notes-cat ${expanded ? "is-open" : ""}`}
                    >
                      <button
                        type="button"
                        className="d26-notes-cat-head"
                        aria-expanded={expanded}
                        onClick={() => toggleCat(g.id)}
                      >
                        <span className="d26-note-icon">
                          <g.icon size={15} />
                        </span>
                        <b>{g.label}</b>
                        {fresh > 0 && (
                          <span className="d26-notes-cat-new">{fresh} neu</span>
                        )}
                        <small>{g.notes.length}</small>
                        <ChevronDown size={15} className="d26-notes-cat-chev" />
                      </button>
                      {expanded && dayList(g.notes)}
                    </section>
                  );
                })}
              </>
            )}
            {!!snoozed.length && (
              <>
                <button
                  type="button"
                  className="d26-notes-snoozed"
                  onClick={() => setShowSnoozed((v) => !v)}
                >
                  <Clock3 size={13} /> {snoozed.length} zurückgestellt
                </button>
                {showSnoozed && (
                  <ul className="is-snoozed">
                    {snoozed.map((n) => (
                      <li key={n.id} className={`d26-note tone-${n.tone}`}>
                        <span className="d26-note-icon">
                          <n.icon size={16} />
                        </span>
                        <div>
                          <span className="d26-note-title">{n.title}</span>
                          <p>
                            Erinnert wieder {shortDate(remindAt(n.key) || now)},{" "}
                            {formatTime(
                              new Date(remindAt(n.key) || now).toISOString(),
                            )}
                            .
                          </p>
                          <div className="d26-note-actions">
                            <button
                              type="button"
                              onClick={() => {
                                update((s) => {
                                  const snooze = { ...s.snooze };
                                  delete snooze[n.key];
                                  return { ...s, snooze };
                                });
                                if (staff) void decisions.decide(n.key, "open");
                              }}
                            >
                              Jetzt wieder zeigen
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          {staff && (
            <footer>
              {decisions.error ||
                (decisions.available
                  ? "Erledigt, Ignorieren und Erinnern gelten für alle im Team. Gelesen gilt für dieses Gerät."
                  : "Markierungen gelten vorerst für dieses Gerät.")}
            </footer>
          )}
        </div>
      )}
    </div>
  );
}
