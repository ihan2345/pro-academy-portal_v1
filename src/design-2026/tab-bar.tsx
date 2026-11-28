"use client";
// Design 2026: Tab-Leiste unten auf dem Handy (wie bei iOS-Apps).
// Zeigt nur Menüpunkte, die es schon gibt; "Mehr" öffnet das bisherige Menü.
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import type { SpotlightItem } from "./spotlight";
import type { NavCount } from "./nav-2026";

const shortNames: Record<string, string> = {
  Trainingsplanung: "Planung",
  Stempelkarten: "Stempel",
  Elternprofile: "Familien",
  Spielerprofil: "Spieler",
  Spielerprofile: "Spieler",
};
const short = (title: string) =>
  shortNames[title] ?? title.replace("Meine ", "").replace("Mein ", "");

export function TabBar({
  items,
  isActive,
  openMenu,
  counts = {},
}: {
  items: SpotlightItem[];
  isActive: (href: string) => boolean;
  openMenu: () => void;
  /** Zahlen je Menüpunkt (Design 2026), als Badge am Symbol. */
  counts?: Record<string, NavCount>;
}) {
  const shown = items.slice(0, 4);
  // Punkt an „Mehr“, wenn dort etwas Neues wartet.
  const moreFresh = items
    .slice(4)
    .some((item) => counts[item.href]?.tone === "new");
  return (
    <nav className="d26-tabbar" aria-label="Schnellnavigation">
      {shown.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={isActive(item.href) ? "is-active" : ""}
          aria-current={isActive(item.href) ? "page" : undefined}
        >
          <span className="d26-tab-icon">
            <item.icon size={20} />
          </span>
          {counts[item.href] && (
            <b
              className={`d26-tab-badge tone-${counts[item.href].tone}`}
              aria-label={counts[item.href].tip}
            >
              {counts[item.href].value}
            </b>
          )}
          <span>{short(item.title)}</span>
        </Link>
      ))}
      <button type="button" onClick={openMenu}>
        <span className="d26-tab-icon">
          <LayoutGrid size={20} />
        </span>
        {moreFresh && (
          <b className="d26-tab-badge is-dot" aria-label="Neues im Menü" />
        )}
        <span>Mehr</span>
      </button>
    </nav>
  );
}
