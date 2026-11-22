"use client";
// Design 2026: große Kachel „Neueste Spieler“ auf der Zentrale.
// „Neu“ heißt: Das Kind ist in diesem Zeitraum im Portal erfasst worden.
// Das sind alle Spielerprofile (players.created_at, egal ob Registrierung,
// Camp, Admin oder übernommenes Probetraining, archivierte zählen mit) und
// zusätzlich die Probetraining-Kinder ohne Spielerprofil (trial_players, über
// trial_player_id verknüpft). Der Schalter „Alle / Abonnenten“ zeigt nur Kinder
// mit laufendem Abo. Balken sind nach Status gestapelt, Klick auf einen Balken
// öffnet die Kinder dieses Zeitfensters mit den Statusfarben des Archivs.
import { useState } from "react";
import { ArrowRight, ChevronRight, UserPlus } from "lucide-react";
import Link from "next/link";
import { CountUp, Sheet } from "./ui";
import { PlayerArchive, archiveTone } from "./player-archive";
import { json, useEverything } from "./people-heads";
import { formatDate } from "@/lib/domain";
import type {
  ArchivePage,
  ArchivePlayer,
  ArchiveStatus,
} from "@/lib/player-archive";

type Span = "today" | "7" | "30";
type Audience = "all" | "abo";
type Bucket = {
  key: string;
  start: number;
  end: number;
  rows: ArchivePlayer[];
  label: string;
  tick: string;
};

// Stapelreihenfolge von unten nach oben.
const STACK: { status: ArchiveStatus; label: string }[] = [
  { status: "abo", label: "Abo" },
  { status: "trial", label: "Probetraining" },
  { status: "camp", label: "Camp" },
  { status: "inactive", label: "Ohne Abo" },
];

const dayStart = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());
const longDay = (d: Date) =>
  d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
const people = (n: number, audience: Audience = "all") =>
  audience === "abo"
    ? `${n} ${n === 1 ? "neuer Abonnent" : "neue Abonnenten"}`
    : `${n} ${n === 1 ? "neuer Spieler" : "neue Spieler"}`;

function buckets(rows: ArchivePlayer[], span: Span): Bucket[] {
  const today = dayStart(new Date());
  const created = rows
    .filter((r) => r.created)
    .map((r) => ({ r, t: Date.parse(r.created) }));
  const take = (start: number, end: number) =>
    created
      .filter(({ t }) => t >= start && t < end)
      .sort((a, b) => b.t - a.t)
      .map(({ r }) => r);
  if (span === "today") {
    // Heute: zwölf Zwei-Stunden-Fenster, damit der Tag nicht nur ein Balken ist.
    return Array.from({ length: 12 }, (_, i) => {
      const start = today.getTime() + i * 2 * 3600000;
      const end = start + 2 * 3600000;
      return {
        key: `h${i}`,
        start,
        end,
        rows: take(start, end),
        label: `${String(i * 2).padStart(2, "0")}–${String(i * 2 + 2).padStart(2, "0")} Uhr`,
        tick: i % 2 === 0 ? `${i * 2}` : "",
      };
    });
  }
  const days = span === "7" ? 7 : 30;
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));
    const start = d.getTime();
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    return {
      key: d.toISOString(),
      start,
      end: next.getTime(),
      rows: take(start, next.getTime()),
      label: longDay(d),
      tick:
        days === 7
          ? d.toLocaleDateString("de-DE", { weekday: "short" })
          : i % 5 === 4 || i === days - 1
            ? String(d.getDate())
            : "",
    };
  });
}

const newestFirst = (list: Bucket[]) =>
  list
    .flatMap((b) => b.rows)
    .sort((a, b) => Date.parse(b.created) - Date.parse(a.created));

function initials(r: ArchivePlayer) {
  return [r.first_name, r.last_name]
    .map((w) => (w ?? "").trim().charAt(0).toUpperCase())
    .join("");
}
function badge(r: ArchivePlayer) {
  if (r.status === "abo") return r.products[0] ?? "Abo";
  if (r.status === "trial") return "Probetraining";
  if (r.status === "camp") return "Camp";
  return r.archived ? "Archiviert" : "Ohne Abo";
}
function when(iso: string) {
  const t = Date.parse(iso),
    today = dayStart(new Date()).getTime();
  const time = new Date(t).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (t >= today) return `Heute, ${time}`;
  if (t >= today - 86400000) return `Gestern, ${time}`;
  return formatDate(iso, { weekday: "short", day: "numeric", month: "short" });
}

