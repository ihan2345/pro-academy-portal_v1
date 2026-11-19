"use client";
// Design 2026: Kachel „Neueste Spieler“ auf der Zentrale (ersetzt „Berichte“).
// „Neu“ heißt: Das Spielerprofil wurde in diesem Zeitraum im Portal angelegt
// (players.created_at), egal ob über Registrierung, Probetraining, Camp oder
// Admin. Archivierte Kinder zählen mit. Daten kommen aus dem rein lesenden
// Archiv-Endpunkt „Alle Spieler“; Klick auf einen Balken öffnet die Spieler
// dieses Tages mit denselben Statusfarben wie im Archiv.
import { useState } from "react";
import { ArrowRight, ChevronRight, UserPlus } from "lucide-react";
import Link from "next/link";
import { CountUp, Sheet } from "./ui";
import { PlayerArchive } from "./player-archive";
import { json, useEverything } from "./people-heads";
import type { ArchivePage, ArchivePlayer } from "@/lib/player-archive";

type Span = "today" | "7" | "30";
type Bucket = {
  key: string;
  start: number;
  end: number;
  rows: ArchivePlayer[];
  label: string;
  tick: string;
};

const DAY = 86400000;
const dayStart = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());
const longDay = (d: Date) =>
  d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
const people = (n: number) =>
  `${n} ${n === 1 ? "neuer Spieler" : "neue Spieler"}`;

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
        tick: i % 3 === 0 ? String(i * 2) : "",
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
          ? d.toLocaleDateString("de-DE", { weekday: "narrow" })
          : i % 7 === 2 || i === days - 1
            ? String(d.getDate())
            : "",
    };
  });
}

const newestFirst = (list: Bucket[]) =>
  list
    .flatMap((b) => b.rows)
    .sort((a, b) => Date.parse(b.created) - Date.parse(a.created));

export function NewestPlayersTile({ base = "/admin" }: { base?: string }) {
  const [span, setSpan] = useState<Span>("7");
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
  const list = buckets(archive.rows ?? [], span);
  const total = list.reduce((s, b) => s + b.rows.length, 0);
  const max = Math.max(1, ...list.map((b) => b.rows.length));
  const now = Date.now();
  const spanLabel =
    span === "today"
      ? "Heute"
      : span === "7"
        ? "Letzte 7 Tage"
        : "Letzte 30 Tage";
  const openBucket = (b: Bucket) =>
    setOpen(
      span === "today"
        ? {
            // Heute öffnet immer den ganzen Tag.
            title: longDay(new Date(b.start)),
            eyebrow: people(list.reduce((s, x) => s + x.rows.length, 0)),
            rows: newestFirst(list),
          }
        : { title: b.label, eyebrow: people(b.rows.length), rows: b.rows },
    );
  return (
    <div className={`d26-card d26-kpi d26-newest is-span-${span}`}>
      <div className="d26-newest-head">
        <UserPlus size={18} />
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
      <div className="d26-newest-body">
        <button
          type="button"
          className="d26-newest-total"
          disabled={!total}
          onClick={() =>
            setOpen({
              title: spanLabel,
              eyebrow: people(total),
              rows: newestFirst(list),
            })
          }
        >
          <b>{archive.rows ? <CountUp value={total} /> : "…"}</b>
          <span>
            Neueste Spieler <ChevronRight size={13} />
          </span>
        </button>
        <div
          className="d26-bars d26-newest-bars"
          style={{
            gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))`,
          }}
          key={span}
        >
          {list.map((b) => {
            const n = b.rows.length;
            const current = now >= b.start && now < b.end;
            return (
              <button
                type="button"
                key={b.key}
                disabled={!n}
                data-tip={`${b.label}: ${people(n)}`}
                aria-label={`${b.label}: ${people(n)}`}
                className={`${current ? "is-today" : ""} ${n ? "has-value" : ""}`}
                onClick={() => openBucket(b)}
              >
                <i style={{ height: `${(n / max) * 100}%` }}>
                  {n > 0 && span !== "30" && <em>{n}</em>}
                </i>
                <small>{b.tick || " "}</small>
              </button>
            );
          })}
        </div>
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
    </div>
  );
}
