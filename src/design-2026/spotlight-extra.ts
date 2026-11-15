// Design 2026: zusätzliche Treffer für die Schnellsuche (⌘K): Spieler,
// anstehende Trainings und Schnellaktionen. Alles sind reine Links.
import {
  CalendarDays,
  CalendarPlus,
  CreditCard,
  RefreshCw,
  Tent,
  UserPlus,
  UserRound,
} from "lucide-react";
import type { PortalData } from "@/lib/types";
import { formatDate, formatTime } from "@/lib/domain";
import type { SpotlightItem } from "./spotlight";

export function spotlightExtra(data: PortalData): SpotlightItem[] {
  const admin = data.role === "admin";
  const parent = data.role === "parent";
  const trainingHref = parent
    ? "/termine"
    : admin
      ? "/admin/trainingsplanung"
      : "/team";
  const actions: SpotlightItem[] = parent
    ? [
        { href: "/", title: "Nächstes Training", icon: CalendarDays },
        { href: "/konto", title: "Abo verwalten", icon: CreditCard },
        { href: "/camps", title: "Camp buchen", icon: Tent },
      ]
    : admin
      ? [
          {
            href: "/admin/trainingsplanung",
            title: "Termin planen",
            icon: CalendarPlus,
          },
          {
            href: "/admin/einladungen",
            title: "Eltern einladen",
            icon: UserPlus,
          },
          { href: "/admin/stripe", title: "Stripe prüfen", icon: RefreshCw },
          { href: "/camps", title: "Camps verwalten", icon: Tent },
        ]
      : [{ href: "/team", title: "Termin planen", icon: CalendarPlus }];
  const players: SpotlightItem[] = data.players.map((p) => ({
    href: parent ? "/" : admin ? `/admin/spieler/${p.id}` : "/team",
    title: `${p.first_name} ${p.last_name}`,
    hint: p.team || undefined,
    icon: UserRound,
    group: parent ? "Kinder" : "Spieler",
  }));
  const now = Date.now();
  const trainings: SpotlightItem[] = data.events
    .filter((e) => e.status !== "cancelled" && Date.parse(e.ends_at) > now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 12)
    .map((e) => ({
      href: trainingHref,
      title: e.title,
      hint: `${formatDate(e.starts_at, { weekday: "short", day: "numeric", month: "short" })} · ${formatTime(e.starts_at)} · ${e.location_name}`,
      icon: CalendarDays,
      group: "Trainings",
    }));
  return [
    ...actions.map((a) => ({ ...a, group: "Aktionen" })),
    ...players,
    ...trainings,
  ];
}
