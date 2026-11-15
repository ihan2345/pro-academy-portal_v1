"use client";
// Design 2026: Kategorien, Sortierung und Kinderauswahl im Shop. Filtert und
// sortiert nur die bereits geladenen Angebote im Browser. Kauf, Preise und
// Freigaben laufen unverändert über den bestehenden Shop.
import { ArrowDownUp, Baby, Sparkles } from "lucide-react";
import { kindLabels } from "@/lib/products/domain";

export type ShopSort = "recommended" | "price-asc" | "price-desc" | "name";
export type ShopState = { kind: string; sort: ShopSort };
export const initialShop: ShopState = { kind: "", sort: "recommended" };

type Row = {
  kind: string;
  name: string;
  featured?: boolean;
  popular?: boolean;
  price: { amount: number } | null;
};

const amount = (r: Row) => r.price?.amount ?? Number.POSITIVE_INFINITY;

export function applyShop<T extends Row>(rows: T[], state: ShopState): T[] {
  const list = rows.filter((r) => !state.kind || r.kind === state.kind);
  if (state.sort === "recommended")
    return [...list].sort(
      (a, b) =>
        Number(!!b.featured) - Number(!!a.featured) ||
        Number(!!b.popular) - Number(!!a.popular),
    );
  if (state.sort === "name")
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "de"));
  return [...list].sort((a, b) =>
    state.sort === "price-asc"
      ? amount(a) - amount(b)
      : (b.price?.amount ?? -1) - (a.price?.amount ?? -1),
  );
}

const sorts: [ShopSort, string][] = [
  ["recommended", "Empfohlen"],
  ["price-asc", "Preis aufsteigend"],
  ["price-desc", "Preis absteigend"],
  ["name", "A–Z"],
];

export function ShopFilters({
  rows,
  state,
  setState,
  kids,
  kid,
  pickKid,
}: {
  rows: Row[];
  state: ShopState;
  setState: (s: ShopState) => void;
  kids?: { id: string; name: string }[];
  kid?: string;
  pickKid?: (value: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  const kinds = [...counts.entries()];
  return (
    <div className="d26-shop-filters">
      {kids && pickKid && (
        <div className="d26-chips" aria-label="Für welches Kind?">
          <small>
            <Baby size={14} /> Für
          </small>
          {kids.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`d26-chip ${kid === c.id ? "is-active" : ""}`}
              onClick={() => pickKid(kid === c.id ? "" : c.id)}
            >
              {c.name.split(" ")[0]}
            </button>
          ))}
          <button
            type="button"
            className={`d26-chip ${kid === "new" ? "is-active" : ""}`}
            onClick={() => pickKid(kid === "new" ? "" : "new")}
          >
            + Weiteres Kind
          </button>
        </div>
      )}
      {kinds.length > 1 && (
        <div className="d26-chips" aria-label="Kategorie">
          <small>
            <Sparkles size={14} /> Art
          </small>
          <button
            type="button"
            className={`d26-chip ${!state.kind ? "is-active" : ""}`}
            onClick={() => setState({ ...state, kind: "" })}
          >
            Alle <em>{rows.length}</em>
          </button>
          {kinds.map(([k, n]) => (
            <button
              key={k}
              type="button"
              className={`d26-chip ${state.kind === k ? "is-active" : ""}`}
              onClick={() =>
                setState({ ...state, kind: state.kind === k ? "" : k })
              }
            >
              {kindLabels[k as keyof typeof kindLabels] ?? k} <em>{n}</em>
            </button>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="d26-chips" aria-label="Sortierung">
          <small>
            <ArrowDownUp size={14} /> Sortieren
          </small>
          {sorts.map(([s, label]) => (
            <button
              key={s}
              type="button"
              className={`d26-chip ${state.sort === s ? "is-active" : ""}`}
              onClick={() => setState({ ...state, sort: s })}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
