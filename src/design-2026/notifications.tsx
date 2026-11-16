"use client";
// Design 2026: Benachrichtigungszentrale (Glocke) im Kopfmenü. Rollenbasiert,
// nach Dringlichkeit sortiert. Liest nur bestehende Daten (PortalData) und
// bestehende, rein lesende Endpunkte. Die Stripe-Prüfung höchstens alle
// 30 Minuten je Browser. Gelesen, Zurückstellen und Erledigt
// werden nur im Browser dieses Geräts gespeichert, nichts geht an den Server.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  Clock3,
  CreditCard,
  ExternalLink,
  FileText,
  Inbox,
  Siren,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PortalData } from "@/lib/types";
import type { StripeBillingConflictPage } from "@/lib/stripe-conflicts";
import type { Activity, ActivitySummary } from "@/lib/activities";
import { formatDate, formatTime } from "@/lib/domain";
import { calendarDate } from "@/lib/calendar";

type Tone = "sos" | "urgent" | "warn" | "info" | "good";
type Action =
  | { label: string; kind: "snooze"; until: number }
  | { label: string; kind: "done" };
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
};

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

function activityNotes(
  summary: ActivitySummary | null,
  rows: Activity[],
  base: string,
  players: PortalData["players"] = [],
): Note[] {
  const notes: Note[] = [];
  if (summary?.open)
    notes.push({
      id: `act-open:${summary.open}`,
      key: "act-open",
      tone: "warn",
      icon: Inbox,
      title: `${summary.open} ${summary.open === 1 ? "Aktivität braucht" : "Aktivitäten brauchen"} dich`,
      text: "Offene Vorgänge aus Buchungen, Zahlungen und Trainings.",
      href: `${base}/aktivitaeten`,
      open: { label: "Offene Vorgänge ansehen", href: `${base}/aktivitaeten` },
      group: "now",
    });
  for (const a of rows.slice(0, 4))
    notes.push({
      id: `act:${a.id}`,
      key: `act:${a.id}`,
      tone:
        a.tone === "problem" ? "warn" : a.tone === "success" ? "good" : "info",
      icon: a.tone === "problem" ? AlertTriangle : Sparkles,
      title: a.title,
      text: a.subject ? `${a.subject}: ${a.text}` : a.text,
      at: a.at,
      href: activityTarget(a, base, players)!.href,
      open: activityTarget(a, base, players),
      group: "news",
    });
  return notes;
}

function ago(iso: string | undefined, now: number) {
  if (!iso) return "";
  const d = now - Date.parse(iso);
  if (!Number.isFinite(d)) return "";
  if (d < 0) return "";
  if (d < HOUR) return `vor ${Math.max(1, Math.round(d / 60000))} Min.`;
  if (d < DAY) return `vor ${Math.round(d / HOUR)} Std.`;
  if (d < 7 * DAY) return `vor ${Math.round(d / DAY)} Tagen`;
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

  useEffect(() => {
    setStore(load());
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
      const [summary, list, conflicts] = await Promise.all([
        cached<ActivitySummary>("/api/activities/summary", 5 * 60000),
        cached<{ rows: Activity[] }>(
          "/api/activities?window=0&limit=3",
          5 * 60000,
        ),
        data.role === "admin"
          ? cached<StripeBillingConflictPage>(
              "/api/admin/stripe-conflicts",
              30 * 60000,
              true,
            )
          : Promise.resolve(null),
      ]);
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
        ),
      ]);
    }, 2500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [staff, data.role, base]);

  const all = useMemo(() => {
    if (!now) return [];
    return [...remote, ...portalNotes(data, now, base)].sort(
      (a, b) =>
        rank[a.tone] - rank[b.tone] || (b.at ?? "").localeCompare(a.at ?? ""),
    );
  }, [remote, data, now, base]);
  const visible = all.filter(
    (n) => !store.done[n.key] && !((store.snooze[n.key] ?? 0) > now),
  );
  const snoozed = all.filter(
    (n) => !store.done[n.key] && (store.snooze[n.key] ?? 0) > now,
  );
  const unseen = visible.filter((n) => !store.seen[n.id]);
  const sos = visible.some((n) => n.tone === "sos");

  const update = useCallback((fn: (s: Store) => Store) => {
    setStore((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  // Automatisch gelesen: was im offenen Fenster kurz sichtbar war.
  useEffect(() => {
    if (!open || !unseen.length) return;
    const ids = unseen.map((n) => n.id);
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
  }, [open, unseen, update]);

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
    update((s) =>
      a.kind === "done"
        ? { ...s, done: { ...s.done, [n.key]: Date.now() } }
        : { ...s, snooze: { ...s.snooze, [n.key]: a.until } },
    );
  }

  const now_ = visible.filter((n) => n.group === "now");
  const news = visible.filter((n) => n.group === "news");
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
        <div className="d26-note-meta">
          {n.at && <small>{ago(n.at, now)}</small>}
          {n.external && (
            <a href={n.external} target="_blank" rel="noreferrer">
              Stripe <ExternalLink size={11} />
            </a>
          )}
        </div>
        {(!!n.actions?.length || n.open) && (
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
            {(n.actions ?? []).map((a) => (
              <button
                key={a.label}
                type="button"
                className={a.kind === "done" ? "is-done" : ""}
                onClick={() => act(n, a)}
              >
                {a.kind === "done" ? <Check size={13} /> : <Clock3 size={13} />}
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
            {!!news.length && (
              <>
                <h4>{staff ? "Neu und heute" : "Für dich"}</h4>
                <ul>{news.map(item)}</ul>
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
                            Erinnert wieder{" "}
                            {shortDate(store.snooze[n.key] ?? now)},{" "}
                            {formatTime(
                              new Date(
                                store.snooze[n.key] ?? now,
                              ).toISOString(),
                            )}
                            .
                          </p>
                          <div className="d26-note-actions">
                            <button
                              type="button"
                              onClick={() =>
                                update((s) => {
                                  const snooze = { ...s.snooze };
                                  delete snooze[n.key];
                                  return { ...s, snooze };
                                })
                              }
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
            <footer>Gelesen und Zurückstellen gelten für dieses Gerät.</footer>
          )}
        </div>
      )}
    </div>
  );
}
