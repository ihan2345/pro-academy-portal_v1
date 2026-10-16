"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Settings,
  Zap,
  FileText,
  ArrowUpRight,
} from "lucide-react";
const items = [
  {
    href: "/admin/stripe",
    title: "Stripe-Zuordnung",
    description: "Stripe-Kunden und Abos zuordnen",
    icon: Zap,
    sections: ["admin/stripe"],
  },
  {
    href: "/admin/produkte-berichte",
    title: "Produkte & Berichte",
    description: "Produkte, Berichte und Protokolle",
    icon: FileText,
    sections: ["admin/produkte-berichte", "admin/produkte", "admin/protokolle"],
  },
  {
    href: "/admin/einladungen",
    title: "Einladungen",
    description: "Einladungen verwalten und versenden",
    icon: ArrowUpRight,
    sections: ["admin/einladungen"],
  },
];
export function AdminNavigation({
  section,
  collapsed,
  expandSidebar,
  navigate,
}: {
  section: string;
  collapsed: boolean;
  expandSidebar: () => void;
  navigate: () => void;
}) {
  const active = items.some((item) => item.sections.includes(section));
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (active) setOpen(true);
  }, [section, active]);
  const expanded = open && !collapsed;
  return (
    <div className="admin-navigation">
      <button
        type="button"
        className={`nav-link admin-navigation-toggle ${active ? "active" : ""}`}
        aria-expanded={expanded}
        aria-controls="admin-navigation-items"
        aria-label="Verwaltung"
        title={collapsed ? "Verwaltung" : undefined}
        onClick={() => {
          if (collapsed) {
            expandSidebar();
            setOpen(true);
          } else setOpen((value) => !value);
        }}
      >
        <Settings size={19} />
        <span>Verwaltung</span>
        <ChevronDown
          size={16}
          className={`admin-navigation-chevron ${expanded ? "is-open" : ""}`}
        />
      </button>
      <div
        id="admin-navigation-items"
        className="admin-navigation-items"
        hidden={!expanded}
      >
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`admin-navigation-item ${item.sections.includes(section) ? "active" : ""}`}
            aria-current={section === item.href.slice(1) ? "page" : undefined}
            onClick={navigate}
          >
            <item.icon size={18} />
            <span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
