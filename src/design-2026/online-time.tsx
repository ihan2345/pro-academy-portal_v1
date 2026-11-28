"use client";
// Design 2026: Online-Zeit je Konto (nur Super-Admins, Release 065).
// Oben Kacheln (gesamt, Team, Eltern, gerade online), darunter Chips und eine
// Liste mit tt:hh:mm. Ein Tipp auf eine Zeile öffnet ein Sheet mit Details.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Clock,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  Users,
  Wifi,
} from "lucide-react";
import {
  formatOnlineTime,
  isTeamRole,
  spellOnlineTime,
  type OnlineOverview,
  type OnlineRow,
} from "@/lib/online-time";
import { activityStatus } from "@/lib/user-activity";
import { Sheet } from "./ui";

type Filter = "alle" | "team" | "eltern";
const FILTER_KEY = "d26-online-time-filter-v1";
const roleLabel: Record<string, string> = {
  admin: "Admin",
  staff: "Trainer",
  viewer: "Einsicht",
  parent: "Eltern",
};
const berlin = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const sum = (rows: OnlineRow[]) =>
  rows.reduce((t, r) => t + (Number(r.online_seconds) || 0), 0);

export function OnlineTimeView() {
  const [data, setData] = useState<
    (OnlineOverview & { ready: boolean }) | null
  >(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilterState] = useState<Filter>("alle");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<OnlineRow | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/online-time", { cache: "no-store" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? "Fehler beim Laden.");
      setData(body);
      setError("");
      setClock(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler beim Laden.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    try {
      const saved = localStorage.getItem(FILTER_KEY) as Filter | null;
      if (saved) setFilterState(saved);
    } catch {
      /* Ohne Speicher startet die Seite mit „Alle“. */
    }
    // Jede Minute neu laden, solange die Seite sichtbar ist.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => clearInterval(timer);
  }, []);
  const setFilter = (f: Filter) => {
    setFilterState(f);
    try {
      localStorage.setItem(FILTER_KEY, f);
    } catch {
      /* Wahl gilt dann nur bis zum Neuladen. */
    }
  };

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const team = rows.filter((r) => isTeamRole(r.role));
  const parents = rows.filter((r) => !isTeamRole(r.role));
  const online = rows.filter(
    (r) => activityStatus(r.last_seen_at, clock).online,
  );
  const shown = rows.filter((r) => {
    if (filter === "team" && !isTeamRole(r.role)) return false;
    if (filter === "eltern" && isTeamRole(r.role)) return false;
    const q = query.trim().toLowerCase();
    return !q || (r.name || "").toLowerCase().includes(q);
  });
  const withTime = shown.filter((r) => r.online_seconds > 0);
  const withoutTime = shown.length - withTime.length;
  const top = Math.max(1, ...rows.map((r) => r.online_seconds));

  return (
    <div className="d26-experience d26-settings-hub d26-online-time">
      <header className="d26-ot-head">
        <div>
          <h3>Online-Zeit</h3>
          <p>
            Gesamte Zeit im Portal je Konto als <b>tt:hh:mm</b> (Tage : Stunden
            : Minuten). Nur für Super-Admins sichtbar.
          </p>
        </div>
        <button
          type="button"
          className="d26-ot-refresh"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Neu laden"
        >
          <RefreshCw size={16} className={loading ? "is-spinning" : ""} />
        </button>
      </header>

      {error && (
        <p className="d26-set-alert" role="alert">
          <TriangleAlert size={16} /> {error}
        </p>
      )}
      {data && !data.ready && (
        <p className="d26-set-alert" role="status">
          <TriangleAlert size={16} /> Die Online-Zeit wird erst gezählt, wenn
          Release 065 in der Datenbank ausgeführt ist.
        </p>
      )}

      <div className="d26-set-tiles">
        <button
          type="button"
          className="d26-card d26-set-tile"
          onClick={() => setFilter("alle")}
          data-tip={`Alle Konten zusammen: ${spellOnlineTime(sum(rows))}`}
        >
          <Clock size={18} />
          <b>{formatOnlineTime(sum(rows))}</b>
          <span>Gesamt · alle Konten</span>
        </button>
        <button
          type="button"
          className="d26-card d26-set-tile"
          onClick={() => setFilter("team")}
          data-tip={`Team (Admins, Trainer, Einsicht): ${spellOnlineTime(sum(team))}`}
        >
          <ShieldCheck size={18} />
          <b>{formatOnlineTime(sum(team))}</b>
          <span>Team · {team.length} Konten</span>
        </button>
        <button
          type="button"
          className="d26-card d26-set-tile"
          onClick={() => setFilter("eltern")}
          data-tip={`Eltern: ${spellOnlineTime(sum(parents))}`}
        >
          <Users size={18} />
          <b>{formatOnlineTime(sum(parents))}</b>
          <span>Eltern · {parents.length} Konten</span>
        </button>
        <div
          className={`d26-card d26-set-tile ${online.length ? "is-on" : "is-off"}`}
          data-tip={
            online.length
              ? `Gerade online: ${online.map((r) => r.name || "Ohne Namen").join(", ")}`
              : "Gerade ist niemand im Portal."
          }
        >
          <Wifi size={18} />
          <b>{online.length}</b>
          <span>Gerade online</span>
        </div>
      </div>

      <nav className="d26-chips d26-set-chips" aria-label="Konten filtern">
        {(
          [
            ["alle", "Alle", rows.length],
            ["team", "Team", team.length],
            ["eltern", "Eltern", parents.length],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            className={`d26-chip ${filter === id ? "is-active" : ""}`}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
            <em>{count}</em>
          </button>
        ))}
        <label className="d26-ot-search">
          <Search size={15} />
          <input
            type="search"
            placeholder="Name suchen"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </nav>

      <div className="d26-settings-group">
        <h4>
          Nach Online-Zeit
          {data?.counted_since && (
            <span className="d26-ot-since">
              gezählt seit {berlin(data.counted_since)}
            </span>
          )}
        </h4>
        <div className="d26-settings">
          {!data && !error && (
            <p className="d26-ot-empty">Online-Zeit wird geladen …</p>
          )}
          {data && withTime.length === 0 && (
            <p className="d26-ot-empty">
              {query
                ? "Kein Konto mit diesem Namen."
                : "Noch keine Online-Zeit erfasst."}
            </p>
          )}
          {withTime.map((r, i) => {
            const status = activityStatus(r.last_seen_at, clock);
            return (
              <button
                key={r.user_id}
                type="button"
                className="d26-setting d26-set-line d26-ot-row"
                onClick={() => setOpen(r)}
                style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
              >
                <span
                  className={`d26-setting-icon tone-${isTeamRole(r.role) ? "purple" : "blue"}`}
                >
                  {isTeamRole(r.role) ? (
                    <ShieldCheck size={17} />
                  ) : (
                    <UserRound size={17} />
                  )}
                  {status.online && (
                    <i className="d26-ot-dot" aria-label="Online" />
                  )}
                </span>
                <span className="d26-setting-main">
                  <b>{r.name || "Ohne Namen"}</b>
                  <small>
                    {roleLabel[r.role] ?? r.role} · {status.label}
                  </small>
                  <i className="d26-set-meter" aria-hidden="true">
                    <em
                      style={{ width: `${(r.online_seconds / top) * 100}%` }}
                    />
                  </i>
                </span>
                <span
                  className="d26-set-value d26-ot-time"
                  title={spellOnlineTime(r.online_seconds)}
                >
                  {formatOnlineTime(r.online_seconds)}
                </span>
                <ChevronRight size={17} className="d26-chevron" />
              </button>
            );
          })}
        </div>
        {withoutTime > 0 && (
          <p className="d26-set-foot">
            {withoutTime}{" "}
            {withoutTime === 1 ? "weiteres Konto" : "weitere Konten"} ohne
            erfasste Online-Zeit.
          </p>
        )}
        <p className="d26-set-foot">
          Gezählt wird, solange das Portal sichtbar offen ist (Lebenszeichen
          jede Minute). Pausen über 2½ Minuten zählen nicht, mehrere Tabs nicht
          doppelt. Gespeichert wird nur die Summe, keine Seiten oder Geräte.
        </p>
      </div>

      <Sheet
        open={!!open}
        onClose={() => setOpen(null)}
        eyebrow={open ? (roleLabel[open.role] ?? open.role) : ""}
        title={open ? open.name || "Ohne Namen" : ""}
      >
        {open && (
          <div className="d26-ot-sheet">
            <div className="d26-ot-big">
              <b>{formatOnlineTime(open.online_seconds)}</b>
              <span>tt:hh:mm · {spellOnlineTime(open.online_seconds)}</span>
            </div>
            <dl>
              <dt>Zuletzt aktiv</dt>
              <dd>
                {open.last_seen_at
                  ? `${berlin(open.last_seen_at)} Uhr (${activityStatus(open.last_seen_at, clock).label})`
                  : "—"}
              </dd>
              <dt>Gezählt seit</dt>
              <dd>
                {open.counted_since ? `${berlin(open.counted_since)} Uhr` : "—"}
              </dd>
            </dl>
            {open.parent_id && (
              <Link
                href={`/admin/elternprofile/${open.parent_id}`}
                className="d26-set-more"
              >
                Elternprofil öffnen <ChevronRight size={14} />
              </Link>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