export function NewestPlayersTile({ base = "/admin" }: { base?: string }) {
  const [span, setSpan] = useState<Span>("7");
  const [audience, setAudience] = useState<Audience>("all");
  const [open, setOpen] = useState<{
    title: string;
    eyebrow: string;
    rows: ArchivePlayer[];
  } | null>(null);
  // Gleicher Schlüssel wie das Archiv der Spielerprofile: teilt den Tab-Cache.
  const archive = useEverything<ArchivePlayer>(
    "archive:0",
    async (signal) =>
      ((await json("/api/player-archive", signal)) as ArchivePage).rows,
  );
  // Probetraining-Kinder ohne Spielerprofil. Fehlt der Endpunkt oder schlägt
  // er fehl, zählt die Kachel wie bisher nur Spielerprofile.
  const trials = useEverything<ArchivePlayer>("archive:trials", (signal) =>
    json("/api/player-archive/trials", signal)
      .then((r) => (r as { rows: ArchivePlayer[] }).rows ?? [])
      .catch(() => []),
  );
  const loaded = !!archive.rows;
  const everyone = [...(archive.rows ?? []), ...(trials.rows ?? [])];
  const pool =
    audience === "abo" ? everyone.filter((r) => r.status === "abo") : everyone;
  const list = buckets(pool, span);
  const all = newestFirst(list);
  const total = all.length;
  const max = Math.max(1, ...list.map((b) => b.rows.length));
  const now = Date.now();
  const spanLabel =
    span === "today"
      ? "Heute"
      : span === "7"
        ? "Letzte 7 Tage"
        : "Letzte 30 Tage";
  const split = STACK.map((s) => ({
    ...s,
    count: all.filter((r) => r.status === s.status).length,
  })).filter((s) => s.count > 0);
  const openList = (title: string, rows: ArchivePlayer[]) =>
    setOpen({ title, eyebrow: people(rows.length, audience), rows });
  const openBucket = (b: Bucket) =>
    span === "today"
      ? openList(longDay(new Date(b.start)), all)
      : openList(b.label, b.rows);
  return (
    <section
      className={`d26-card d26-span-2 d26-newest is-span-${span} is-${audience}`}
    >
      <div className="d26-card-head">
        <h3>
          <UserPlus size={18} /> Neueste Spieler
        </h3>
        <div className="d26-segments is-small" role="tablist">
          {(
            [
              ["today", "Heute", "Heute"],
              ["7", "7 Tage", "7 T"],
              ["30", "30 Tage", "30 T"],
            ] as const
          ).map(([v, label, short]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={span === v}
              aria-label={label}
              className={span === v ? "is-active" : ""}
              onClick={() => setSpan(v)}
            >
              <span className="is-long">{label}</span>
              <span className="is-short">{short}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="d26-newest-summary">
        <button
          type="button"
          className="d26-newest-total"
          disabled={!total}
          onClick={() => openList(spanLabel, all)}
        >
          <b>{loaded ? <CountUp value={total} /> : "…"}</b>
          <span>
            {audience === "abo" ? "Neue Abonnenten" : "Neue Spieler"} ·{" "}
            {spanLabel} <ChevronRight size={13} />
          </span>
        </button>
        <div
          className="d26-newest-switch"
          role="radiogroup"
          aria-label="Welche Spieler zählen"
        >
          {(
            [
              ["all", "Alle"],
              ["abo", "Abonnenten"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={audience === v}
              className={audience === v ? "is-active" : ""}
              onClick={() => setAudience(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {audience === "all" && (
        <ul className="d26-newest-legend" aria-label="Aufteilung nach Status">
          {split.length ? (
            split.map((s) => (
              <li key={s.status} className={`is-${s.status}`}>
                <i aria-hidden="true" />
                {s.label} <b>{s.count}</b>
              </li>
            ))
          ) : (
            <li className="is-empty">Noch niemand in diesem Zeitraum</li>
          )}
        </ul>
      )}

      <div
        className="d26-bars d26-newest-bars"
        style={{
          gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))`,
        }}
        key={`${span}-${audience}`}
      >
        {list.map((b) => {
          const n = b.rows.length;
          const current = now >= b.start && now < b.end;
          return (
            <button
              type="button"
              key={b.key}
              disabled={!n}
              data-tip={`${b.label}: ${people(n, audience)}`}
              aria-label={`${b.label}: ${people(n, audience)}`}
              className={`${current ? "is-today" : ""} ${n ? "has-value" : ""}`}
              onClick={() => openBucket(b)}
            >
              <i style={{ height: `${(n / max) * 100}%` }}>
                {STACK.map((s) => {
                  const part = b.rows.filter(
                    (r) => r.status === s.status,
                  ).length;
                  return part ? (
                    <span
                      key={s.status}
                      className={`is-${s.status}`}
                      style={{ flexGrow: part }}
                    />
                  ) : null;
                })}
                {n > 0 && span !== "30" && <em>{n}</em>}
              </i>
              <small>{b.tick || " "}</small>
            </button>
          );
        })}
      </div>

      <div className="d26-newest-recent">
        <h4>Zuletzt dazugekommen</h4>
        {all.length ? (
          <ol>
            {all.slice(0, 3).map((r) => (
              <li key={r.id}>
                <a
                  className={archiveTone(r)}
                  href={
                    r.trialOnly
                      ? `${base}/probetraining`
                      : `${base}/spieler/${r.id}`
                  }
                >
                  <span className="d26-newest-avatar" aria-hidden="true">
                    {initials(r)}
                  </span>
                  <span className="d26-newest-who">
                    <b>{r.name}</b>
                    <small>
                      {[when(r.created), r.age].filter(Boolean).join(" · ")}
                    </small>
                  </span>
                  <span className="d26-newest-pill">{badge(r)}</span>
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <p className="d26-empty">
            {loaded
              ? audience === "abo"
                ? "Keine neuen Abonnenten in diesem Zeitraum."
                : "Keine neuen Spieler in diesem Zeitraum."
              : "Wird geladen …"}
          </p>
        )}
      </div>

      <Sheet
        open={!!open}
        onClose={() => setOpen(null)}
        eyebrow={open?.eyebrow}
        title={open?.title ?? ""}
        footer={
          <Link href={`${base}/spielerprofile`} className="d26-btn is-primary">
            Alle Spieler <ArrowRight size={16} />
          </Link>
        }
      >
        {open && <PlayerArchive rows={open.rows} failed={false} base={base} />}
      </Sheet>
    </section>
  );
}
