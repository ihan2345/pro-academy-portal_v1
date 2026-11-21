"use client";
// Design 2026: Archiv „Alle Spieler“ im Sheet der Spielerprofile. Jede Zeile
// trägt die Farbe ihres Status (Abo-Farben, Camp-Rot, Probetraining-Türkis,
// Inaktiv-Silber). Mehrfach-Chips blenden Status ein und aus, Hover über den
// Namen zeigt eine Kurzübersicht, Klick öffnet das Spielerprofil.
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Search } from "lucide-react";
import { childCardTheme } from "@/lib/parent-profile";
import { formatDate } from "@/lib/domain";
import {
  ARCHIVE_STATUSES,
  TRIAL_LABELS,
  type ArchivePlayer,
  type ArchiveStatus,
} from "@/lib/player-archive";

export function archiveTone(r: ArchivePlayer) {
  if (r.status === "abo") return `is-abo plan-${childCardTheme(r.products)}`;
  return `is-${r.status}`;
}
function initials(r: ArchivePlayer) {
  return [r.first_name, r.last_name]
    .map((w) => (w ?? "").trim().charAt(0).toUpperCase())
    .join("");
}
function statusLabel(r: ArchivePlayer) {
  if (r.status === "abo") return r.products[0] ?? "Aktives Abo";
  if (r.status === "camp") return "Camp";
  if (r.status === "trial") return "Probetraining";
  return r.archived ? "Archiviert" : "Inaktiv";
}
const hours = (m: number) =>
  new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(m / 60);
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export function PlayerArchive({
  rows,
  failed,
  base,
  search: initialSearch = "",
}: {
  rows: ArchivePlayer[] | null;
  failed: boolean;
  base: string;
  search?: string;
}) {
  const [show, setShow] = useState<Set<ArchiveStatus>>(
    () => new Set(ARCHIVE_STATUSES.map((s) => s.value)),
  );
  const [search, setSearch] = useState(initialSearch);
  const [hover, setHover] = useState<{
    row: ArchivePlayer;
    rect: DOMRect;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counts = useMemo(() => {
    const c: Record<ArchiveStatus, number> = {
      abo: 0,
      camp: 0,
      trial: 0,
      inactive: 0,
    };
    rows?.forEach((r) => c[r.status]++);
    return c;
  }, [rows]);
  const term = search.trim().toLocaleLowerCase("de-DE");
  const visible = (rows ?? []).filter(
    (r) =>
      show.has(r.status) &&
      (!term ||
        [r.name, r.team, ...r.parents.map((p) => p.name)].some((v) =>
          v?.toLocaleLowerCase("de-DE").includes(term),
        )),
  );
  const everything = show.size === ARCHIVE_STATUSES.length;
  const toggle = (s: ArchiveStatus) =>
    setShow((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const enter = (row: ArchivePlayer, el: HTMLElement) => {
    if (timer.current) clearTimeout(timer.current);
    if (
      typeof window !== "undefined" &&
      !window.matchMedia("(hover: hover)").matches
    )
      return;
    const rect = el.getBoundingClientRect();
    timer.current = setTimeout(() => setHover({ row, rect }), 120);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(null), 80);
  };
  return (
    <div className="d26-archive">
      <label className="d26-archive-search">
        <Search size={16} aria-hidden="true" />
        <input
          aria-label="Im Archiv suchen"
          placeholder="Name, Team oder Eltern"
          value={search}
          maxLength={100}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="d26-chips d26-archive-chips" aria-label="Status filtern">
        <button
          type="button"
          className={`d26-chip ${everything ? "is-active" : ""}`}
          aria-pressed={everything}
          onClick={() => setShow(new Set(ARCHIVE_STATUSES.map((s) => s.value)))}
        >
          Alle · {rows?.length ?? "…"}
        </button>
        {ARCHIVE_STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            className={`d26-chip d26-archive-chip is-${s.value} ${show.has(s.value) ? "is-on" : "is-off"}`}
            aria-pressed={show.has(s.value)}
            onClick={() => toggle(s.value)}
          >
            <i aria-hidden="true" />
            {s.short} · {rows ? counts[s.value] : "…"}
          </button>
        ))}
      </div>
      <p className="d26-archive-count" role="status">
        {rows
          ? `${visible.length} von ${rows.length} Spielern`
          : failed
            ? "Archiv konnte nicht geladen werden."
            : "Archiv wird geladen …"}
      </p>
      <div className="d26-archive-list">
        {visible.map((r) => (
          <a
            key={r.id}
            className={`d26-archive-row ${archiveTone(r)}`}
            href={
              r.trialOnly ? `${base}/probetraining` : `${base}/spieler/${r.id}`
            }
            aria-label={
              r.trialOnly
                ? `Probetraining von ${r.name} öffnen`
                : `Spielerprofil von ${r.name} öffnen`
            }
          >
            <span className="d26-archive-avatar" aria-hidden="true">
              {initials(r)}
            </span>
            <span className="d26-archive-main">
              <b
                onMouseEnter={(e) => enter(r, e.currentTarget)}
                onMouseLeave={leave}
              >
                {r.name}
              </b>
              <small>
                {[
                  r.age,
                  r.team,
                  r.parents.map((p) => p.name).join(", ") ||
                    "Ohne Elternprofil",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
            <span className="d26-archive-pill">{statusLabel(r)}</span>
            <ChevronRight size={16} className="d26-chevron" />
          </a>
        ))}
        {rows && !visible.length && (
          <p className="d26-empty">Niemand in dieser Auswahl.</p>
        )}
      </div>
      {hover &&
        typeof document !== "undefined" &&
        createPortal(
          <ArchiveCard
            row={hover.row}
            rect={hover.rect}
            onEnter={() => timer.current && clearTimeout(timer.current)}
            onLeave={leave}
          />,
          document.body,
        )}
    </div>
  );
}

function ArchiveCard({
  row: r,
  rect,
  onEnter,
  onLeave,
}: {
  row: ArchivePlayer;
  rect: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const width = 320,
    gap = 14;
  const vw = window.innerWidth,
    vh = window.innerHeight;
  // Das Sheet sitzt rechts: Karte bevorzugt links daneben, sonst darunter.
  const left =
    rect.left - width - gap > 8
      ? rect.left - width - gap
      : Math.min(Math.max(8, rect.left), vw - width - 8);
  const beside = rect.left - width - gap > 8;
  const top = beside
    ? Math.min(Math.max(8, rect.top - 40), vh - 380)
    : Math.min(rect.bottom + 8, vh - 380);
  const facts: [string, string][] = [
    ["Status", r.archived ? `${statusLabel(r)} (archiviert)` : statusLabel(r)],
    ...(r.status === "abo" && r.products.length > 1
      ? ([["Abos", r.products.join(", ")]] as [string, string][])
      : []),
    ...(r.status !== "abo" && r.formerProducts.length
      ? ([["Frühere Abos", r.formerProducts.join(", ")]] as [string, string][])
      : []),
    ...(r.since
      ? ([["Abo seit", formatDate(r.since)]] as [string, string][])
      : []),
    ...(r.trial
      ? ([["Probetraining", TRIAL_LABELS[r.trial] ?? r.trial]] as [
          string,
          string,
        ][])
      : []),
    ["Eltern", r.parents.map((p) => p.name).join(", ") || "Kein Elternprofil"],
    ["Erfasst am", r.created ? formatDate(r.created) : "–"],
  ];
  return (
    <div
      className={`d26-archive-card ${archiveTone(r)}`}
      style={{ left, top, width }}
      role="tooltip"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <header>
        <span className="d26-archive-avatar" aria-hidden="true">
          {initials(r)}
        </span>
        <div>
          <b>{r.name}</b>
          <small>{[r.age, r.team].filter(Boolean).join(" · ")}</small>
        </div>
        <span className="d26-archive-pill">{statusLabel(r)}</span>
      </header>
      <div className="d26-archive-kpis">
        <div>
          <strong>{r.months}</strong>
          <span>Monate gesamt</span>
        </div>
        <div>
          <strong>{r.trainings}</strong>
          <span>{r.trainings === 1 ? "Training" : "Trainings"}</span>
        </div>
        <div>
          <strong>{hours(r.minutes)}</strong>
          <span>Stunden</span>
        </div>
        <div>
          <strong>{r.camps ?? "–"}</strong>
          <span>{r.camps === 1 ? "Camp" : "Camps"}</span>
        </div>
      </div>
      <dl>
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <small className="d26-archive-hint">
        {plural(r.trainings + (r.camps ?? 0), "Event", "Events")} insgesamt ·
        {r.trialOnly
          ? "Klick auf den Namen öffnet das Probetraining"
          : "Klick auf den Namen öffnet das Profil"}
      </small>
    </div>
  );
}
