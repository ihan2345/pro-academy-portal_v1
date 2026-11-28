"use client";
// Design 2026: Menü im Stil der Kacheln. Suche im Menü, aufklappbare
// Kategorien mit Summen-Chip, Zahlen-Chips je Punkt, Heute-Kachel,
// Profil-Kachel mit Sheet und am Handy „Mehr“ als Kachel-Sheet.
// Liest nur Daten, die das Portal schon hat (plus die bestehende
// Probetraining-Zusammenfassung); keine neuen Abfragen, keine DB-Änderung.
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  LogOut,
  MessageCircle,
  PanelLeftClose,
  Search,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PortalData, Training } from "@/lib/types";
import { formatTime } from "@/lib/domain";
import { useTrialCounts } from "@/components/trials/team";
import { CountUp, Sheet } from "./ui";

export type NavTone = "new" | "live" | "neutral";
export type NavCount = {
  value: number;
  tone: NavTone;
  /** Kurzes Wort hinter der Zahl, z. B. „heute“. */
  label?: string;
  /** Ganzer Satz für Tooltips und Screenreader. */
  tip: string;
};
export type NavEntry = {
  href: string;
  title: string;
  icon: LucideIcon;
  group?: string;
  count?: number;
};

export function openSpotlight() {
  window.dispatchEvent(new Event("d26-spotlight-open"));
}

