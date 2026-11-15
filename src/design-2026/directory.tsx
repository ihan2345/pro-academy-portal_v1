"use client";
// Design 2026: Übersicht und Schnellfilter für Verwaltungslisten
// (Spieler, Eltern, Mitarbeiter, Standorte). Filtert nur bereits geladene Zeilen.
import { CheckCircle2, CircleDashed, Layers, Users } from "lucide-react";
import { CountUp } from "./ui";

type Row = Record<string, unknown>;

const facets: Record<
  string,
  {
    key: string;
    label: string;
    plural: string;
    names?: Record<string, string>;
  }
> = {
  spieler: { key: "team", label: "Altersklasse", plural: "Altersklassen" },
  eltern: {
    key: "portal_status",
    label: "Kontostatus",
    plural: "Kontostatus",
    names: {
      registered: "Angemeldet",
      invited: "Eingeladen",
      none: "Keine Einladung",
    },
  },
  standorte: {
    key: "active",
    label: "Status",
    plural: "Status",
    names: { true: "Aktiv", false: "Inaktiv" },
  },
  mitarbeiter: {
    key: "active",
    label: "Status",
    plural: "Status",
    names: { true: "Aktiv", false: "Inaktiv" },
  },
};

const valueOf = (slug: string, row: Row) => {
  const f = facets[slug];
  if (!f) return "";
  const raw = row[f.key];
  return raw === undefined || raw === null || raw === "" ? "none" : String(raw);
};

export function matchesFacet(slug: string, row: Row, value: string) {
  return !value || valueOf(slug, row) === value;
}

export function DirectoryOverview({
  slug,
  rows,
  value,
  change,
  assignment,
  setAssignment,
}: {
  slug: string;
  rows: Row[];
  value: string;
  change: (v: string) => void;
  assignment?: string;
  setAssignment?: (v: "all" | "open" | "assigned") => void;
}) {
  const facet = facets[slug];
  if (!facet || !rows.length) return null;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = valueOf(slug, r);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const options = [...counts.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], "de"),
  );
  const linked = rows.filter(
    (r) => (r.parent_players as unknown[] | undefined)?.length,
  ).length;
  const hasLinks = slug === "spieler" || slug === "eltern";
  const name = (v: string) =>
    facet.names?.[v] ?? (v === "none" ? "Ohne Angabe" : v);
  const tiles = [
    { icon: Users, value: rows.length, label: "Gesamt", key: "all" },
    ...(hasLinks
      ? [
          {
            icon: CheckCircle2,
            value: linked,
            label: "Zugeordnet",
            key: "assigned",
          },
          {
            icon: CircleDashed,
            value: rows.length - linked,
            label: "Noch offen",
            key: "open",
          },
        ]
      : []),
    { icon: Layers, value: options.length, label: facet.plural, key: "" },
  ];
  return (
    <div className="d26-directory">
      <div className="d26-directory-tiles">
        {tiles.map((t) =>
          hasLinks && setAssignment && t.key ? (
            <button
              type="button"
              className={`d26-card d26-mini-kpi is-tappable ${assignment === t.key ? "is-selected" : ""}`}
              key={t.label}
              onClick={() =>
                setAssignment(t.key as "all" | "open" | "assigned")
              }
            >
              <t.icon size={16} />
              <b>
                <CountUp value={t.value} />
              </b>
              <span>{t.label}</span>
            </button>
          ) : (
            <div className="d26-card d26-mini-kpi" key={t.label}>
              <t.icon size={16} />
              <b>
                <CountUp value={t.value} />
              </b>
              <span>{t.label}</span>
            </div>
          ),
        )}
        {hasLinks && (
          <div
            className="d26-card d26-mini-kpi d26-ratio"
            data-tip={`${Math.round((linked / rows.length) * 100)} % zugeordnet`}
          >
            <span>Zuordnung</span>
            <i>
              <em style={{ width: `${(linked / rows.length) * 100}%` }} />
            </i>
          </div>
        )}
      </div>
      <div className="d26-chips" aria-label={facet.label}>
        <button
          type="button"
          className={`d26-chip ${!value ? "is-active" : ""}`}
          onClick={() => change("")}
        >
          Alle <em>{rows.length}</em>
        </button>
        {options.map(([v, n]) => (
          <button
            type="button"
            key={v}
            className={`d26-chip ${value === v ? "is-active" : ""}`}
            onClick={() => change(value === v ? "" : v)}
          >
            {name(v)} <em>{n}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Kleiner Initialen-Avatar vor Namen in Listen. */
export function Initials({ text }: { text: string }) {
  const letters = text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  return (
    <i className="d26-initials" aria-hidden="true">
      {letters || "?"}
    </i>
  );
}
