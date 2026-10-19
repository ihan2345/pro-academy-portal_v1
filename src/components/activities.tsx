"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import {
  Activity as ActivityIcon,
  Info,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { Activity, ActivityPage, ActivitySummary } from "@/lib/activities";
import { calendarDate } from "@/lib/calendar";
import { formatDate, formatTime } from "@/lib/domain";

export function ActivityBadge() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const update = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/api/activities/summary", {
        signal: abort.signal,
        cache: "no-store",
      })
        .then(async (r) => {
          if (!r.ok) throw Error();
          return r.json();
        })
        .then((d: ActivitySummary) => setCount(d.open))
        .catch(() => {});
    };
    update();
    const timer = setInterval(update, 60000);
    window.addEventListener("focus", update);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  return count === null ? null : (
    <span
      className="activity-badge"
      title={`${count} offene Vorgänge mit Handlungsbedarf`}
      aria-label={`${count} offene Vorgänge mit Handlungsbedarf`}
    >
      {count}
    </span>
  );
}
export function Activities({
  base,
  all = false,
}: {
  base: string;
  all?: boolean;
}) {
  const [summary, setSummary] = useState<ActivitySummary | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    setSummary(null);
    fetch("/api/activities/summary", {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error ?? "Aktivitäten nicht verfügbar.");
        return d;
      })
      .then(setSummary)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [revision]);
  return (
    <div className="activities-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">VERWALTUNG</div>
          <h1>
            {all ? "Alle Aktivitäten" : "Aktivitäten"}
            <span className="greeting-dot">.</span>
          </h1>
          <p>Was in der Academy passiert – verständlich zusammengefasst.</p>
        </div>
        <button
          className="secondary-button"
          onClick={() => setRevision((n) => n + 1)}
        >
          <RefreshCw size={16} /> Aktualisieren
        </button>
      </div>
      <div className="activities-links">
        <Link href={all ? base : `${base}/alle`}>
          {all ? "← Letzte 72 Stunden" : "Alle Aktivitäten →"}
        </Link>
        {summary && (
          <span>{summary.recent} Aktivitäten in den letzten 72 Stunden</span>
        )}
      </div>
      {error && (
        <p role="alert" className="panel">
          {error}
        </p>
      )}
      {!summary && !error && <p role="status">Aktivitäten werden geladen …</p>}
      {summary && (
        <div key={`${summary.asOf}:${revision}`}>
          {summary.open > 0 && (
            <section className="panel activity-open">
              <h2>Noch offen · {summary.open}</h2>
              <p>Aktueller Stand, unabhängig vom Alter des Eintrags.</p>
              <ActivityFeed window="issues" asOf={summary.asOf} />
            </section>
          )}
          {all ? (
            <ActivityFeed window="all" asOf={summary.asOf} groupDates />
          ) : (
            <>
              <ActivityWindow
                title="Heute"
                subtitle="Letzte 24 Stunden"
                window="0"
                asOf={summary.asOf}
                initiallyOpen
              />
              <ActivityWindow
                title="Vorheriger Tag"
                subtitle="Vor 24 bis 48 Stunden"
                window="1"
                asOf={summary.asOf}
              />
              <ActivityWindow
                title="Zwei Tage zuvor"
                subtitle="Vor 48 bis 72 Stunden"
                window="2"
                asOf={summary.asOf}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
function ActivityWindow({
  title,
  subtitle,
  window,
  asOf,
  initiallyOpen = false,
}: {
  title: string;
  subtitle: string;
  window: string;
  asOf: string;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen),
    [loaded, setLoaded] = useState(initiallyOpen);
  return (
    <details
      className="panel activity-day"
      open={open}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (e.currentTarget.open) setLoaded(true);
      }}
    >
      <summary>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </summary>
      {loaded && <ActivityFeed window={window} asOf={asOf} />}
    </details>
  );
}
function ActivityFeed({
  window,
  asOf,
  groupDates = false,
}: {
  window: string;
  asOf: string;
  groupDates?: boolean;
}) {
  const [rows, setRows] = useState<Activity[]>([]),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      window,
      asOf,
      ...(cursor ? { cursor } : {}),
    });
    fetch(`/api/activities?${params}`, {
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error ?? "Aktivitäten nicht verfügbar.");
        return d as ActivityPage;
      })
      .then((d) => {
        setRows((old) =>
          cursor
            ? [...old, ...d.rows.filter((r) => !old.some((o) => o.id === r.id))]
            : d.rows,
        );
        setNext(d.next);
        setTotal(d.total);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [window, asOf, cursor, retry]);
  const groups = new Map<string, Activity[]>();
  for (const row of rows) {
    const day = calendarDate(row.at);
    groups.set(day, [...(groups.get(day) ?? []), row]);
  }
  return (
    <>
      {groupDates ? (
        [...groups].map(([day, entries], i) => (
          <DateGroup
            key={day}
            day={day}
            initiallyOpen={i === 0}
            rows={entries}
          />
        ))
      ) : (
        <ActivityRows rows={rows} />
      )}
      {loading && <p role="status">Wird geladen …</p>}
      {!loading && !error && !rows.length && (
        <p className="profile-muted">Keine Aktivitäten in diesem Zeitraum.</p>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            className="secondary-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Erneut versuchen
          </button>
        </div>
      )}
      {!error && next && (
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => setCursor(next)}
        >
          Weitere Aktivitäten laden ({rows.length} von {total})
        </button>
      )}
    </>
  );
}
function DateGroup({
  day,
  rows,
  initiallyOpen,
}: {
  day: string;
  rows: Activity[];
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details
      className="panel activity-day"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <strong>{formatDate(`${day}T12:00:00Z`)}</strong>
        <span>{rows.length} geladen</span>
      </summary>
      <ActivityRows rows={rows} />
    </details>
  );
}
export function ActivityRows({ rows }: { rows: Activity[] }) {
  return (
    <ol className="activity-list">
      {rows.map((row) => (
        <li key={row.id} className={`activity-entry ${row.tone}`}>
          {row.help ? (
            <TriangleAlert
              size={19}
              style={{ color: "#c62828" }}
              aria-label="Aktion erforderlich"
            />
          ) : (
            <ActivityIcon size={19} aria-hidden="true" />
          )}
          <div>
            <h3>{row.title}</h3>
            {row.subject && (
              <strong className="activity-subject">{row.subject}</strong>
            )}
            <p>{row.text}</p>
            <small>
              <time dateTime={row.at}>
                {formatDate(row.at)} · {formatTime(row.at)}
              </time>{" "}
              · {row.actor}
            </small>
            {row.help && <ActivityHelp title={row.title} help={row.help} />}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ActivityHelp({
  title,
  help,
}: {
  title: string;
  help: NonNullable<Activity["help"]>;
}) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;
  return (
    <div
      className="activity-action activity-help"
      onPointerLeave={() => setHovered(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setPinned(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setPinned(false);
          setHovered(false);
        }
      }}
    >
      <strong>Problem: Aktion erforderlich!</strong>
      <button
        type="button"
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setHovered(true);
        }}
        aria-label={`Hilfsanleitung: ${title}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setPinned(!pinned)}
      >
        <Info size={17} />
      </button>
      {open && (
        <div id={id} className="activity-help-content">
          <p>{help.text}</p>
          <Link href={help.href}>{help.label} →</Link>
        </div>
      )}
    </div>
  );
}
