"use client";
// Design 2026: Seitenkopf der Stempelkarten (Admin und Team). Wählt beim
// Antippen nur Kind und Zeitraum aus, Export und Versand bleiben unverändert.
import { CalendarClock, CheckCircle2, Layers, Users } from "lucide-react";
import type { PortalData } from "@/lib/types";
import { formatDate, isAttended, periodLabel } from "@/lib/domain";
import { PageHead, SheetRow } from "./page-head";

export function StampHead({
  data,
  pick,
}: {
  data: PortalData;
  pick: (playerId: string, periodId: string) => void;
}) {
  const now = Date.now();
  const name = (id: string) => {
    const p = data.players.find((x) => x.id === id);
    return p ? `${p.first_name} ${p.last_name}` : "Spieler";
  };
  const running = data.periods.filter(
    (p) =>
      p.status === "active" &&
      Date.parse(p.starts_at) <= now &&
      Date.parse(p.ends_at) > now,
  );
  const ending = running
    .filter((p) => Date.parse(p.ends_at) - now < 7 * 86400000)
    .sort((a, b) => a.ends_at.localeCompare(b.ends_at));
  const used = (periodId: string) =>
    data.events.reduce(
      (s, e) =>
        s +
        e.participants.filter(
          (x) =>
            x.period_id === periodId &&
            !x.removed_from_event &&
            isAttended(x.status),
        ).length,
      0,
    );
  const full = running.filter((p) => used(p.id) >= p.included_units);
  const row = (p: (typeof running)[number], close: () => void) => (
    <SheetRow
      key={p.id}
      title={name(p.player_id)}
      meta={`${p.product_name} · ${periodLabel(p.starts_at, p.ends_at)}`}
      pill={`${used(p.id)} / ${p.included_units}`}
      onClick={() => {
        pick(p.player_id, p.id);
        close();
      }}
    />
  );
  const list = (items: typeof running) => (close: () => void) => (
    <div className="d26-mini-list">
      {items.map((p) => row(p, close))}
      {!items.length && <p className="d26-empty">Keine Zeiträume.</p>}
    </div>
  );
  return (
    <PageHead
      title="Stempelkarten"
      greeting={`${running.length === 1 ? "1 laufender Zeitraum" : `${running.length} laufende Zeiträume`}${ending.length ? `, ${ending.length} ${ending.length === 1 ? "endet" : "enden"} in den nächsten 7 Tagen` : ""}. Tippe auf eine Kennzahl, um direkt zur Karte zu springen.`}
      kpis={[
        {
          icon: Users,
          value: data.players.length,
          label: "Kinder",
        },
        {
          icon: Layers,
          value: running.length,
          label: "Laufende Zeiträume",
          sheet: { title: "Laufende Zeiträume", body: list(running) },
        },
        {
          icon: CalendarClock,
          value: ending.length,
          label: "Enden bald",
          alert: ending.length > 0,
          tip: ending[0]
            ? `Als Nächstes ${name(ending[0].player_id)} am ${formatDate(ending[0].ends_at)}`
            : "Nichts endet in den nächsten 7 Tagen",
          sheet: {
            title: "Enden in 7 Tagen",
            eyebrow: "Bericht steht an",
            body: list(ending),
          },
        },
        {
          icon: CheckCircle2,
          value: full.length,
          label: "Kontingent voll",
          sheet: { title: "Kontingent ausgeschöpft", body: list(full) },
        },
      ]}
    />
  );
}
