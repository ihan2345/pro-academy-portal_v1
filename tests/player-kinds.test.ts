import { describe, expect, it } from "vitest";
import {
  familyKinds,
  familyTeams,
  playerKind,
  playerKinds,
} from "@/lib/player-kinds";
import type { ArchivePlayer } from "@/lib/player-archive";

const row = (id: string, over: Partial<ArchivePlayer>): ArchivePlayer => ({
  id,
  name: id,
  first_name: id,
  last_name: "X",
  age: "",
  team: "",
  archived: false,
  created: "2026-01-01",
  status: "inactive",
  products: [],
  formerProducts: [],
  months: 0,
  since: null,
  trainings: 0,
  minutes: 0,
  camps: null,
  trial: null,
  parents: [],
  ...over,
});

describe("Spieler gesamt nach Art", () => {
  it("teilt inaktiv in Abo beendet und Ohne Buchung", () => {
    expect(playerKind(row("a", { formerProducts: ["Black"] }))).toBe("ended");
    expect(playerKind(row("b", {}))).toBe("none");
    expect(playerKind(undefined)).toBe("none");
  });

  it("zählt nur die übergebenen Spieler, größte Art zuerst", () => {
    const archive = [
      row("1", { status: "abo", products: ["Black"] }),
      row("2", { status: "abo", products: ["Purple"] }),
      row("3", { status: "abo", products: ["Black"] }),
      row("4", { status: "camp" }),
      row("5", { status: "trial" }),
      row("6", { formerProducts: ["Black"] }),
      row("7", { status: "camp", archived: true }),
    ];
    const rows = playerKinds(["1", "2", "3", "4", "5", "6", "8"], archive);
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Abo", 3],
      ["Camp", 1],
      ["Probetraining", 1],
      ["Abo beendet", 1],
      ["Ohne Buchung", 1],
    ]);
    expect(rows[0].hint).toBe("Laufendes Abo: Black 2 · Purple 1");
    expect(rows.reduce((s, r) => s + r.value, 0)).toBe(7);
  });

  it("Familien nach Art: stärkste Art der Kinder, jede Familie einmal", () => {
    const fam = (id: string) => [{ id, name: id }];
    const archive = [
      row("k1", { status: "abo", products: ["Black"], parents: fam("A") }),
      row("k2", { status: "camp", parents: fam("A") }),
      row("k3", { status: "camp", parents: fam("B") }),
      row("k4", { formerProducts: ["Purple"], parents: fam("C") }),
    ];
    expect(
      familyKinds(["A", "B", "C", "D"], archive).map((r) => [r.label, r.value]),
    ).toEqual([
      ["Abo", 1],
      ["Camp", 1],
      ["Abo beendet", 1],
      ["Ohne Buchung", 1],
    ]);
  });

  it("Familien nach Team: zählt je Team, archivierte Kinder nicht", () => {
    const fam = (id: string) => [{ id, name: id }];
    const archive = [
      row("k1", { team: "U8", parents: fam("A") }),
      row("k2", { team: "U12", parents: fam("A") }),
      row("k3", { team: "U8", parents: fam("B") }),
      row("k4", { team: "U16", archived: true, parents: fam("C") }),
    ];
    const t = familyTeams(["A", "B", "C"], archive);
    expect(t.rows.map((r) => [r.label, r.value])).toEqual([
      ["U8", 2],
      ["Ohne Angabe", 1],
      ["U12", 1],
    ]);
    expect(t.multi).toBe(1);
  });
});
