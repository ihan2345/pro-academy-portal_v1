import { describe, expect, it } from "vitest";
import { Bell } from "lucide-react";
import {
  activityCat,
  dayLabel,
  noteCat,
  sortNotes,
  type Note,
} from "@/design-2026/notifications";

const now = Date.parse("2026-11-20T21:00:00Z");
const ago = (h: number) => new Date(now - h * 3600000).toISOString();
const note = (n: Partial<Note> & Pick<Note, "id">): Note => ({
  key: n.id,
  tone: "info",
  icon: Bell,
  title: n.id,
  text: "",
  group: "news",
  ...n,
});

describe("Glocke: Reihenfolge", () => {
  it("sortiert Neu streng nach Zeit, unabhängig von der Farbe", () => {
    const out = sortNotes(
      [
        note({ id: "alt-info", tone: "info", at: ago(140) }),
        note({ id: "neu-gut", tone: "good", at: ago(1) }),
        note({ id: "mitte-warn", tone: "warn", at: ago(30) }),
      ],
      now,
    );
    expect(out.map((n) => n.id)).toEqual(["neu-gut", "mitte-warn", "alt-info"]);
  });

  it("lässt Jetzt wichtig nach Dringlichkeit, dann nach Zeit", () => {
    const out = sortNotes(
      [
        note({ id: "warn-neu", group: "now", tone: "warn", at: ago(1) }),
        note({ id: "sos-alt", group: "now", tone: "sos", at: ago(50) }),
        note({ id: "warn-alt", group: "now", tone: "warn", at: ago(20) }),
      ],
      now,
    );
    expect(out.map((n) => n.id)).toEqual(["sos-alt", "warn-neu", "warn-alt"]);
  });

  it("vergleicht echte Zeitpunkte statt Text", () => {
    const out = sortNotes(
      [
        note({ id: "a", at: "2026-11-20T10:00:00+00:00" }),
        note({ id: "b", at: "2026-11-20T12:30:00.000+02:00" }),
        note({ id: "c", at: "2026-11-20T10:45:00Z" }),
      ],
      now,
    );
    expect(out.map((n) => n.id)).toEqual(["c", "b", "a"]);
  });
});

describe("Glocke: Kategorien", () => {
  it("ordnet Hinweise nach Art", () => {
    expect(noteCat({ key: "trial:request:1" })).toBe("trial");
    expect(noteCat({ key: "pay:sub_1" })).toBe("pay");
    expect(noteCat({ key: "ending:p1" })).toBe("pay");
    expect(noteCat({ key: "today:2026-11-20" })).toBe("training");
    expect(noteCat({ key: "report:r1" })).toBe("reports");
    expect(noteCat({ key: "act:1", cat: "pay" })).toBe("pay");
    expect(activityCat("Probetraining-Mail versendet")).toBe("trial");
    expect(activityCat("Zahlung fehlgeschlagen")).toBe("pay");
    expect(activityCat("Teilnahme bestätigt")).toBe("training");
    expect(activityCat("Elternprofil angelegt")).toBe("other");
  });

  it("setzt Trennzeilen nach Berliner Kalendertag", () => {
    expect(dayLabel(Date.parse(ago(2)), now)).toBe("Heute");
    expect(dayLabel(Date.parse(ago(26)), now)).toBe("Gestern");
    expect(dayLabel(Date.parse(ago(24 * 4)), now)).toBe("Diese Woche");
    expect(dayLabel(Date.parse(ago(24 * 9)), now)).toBe("Älter");
  });
});

it("fasst Ereignisse einer Familie am selben Tag zusammen", async () => {
  const { groupActivities } = await import("../src/design-2026/notifications");
  const row = (id: string, at: string, title: string, extra = {}) => ({
    id,
    at,
    title,
    text: "",
    subject: "Max Muster",
    actor: "Automatisch",
    tone: "normal" as const,
    family: "Eva Muster",
    ...extra,
  });
  const groups = groupActivities([
    row("1", "2026-11-22T09:20:00Z", "Abo-Zuordnung aufgehoben"),
    row("2", "2026-11-22T09:21:00Z", "Abo beendet", { tone: "problem" }),
    row("3", "2026-11-22T08:00:00Z", "Training geändert", {
      family: undefined,
      subject: null,
    }),
  ]);
  expect(groups).toHaveLength(2);
  expect(groups[0].label).toBe("Familie Eva Muster");
  expect(groups[0].rows.map((r) => r.id)).toEqual(["2", "1"]);
  expect(groups[0].lead.title).toBe("Abo beendet");
});