export function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function todayEvents(events: Training[], now: number) {
  const today = new Date(now);
  return events
    .filter(
      (e) => e.status !== "cancelled" && sameDay(new Date(e.starts_at), today),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** Uhrzeit erst nach dem Laden im Browser (sonst passt Server und Browser nicht). */
function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Zahlen für die Menüpunkte. Schlüssel = href des Menüpunkts. */
export function useNavCounts(
  data: PortalData,
  items: NavEntry[],
): Record<string, NavCount> {
  const staff = data.role === "admin" || data.role === "staff";
  const trials = useTrialCounts(staff && !!data.trial_enabled);
  const now = useNow();
  const out: Record<string, NavCount> = {};
  for (const item of items)
    if (typeof item.count === "number" && item.count > 0)
      out[item.href] = {
        value: item.count,
        tone: "neutral",
        tip: `${item.count} anstehend`,
      };
  if (!staff) return out;
  const base = data.role === "admin" ? "/admin" : "/team";
  if (now !== null) {
    const today = todayEvents(data.events, now).length;
    if (today > 0)
      out[data.role === "admin" ? "/admin/trainingsplanung" : "/team"] = {
        value: today,
        tone: "live",
        label: "heute",
        tip: today === 1 ? "1 Training heute" : `${today} Trainings heute`,
      };
  }
  if (trials && trials.new + trials.review > 0)
    out[`${base}/probetraining`] = {
      value: trials.new + trials.review,
      tone: "new",
      label: "neu",
      tip: `${trials.new} neue Anfragen, ${trials.review} Bewertungen offen`,
    };
  return out;
}

export function NavChip({ count }: { count?: NavCount }) {
  if (!count) return null;
  return (
    <em className={`d26-nav-chip tone-${count.tone}`} aria-label={count.tip}>
      {count.tone === "live" && <i aria-hidden="true" />}
      <CountUp value={count.value} />
      {count.label && <small> {count.label}</small>}
    </em>
  );
}

const CLOSED_KEY = "d26-nav-closed";
/** Welche Kategorien zugeklappt sind; bleibt im Browser gespeichert. */
export function useClosedGroups() {
  const [closed, setClosed] = useState<string[]>([]);
  useEffect(() => {
    try {
      setClosed(JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]"));
    } catch {}
  }, []);
  const toggle = (group: string) =>
    setClosed((current) => {
      const next = current.includes(group)
        ? current.filter((g) => g !== group)
        : [...current, group];
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  return { closed, toggle };
}

export function NavGroupToggle({
  group,
  open,
  fresh,
  onToggle,
}: {
  group: string;
  open: boolean;
  /** Summe der „neu“-Zahlen in dieser Kategorie. */
  fresh: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`d26-nav-group ${open ? "is-open" : ""}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span>{group}</span>
      {fresh > 0 && (
        <em className="d26-nav-sum">
          <CountUp value={fresh} /> neu
        </em>
      )}
      <ChevronDown size={14} aria-hidden="true" />
    </button>
  );
}

export function NavSearch() {
  return (
    <button type="button" className="d26-nav-search" onClick={openSpotlight}>
      <Search size={16} />
      <span>Suchen oder springen</span>
      <kbd>⌘K</kbd>
    </button>
  );
}

/** Mini-Kachel „Heute auf dem Platz“ für Admin und Team. */
export function NavTodayTile({
  data,
  href,
  onNavigate,
}: {
  data: PortalData;
  href: string;
  onNavigate?: () => void;
}) {
  const now = useNow();
  if (now === null) return null;
  const today = todayEvents(data.events, now);
  const done = today.filter((e) => Date.parse(e.ends_at) < now).length;
  const next = today.find((e) => Date.parse(e.ends_at) >= now);
  const share = today.length ? Math.round((done / today.length) * 100) : 0;
  return (
    <Link className="d26-nav-today" href={href} onClick={onNavigate}>
      <small>Heute auf dem Platz</small>
      <b>
        {today.length === 0
          ? "Kein Training heute"
          : `${today.length} ${today.length === 1 ? "Einheit" : "Einheiten"}${
              next
                ? ` · nächste ${formatTime(next.starts_at)}`
                : " · alle durch"
            }`}
      </b>
      {today.length > 0 && (
        <span
          className="d26-nav-today-bar"
          role="img"
          aria-label={`${done} von ${today.length} Einheiten vorbei`}
        >
          <i style={{ width: `${share}%` }} />
        </span>
      )}
    </Link>
  );
}

export function roleLabel(data: PortalData) {
  if (data.read_only) return "Einsicht (nur lesen)";
  return data.role === "admin"
    ? "Admin"
    : data.role === "staff"
      ? "Mitarbeiter"
      : "Elternportal";
}

/** Profil-Kachel unten im Menü (eingeklappt nur der Avatar). */
export function NavProfileTile({
  data,
  collapsed,
  onOpen,
}: {
  data: PortalData;
  collapsed: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="d26-nav-me"
      onClick={onOpen}
      aria-label="Profil und Konto öffnen"
      data-tip={collapsed ? data.user_name : undefined}
    >
      <i className="d26-nav-avatar" aria-hidden="true">
        {initialsOf(data.user_name)}
      </i>
      <span>
        <b>{data.user_name}</b>
        <small>{roleLabel(data)}</small>
      </span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}

function ProfileRows({
  data,
  onLogout,
  onNavigate,
  collapsed,
  toggleCollapsed,
}: {
  data: PortalData;
  onLogout: () => void;
  onNavigate: () => void;
  collapsed?: boolean;
  toggleCollapsed?: () => void;
}) {
  return (
    <>
      {toggleCollapsed && (
        <>
          <p className="d26-nav-label">Menü</p>
          <div className="d26-nav-list">
            <div className="d26-nav-row">
              <span className="d26-nav-row-icon tone-grey">
                <PanelLeftClose size={16} />
              </span>
              <span>Menü eingeklappt</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!collapsed}
                aria-label={collapsed ? "Menü ausklappen" : "Menü einklappen"}
                className={`d26-switch ${collapsed ? "is-on" : ""}`}
                onClick={toggleCollapsed}
              >
                <i />
              </button>
            </div>
          </div>
        </>
      )}
      <p className="d26-nav-label">Konto</p>
      <div className="d26-nav-list">
        <Link className="d26-nav-row" href="/konto" onClick={onNavigate}>
          <span className="d26-nav-row-icon tone-teal">
            <UserRound size={16} />
          </span>
          <span>Mein Konto</span>
          <ChevronRight size={15} aria-hidden="true" />
        </Link>
        {data.whatsapp && (
          <a
            className="d26-nav-row"
            href={`https://wa.me/${data.whatsapp}`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="d26-nav-row-icon tone-green">
              <MessageCircle size={16} />
            </span>
            <span>WhatsApp an das Team</span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        )}
        <button
          type="button"
          className="d26-nav-row is-danger"
          onClick={onLogout}
        >
          <span className="d26-nav-row-icon tone-red">
            <LogOut size={16} />
          </span>
          <span>Sicher abmelden</span>
        </button>
      </div>
    </>
  );
}

export function ProfileSheet({
  open,
  onClose,
  data,
  onLogout,
  collapsed,
  toggleCollapsed,
}: {
  open: boolean;
  onClose: () => void;
  data: PortalData;
  onLogout: () => void;
  collapsed: boolean;
  /** Nur am Desktop: Schalter zum Einklappen des Menüs. */
  toggleCollapsed?: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow={roleLabel(data)}
      title="Profil"
    >
      <div className="d26-nav-profile">
        <i className="d26-nav-avatar is-large" aria-hidden="true">
          {initialsOf(data.user_name)}
        </i>
        <span>
          <b>{data.user_name}</b>
          <small>{data.email}</small>
        </span>
      </div>
      <ProfileRows
        data={data}
        onLogout={onLogout}
        onNavigate={onClose}
        collapsed={collapsed}
        toggleCollapsed={toggleCollapsed}
      />
    </Sheet>
  );
}

type Tile = NavEntry & { active: boolean };
const groupTone: Record<string, string> = {
  Training: "green",
  Menschen: "blue",
  Betrieb: "grey",
  Familie: "teal",
  Entdecken: "purple",
};

/** Handy: „Mehr“ öffnet alle Menüpunkte als Kacheln, nach Kategorie. */
export function MoreSheet({
  open,
  onClose,
  data,
  groups,
  counts,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  data: PortalData;
  groups: { group: string; items: Tile[] }[];
  counts: Record<string, NavCount>;
  onLogout: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} eyebrow={roleLabel(data)} title="Menü">
      <div className="d26-nav-profile">
        <i className="d26-nav-avatar is-large" aria-hidden="true">
          {initialsOf(data.user_name)}
        </i>
        <span>
          <b>{data.user_name}</b>
          <small>{data.email}</small>
        </span>
      </div>
      <button
        type="button"
        className="d26-nav-search is-light"
        onClick={() => {
          onClose();
          openSpotlight();
        }}
      >
        <Search size={17} />
        <span>Suchen oder springen</span>
      </button>
      {groups.map(({ group, items }) => (
        <section key={group}>
          <p className="d26-nav-label">{group}</p>
          <div className="d26-nav-tiles">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`d26-nav-tile ${item.active ? "is-active" : ""}`}
                aria-current={item.active ? "page" : undefined}
                onClick={onClose}
              >
                <span
                  className={`d26-nav-row-icon tone-${groupTone[group] ?? "grey"}`}
                >
                  <item.icon size={17} />
                </span>
                <NavChip count={counts[item.href]} />
                <b>{item.title}</b>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <ProfileRows data={data} onLogout={onLogout} onNavigate={onClose} />
    </Sheet>
  );
}
