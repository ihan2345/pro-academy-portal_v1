// Zentrale „Spieler gesamt“, Ansicht „Nach Art“: jedes Spielerprofil der
// Kachel bekommt genau eine Art. Grundlage sind die Status-Regeln des Archivs
// (laufendes Abo > nur Camp > nur Probetraining > ohne). „Inaktiv“ wird dabei
// aufgeteilt in „Abo beendet“ (früher ein Abo) und „Ohne Buchung“.
import type { ArchivePlayer } from "./player-archive";

export type PlayerKind = "abo" | "camp" | "trial" | "ended" | "none";

export const PLAYER_KINDS: { kind: PlayerKind; label: string; hint: string }[] =
  [
    { kind: "abo", label: "Abo", hint: "Laufendes Abo" },
    { kind: "camp", label: "Camp", hint: "Bezahltes Camp, nie ein Abo" },
    {
      kind: "trial",
      label: "Probetraining",
      hint: "Nur Probetraining, kein Abo und kein Camp",
    },
    {
      kind: "ended",
      label: "Abo beendet",
      hint: "Früher ein Abo, jetzt keins",
    },
    {
      kind: "none",
      label: "Ohne Buchung",
      hint: "Weder Abo noch Camp noch Probetraining",
    },
  ];

export function playerKind(r: ArchivePlayer | undefined): PlayerKind {
  if (!r) return "none";
  if (r.status === "abo") return "abo";
  if (r.status === "camp") return "camp";
  if (r.status === "trial") return "trial";
  return r.formerProducts.length ? "ended" : "none";
}

const RANK: PlayerKind[] = ["abo", "camp", "trial", "ended", "none"];

function rows(count: Map<PlayerKind, number>, aboHint: string) {
  return PLAYER_KINDS.map((k) => ({
    label: k.label,
    value: count.get(k.kind) ?? 0,
    tone: `kind-${k.kind}`,
    hint: k.kind === "abo" && aboHint ? `${k.hint}: ${aboHint}` : k.hint,
  }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}
function joinProducts(products: Map<string, number>) {
  return [...products.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p} ${n}`)
    .join(" · ");
}

/** Zeilen für BreakdownBars, größte Art zuerst, leere Arten fallen weg. */
export function playerKinds(ids: string[], archive: ArchivePlayer[]) {
  const byId = new Map(archive.map((r) => [r.id, r]));
  const count = new Map<PlayerKind, number>();
  const products = new Map<string, number>();
  for (const id of ids) {
    const row = byId.get(id);
    const kind = playerKind(row);
    count.set(kind, (count.get(kind) ?? 0) + 1);
    if (kind === "abo")
      for (const p of row?.products.length ? row.products : ["Abo"])
        products.set(p, (products.get(p) ?? 0) + 1);
  }
  return rows(count, joinProducts(products));
}

function kidsByFamily(archive: ArchivePlayer[]) {
  const kids = new Map<string, ArchivePlayer[]>();
  for (const r of archive)
    for (const p of r.parents) kids.set(p.id, [...(kids.get(p.id) ?? []), r]);
  return kids;
}

/**
 * Elternprofile „Nach Art“: jede Familie genau einmal, mit der stärksten Art
 * ihrer Kinder (Abo > Camp > Probetraining > Abo beendet > Ohne Buchung).
 */
export function familyKinds(familyIds: string[], archive: ArchivePlayer[]) {
  const kids = kidsByFamily(archive);
  const count = new Map<PlayerKind, number>();
  const products = new Map<string, number>();
  for (const id of familyIds) {
    const own = kids.get(id) ?? [];
    const kind =
      RANK.find((k) => own.some((r) => playerKind(r) === k)) ?? "none";
    count.set(kind, (count.get(kind) ?? 0) + 1);
    if (kind === "abo")
      for (const p of new Set(
        own.filter((r) => r.status === "abo").flatMap((r) => r.products),
      ))
        products.set(p, (products.get(p) ?? 0) + 1);
  }
  return rows(count, joinProducts(products));
}

/**
 * Elternprofile „Nach Team“: Familie zählt in jedem Team, in dem ein nicht
 * archiviertes Kind spielt. Mit Kindern in mehreren Teams also mehrfach.
 */
export function familyTeams(familyIds: string[], archive: ArchivePlayer[]) {
  const kids = kidsByFamily(archive);
  const count = new Map<string, number>();
  let multi = 0;
  for (const id of familyIds) {
    const teams = new Set(
      (kids.get(id) ?? [])
        .filter((r) => !r.archived)
        .map((r) => r.team?.trim() || "Ohne Angabe"),
    );
    if (!teams.size) teams.add("Ohne Angabe");
    if (teams.size > 1) multi++;
    for (const t of teams) count.set(t, (count.get(t) ?? 0) + 1);
  }
  return {
    rows: [...count.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"))
      .map(([label, value]) => ({ label, value, tone: "purple" })),
    multi,
  };
}
