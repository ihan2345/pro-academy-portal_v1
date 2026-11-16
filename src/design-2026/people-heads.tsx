"use client";
// Design 2026: Seitenköpfe für Spielerprofile und Elternprofile im Stil der
// Zentrale. Rechnen nur mit den bereits geladenen Zeilen der Liste.
import {
  CalendarRange,
  Clock3,
  Crown,
  ShieldCheck,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import type { PlayerProfilePage } from "@/lib/player-profiles";
import type { ProfileListRow } from "@/lib/parent-profile";
import { familyStatus } from "@/lib/parent-profile";
import { PageHead, SheetRow } from "./page-head";

const hours = (m: number) =>
  new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(m / 60);

export function PlayerDirectoryHead({
  rows,
  total,
  base,
}: {
  rows: PlayerProfilePage["rows"];
  total: number;
  base: string;
}) {
  const minutes = rows.reduce((s, r) => s + r.stats.all.minutes, 0);
  const avgMonths = rows.length
    ? Math.round(rows.reduce((s, r) => s + r.months, 0) / rows.length)
    : 0;
  const month = rows.reduce((s, r) => s + r.stats.month.count, 0);
  const top = (key: (r: (typeof rows)[number]) => number) =>
    [...rows].sort((a, b) => key(b) - key(a)).slice(0, 10);
  const list = (
    items: typeof rows,
    meta: (r: (typeof rows)[number]) => string,
    pill: (r: (typeof rows)[number]) => string,
  ) => (
    <div className="d26-mini-list">
      {items.map((r) => (
        <SheetRow
          key={r.id}
          title={r.name}
          meta={meta(r)}
          pill={pill(r)}
          href={`${base}/spieler/${r.id}`}
        />
      ))}
      {!items.length && (
        <p className="d26-empty">Noch keine Spieler geladen.</p>
      )}
    </div>
  );
  return (
    <PageHead
      title="Spielerprofile"
      greeting={
        total
          ? `${total} aktive Spieler mit Abo. Diesen Monat ${month === 1 ? "1 Einheit" : `${month} Einheiten`} bei den geladenen Profilen.`
          : "Aktive Kinder mit Abo und ihre Entwicklung auf einen Blick."
      }
      kpis={[
        {
          icon: Users,
          value: total,
          label: "Spieler",
          tip: `${rows.length} davon geladen`,
          sheet: {
            title: "Alle Spieler",
            eyebrow: `${rows.length} geladen`,
            body: list(
              rows,
              (r) => `${r.age}${r.team ? ` · ${r.team}` : ""}`,
              (r) => r.products[0] ?? "Abo",
            ),
          },
        },
        {
          icon: Clock3,
          value: `${hours(minutes)} Std.`,
          label: "Trainingszeit gesamt",
          sheet: {
            title: "Meiste Trainingsstunden",
            eyebrow: "Top 10",
            body: list(
              top((r) => r.stats.all.minutes),
              (r) => `${r.stats.all.count} Einheiten`,
              (r) => `${hours(r.stats.all.minutes)} Std.`,
            ),
          },
        },
        {
          icon: Crown,
          value: avgMonths,
          label: "Ø Monate dabei",
          sheet: {
            title: "Längste Treue",
            eyebrow: "Top 10",
            body: list(
              top((r) => r.months),
              (r) => familyStatus(r.months).label,
              (r) => `${r.months} Monate`,
            ),
          },
        },
        {
          icon: Trophy,
          value: rows.reduce((s, r) => s + (r.camps ?? 0), 0),
          label: "Campbesuche",
          sheet: {
            title: "Camp-Fans",
            eyebrow: "Top 10",
            body: list(
              top((r) => r.camps ?? 0).filter((r) => (r.camps ?? 0) > 0),
              (r) =>
                r.parents.map((p) => p.name).join(", ") || "Ohne Elternprofil",
              (r) => `${r.camps} Camps`,
            ),
          },
        },
      ]}
    />
  );
}

export function ParentListHead({
  rows,
  total,
  loading,
  base,
}: {
  rows: ProfileListRow[];
  total: number | null;
  loading: boolean;
  base: string;
}) {
  const kids = rows.reduce((s, r) => s + r.children, 0);
  const active = rows.filter((r) => r.portal_access?.activated);
  const inactive = rows.filter(
    (r) => r.portal_access && !r.portal_access.activated,
  );
  const loyal = [...rows].sort((a, b) => b.months - a.months).slice(0, 10);
  const list = (
    items: ProfileListRow[],
    pill: (r: ProfileListRow) => string,
  ) => (
    <div className="d26-mini-list">
      {items.map((r) => (
        <SheetRow
          key={r.id}
          title={r.name}
          meta={`${r.children} ${r.children === 1 ? "Kind" : "Kinder"} · ${r.products.join(", ") || "Kein Abo"}`}
          pill={pill(r)}
          href={`${base}/${r.id}`}
        />
      ))}
      {!items.length && <p className="d26-empty">Niemand in dieser Auswahl.</p>}
    </div>
  );
  return (
    <PageHead
      title="Elternprofile"
      greeting={
        loading && !rows.length
          ? "Elternprofile werden geladen …"
          : `${total ?? rows.length} Familien in dieser Auswahl${inactive.length ? `, ${inactive.length} davon noch ohne aktiven Portalzugang` : ""}.`
      }
      kpis={[
        {
          icon: Users,
          value: total ?? rows.length,
          label: "Familien",
          sheet: {
            title: "Familien auf dieser Seite",
            body: list(rows, (r) => familyStatus(r.months).label),
          },
        },
        { icon: UserRound, value: kids, label: "Kinder auf dieser Seite" },
        {
          icon: ShieldCheck,
          value: active.length,
          label: "Im Portal aktiv",
          alert: inactive.length > 0,
          tip: inactive.length
            ? `${inactive.length} noch nicht aktiviert`
            : "Alle aktiviert",
          sheet: {
            title: "Noch nicht im Portal",
            eyebrow: `${inactive.length} Familien`,
            body: list(inactive, () => "Einladen"),
          },
        },
        {
          icon: CalendarRange,
          value: rows.length
            ? Math.round(rows.reduce((s, r) => s + r.months, 0) / rows.length)
            : 0,
          label: "Ø Statusmonate",
          sheet: {
            title: "Treueste Familien",
            eyebrow: "Top 10",
            body: list(loyal, (r) => `${r.months} Monate`),
          },
        },
      ]}
    />
  );
}

export function ParentListFilters({
  campOnly,
  sort,
  includeInactive,
  revenue,
  set,
}: {
  campOnly: boolean;
  sort: string;
  includeInactive: boolean;
  revenue: boolean;
  set: (patch: {
    campOnly?: boolean;
    sort?: string;
    includeInactive?: boolean;
  }) => void;
}) {
  const sorts: [string, string][] = [
    ["name", "A–Z"],
    ["months", "Treue"],
    ...(revenue ? ([["revenue", "Umsatz"]] as [string, string][]) : []),
    ["newest", "Neueste"],
  ];
  return (
    <div className="d26-shop-filters">
      <div className="d26-chips" aria-label="Familien">
        <small>Familien</small>
        <button
          type="button"
          className={`d26-chip ${!campOnly ? "is-active" : ""}`}
          onClick={() => set({ campOnly: false })}
        >
          Alle
        </button>
        <button
          type="button"
          className={`d26-chip ${campOnly ? "is-active" : ""}`}
          onClick={() => set({ campOnly: true })}
        >
          Campfamilien
        </button>
        <button
          type="button"
          className={`d26-chip ${includeInactive ? "is-active" : ""}`}
          onClick={() => set({ includeInactive: !includeInactive })}
        >
          Auch ohne aktives Abo
        </button>
      </div>
      <div className="d26-chips" aria-label="Sortierung">
        <small>Sortieren</small>
        {sorts.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={`d26-chip ${sort === v ? "is-active" : ""}`}
            onClick={() => set({ sort: v })}
          >
            {label}
          </button>
        ))}
      </div>
      {sort === "revenue" && (
        <p className="d26-filter-note">
          Gesamtumsatz aus Stripe-Zahlungen inklusive Camps, abzüglich
          Erstattungen. Nicht eindeutig belegbare Euro-Umsätze stehen am Ende.
        </p>
      )}
    </div>
  );
}
