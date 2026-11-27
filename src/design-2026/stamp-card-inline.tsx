"use client";
// Stempelkarte direkt im Spielerprofil (Verwaltung/Team) und im Elternprofil
// (Eltern und Verwaltung). Bei mehreren Kindern Auswahl über Chips, bei
// mehreren Leistungszeiträumen ebenfalls. Lädt über den Zwischenspeicher
// (swr.ts): zuletzt gesehene Karte sofort, frischer Stand im Hintergrund.
import { forwardRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { Period } from "@/lib/types";
import type { ReportSnapshot } from "@/lib/pdf";
import {
  attendanceStats,
  disciplineStats,
  durationLabel,
  periodLabel,
} from "@/lib/domain";
import { Stamps, StampLegend } from "@/components/portal";
import { BackfillNotes, ExcusedNotes } from "@/components/attendance-notes";
import { getJson, useCached } from "./swr";
import "./stamp-card-inline.css";

type Result = {
  periods: Period[];
  period: Period | null;
  card: {
    snapshot: ReportSnapshot;
    backfillsAvailable?: boolean;
  } | null;
};

export type StampChild = { id: string; name: string };

export const StampCardInline = forwardRef<
  HTMLElement,
  {
    kids: StampChild[];
    /** Gewähltes Kind (gesteuert, z. B. durch Klick auf den Stempel). */
    childId?: string;
    onChildChange?: (id: string) => void;
    /** Stempelkarten-Seite mit PDF, Versand, Nachtrag (?child= wird angehängt). */
    fullHref?: string;
    className?: string;
  }
>(function StampCardInline(
  { kids, childId, onChildChange, fullHref, className = "" },
  ref,
) {
  const [own, setOwn] = useState("");
  const [periods, setPeriods] = useState<Record<string, string>>({});
  const chosen =
    kids.find((k) => k.id === (childId ?? own))?.id ?? kids[0]?.id ?? "";
  const periodId = periods[chosen] ?? "";
  const key = chosen ? `stamp-inline:${chosen}:${periodId || "aktuell"}` : null;
  const { data, failed, loading, refresh } = useCached<Result>(
    key,
    () =>
      getJson<Result>(
        `/api/stamp-card/player?player_id=${encodeURIComponent(chosen)}${periodId ? `&period_id=${encodeURIComponent(periodId)}` : ""}`,
        "Stempelkarte konnte nicht geladen werden.",
      ),
    { maxAge: 15000 },
  );
  if (!kids.length) return null;
  const pick = (id: string) => {
    setOwn(id);
    onChildChange?.(id);
  };
  const period = data?.period ?? undefined;
  const events = data?.card?.snapshot.events ?? [];
  const stats = attendanceStats(events);
  const included = period?.included_units ?? 0;
  return (
    <section
      ref={ref}
      id="stempelkarte"
      className={`panel inline-stamp-card ${className}`}
      aria-label="Stempelkarte"
    >
      <div className="inline-stamp-head">
        <div>
          <span className="eyebrow">TRAININGSFORTSCHRITT</span>
          <h2>Stempelkarte</h2>
          {period && (
            <p className="profile-muted">
              {period.product_name} ·{" "}
              {periodLabel(period.starts_at, period.ends_at)}
            </p>
          )}
        </div>
        <div className="inline-stamp-tools">
          <button
            type="button"
            className="text-button"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Stempelkarte aktualisieren"
            title="Aktualisieren"
          >
            <RefreshCw size={16} className={loading ? "is-spinning" : ""} />
          </button>
          {fullHref && chosen && (
            <Link
              className="text-button"
              href={`${fullHref}?child=${encodeURIComponent(chosen)}`}
              prefetch={false}
            >
              Alle Details <ArrowUpRight size={16} />
            </Link>
          )}
        </div>
      </div>
      {kids.length > 1 && (
        <div
          className="d26-chips inline-stamp-chips"
          aria-label="Kind auswählen"
        >
          {kids.map((k) => (
            <button
              type="button"
              key={k.id}
              className={`d26-chip ${k.id === chosen ? "is-active" : ""}`}
              aria-pressed={k.id === chosen}
              onClick={() => pick(k.id)}
            >
              {k.name}
            </button>
          ))}
        </div>
      )}
      {(data?.periods.length ?? 0) > 1 && (
        <div
          className="d26-chips inline-stamp-chips is-periods"
          aria-label="Leistungszeitraum auswählen"
        >
          {data!.periods.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`d26-chip ${p.id === period?.id ? "is-active" : ""}`}
              aria-pressed={p.id === period?.id}
              onClick={() => setPeriods((s) => ({ ...s, [chosen]: p.id }))}
            >
              {periodLabel(p.starts_at, p.ends_at)}
            </button>
          ))}
        </div>
      )}
      {!data && loading && (
        <p role="status" className="profile-muted">
          Stempelkarte wird geladen …
        </p>
      )}
      {failed && (
        <p role="alert" className="profile-error">
          Stempelkarte konnte nicht geladen werden.
        </p>
      )}
      {data && !period && (
        <p className="profile-muted">
          Für dieses Kind ist noch kein Leistungszeitraum zugeordnet.
        </p>
      )}
      {data && period && (
        <div className="large-stamp inline-stamp-body">
          <Stamps
            period={period}
            completed={stats.completed}
            charged={stats.charged}
            retrospective={stats.retrospective}
            planned={stats.planned}
            splitStats={disciplineStats(events)}
          />
          <StampLegend />
          <ExcusedNotes events={events} />
          <BackfillNotes events={events} />
          <p className="inline-stamp-sum">
            <b>
              {stats.completed} von {included} Einheiten angerechnet
            </b>{" "}
            · {durationLabel(stats.minutes)}
            {stats.completed > included &&
              ` · Über dem Kontingent: ${stats.completed - included}`}
          </p>
        </div>
      )}
    </section>
  );
});
