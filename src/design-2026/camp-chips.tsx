"use client";
// Design 2026: Camp-Auswahl im Camp-Detail als Chip-Leiste (wie im Sheet
// „Bezahlt gesamt“). Ersetzt das einfache Auswahl-Menü.
import { useEffect, useRef } from "react";
import Link from "next/link";

type CampChip = {
  id: string;
  title: string;
  status: string;
  days: { starts_at: string }[];
};

export function CampChips({
  camps,
  selected,
  statusLabel,
}: {
  camps: CampChip[];
  selected?: string;
  statusLabel: Record<string, string>;
}) {
  const bar = useRef<HTMLElement>(null);
  // Gewähltes Camp beim Öffnen in die Mitte der Leiste holen.
  useEffect(() => {
    const el = bar.current?.querySelector<HTMLElement>(".is-active");
    if (el && bar.current)
      bar.current.scrollLeft =
        el.offsetLeft - (bar.current.clientWidth - el.clientWidth) / 2;
  }, [selected]);
  const now = Date.now();
  const label = (c: CampChip) =>
    c.status === "archived"
      ? "Archiviert"
      : c.days[0] && Date.parse(c.days[0].starts_at) < now
        ? "Vergangen"
        : (statusLabel[c.status] ?? c.status);
  const ordered = [
    ...camps.filter((c) => c.status !== "archived"),
    ...camps.filter((c) => c.status === "archived"),
  ];
  return (
    <nav
      ref={bar}
      className="d26-chips d26-camp-chips"
      aria-label="Camp auswählen"
    >
      {ordered.map((c) => (
        <Link
          key={c.id}
          href={`/camps/${c.id}`}
          className={`d26-chip ${c.id === selected ? "is-active" : ""} ${c.status === "archived" ? "is-archived" : ""}`}
          aria-current={c.id === selected ? "page" : undefined}
        >
          {c.title}
          <em>{label(c)}</em>
        </Link>
      ))}
    </nav>
  );
}
