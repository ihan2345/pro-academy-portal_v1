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
  const aboHint = [...products.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p} ${n}`)
    .join(" · ");
  return PLAYER_KINDS.map((k) => ({
    label: k.label,
    value: count.get(k.kind) ?? 0,
    tone: `kind-${k.kind}`,
    hint: k.kind === "abo" && aboHint ? `${k.hint}: ${aboHint}` : k.hint,
  }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}
