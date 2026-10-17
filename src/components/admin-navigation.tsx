"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ActivityBadge } from "./activities";
import {
  Activity,
  ChevronDown,
  Settings,
  Users,
  Zap,
  FileText,
  ArrowUpRight,
} from "lucide-react";
const adminItems = [
  {
    href: "/admin/spieler",
    title: "Spieler & Eltern",
    description: "Spieler und Eltern verwalten",
    icon: Users,
    sections: ["admin/spieler"],
  },
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
  role = "admin",
  collapsed,
  expandSidebar,
  navigate,
}: {
  section: string;
  role?: "admin" | "staff";
  collapsed: boolean;
  expandSidebar: () => void;
  navigate: () => void;
}) {
  const base = role === "admin" ? "/admin" : "/team";
  const items = [
    ...(role === "admin" ? adminItems : []),
    {
      href: `${base}/aktivitaeten`,
      title: "Aktivitäten",
      description: "Was in der Academy passiert",
      icon: Activity,
      sections: [
        `${base.slice(1)}/aktivitaeten`,
        `${base.slice(1)}/aktivitaeten/alle`,
      ],
    },
  ];
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
              <strong>
                {item.title}
                {item.title === "Aktivitäten" && <ActivityBadge />}
              </strong>
              <small>{item.description}</small>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
