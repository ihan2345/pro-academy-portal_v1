"use client";
// Design 2026: Tab-Leiste unten auf dem Handy (wie bei iOS-Apps).
// Zeigt nur Menüpunkte, die es schon gibt; "Mehr" öffnet das bisherige Menü.
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import type { SpotlightItem } from "./spotlight";

export function TabBar({
  items,
  isActive,
  openMenu,
}: {
  items: SpotlightItem[];
  isActive: (href: string) => boolean;
  openMenu: () => void;
}) {
  return (
    <nav className="d26-tabbar" aria-label="Schnellnavigation">
      {items.slice(0, 4).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={isActive(item.href) ? "is-active" : ""}
          aria-current={isActive(item.href) ? "page" : undefined}
        >
          <span className="d26-tab-icon">
            <item.icon size={20} />
          </span>
          <span>{item.title.replace("Meine ", "").replace("Mein ", "")}</span>
        </Link>
      ))}
      <button type="button" onClick={openMenu}>
        <span className="d26-tab-icon">
          <LayoutGrid size={20} />
        </span>
        <span>Mehr</span>
      </button>
    </nav>
  );
}
