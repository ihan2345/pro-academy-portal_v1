"use client";
// Design 2026: neue Admin-Startseite ("Zentrale").
// Liest nur die Portaldaten, die die Admin-Übersicht schon bekommt, und bindet
// den bestehenden Stripe-/Abo-Posteingang unverändert ein.
import Link from "next/link";
import {
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  FileText,
  Inbox,
  Mail,
  MapPin,
  RefreshCw,
  Settings,
  ShoppingBag,
  Tent,
  UserPlus,
  Users,
} from "lucide-react";
import type { PortalData, Training } from "@/lib/types";
import { formatDate, formatTime } from "@/lib/domain";
import { SubscriptionReviews } from "@/components/subscription-reviews";
import { useMounted } from "./parent-experience";

function dayStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function AdminHome({ data }: { data: PortalData }) {
  const mounted = useMounted();
  if (!mounted) return <div className="d26-experience" aria-busy="true" />;
  return <AdminHomeView data={data} />;
}

function AdminHomeView({ data }: { data: PortalData }) {
  const now = new Date();
  const today = dayStart(now);
  const active = data.events.filter((e) => e.status !== "cancelled");
  const onDay = (d: Date) =>
    active
      .filter((e) => dayStart(new Date(e.starts_at)).getTime() === d.getTime())
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  let focusDay = today;
  let focus = onDay(today);
  for (let i = 1; !focus.length && i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    if (onDay(d).length) {
      focusDay = d;
      focus = onDay(d);
    }
  }
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return { d, count: onDay(d).length };
  });
  const maxWeek = Math.max(1, ...week.map((w) => w.count));
  const weekTotal = week.reduce((s, w) => s + w.count, 0);
  const openAttendance = active.filter(
    (e) =>
      Date.parse(e.ends_at) < Date.now() &&
      e.participants.some((p) => p.status === "planned"),
  ).length;
  const playerName = (id: string) => {
    const p =
      data.players.find((x) => x.id === id) ??
      data.trial_players?.find((x) => x.id === id);
    return p ? `${p.first_name} ${p.last_name.charAt(0)}.` : "";
  };
  const isToday = focusDay.getTime() === today.getTime();
  const actions = [
    {
      href: "/admin/trainingsplanung",
      title: "Termin planen",
      icon: CalendarPlus,
      tone: "lime",
    },
    { href: "/admin/spieler", title: "Familien", icon: Users, tone: "purple" },
    { href: "/admin/stripe", title: "Stripe", icon: RefreshCw, tone: "blue" },
    {
      href: "/admin/einladungen",
      title: "Einladen",
      icon: UserPlus,
      tone: "orange",
    },
    {
      href: "/admin/protokolle",
      title: "Versand",
      icon: Mail,
      tone: "pink",
    },
    {
      href: "/admin/produkte",
      title: "Produkte",
      icon: ShoppingBag,
      tone: "teal",
    },
    { href: "/camps", title: "Camps", icon: Tent, tone: "amber" },
    {
      href: "/admin/einstellungen",
      title: "System",
      icon: Settings,
      tone: "gray",
    },
  ];
  return (
    <div className="d26-experience">
      <header className="d26-large-title">
        <div>
          <span>
            {formatDate(now.toISOString(), {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
          <h1>Zentrale</h1>
        </div>
      </header>
      <p className="d26-greeting">
        {focus.length
          ? `${isToday ? "Heute" : formatDate(focusDay.toISOString(), { weekday: "long" })} stehen ${focus.length} ${focus.length === 1 ? "Training" : "Trainings"} an.`
          : "Die nächsten zwei Wochen sind noch frei."}
        {openAttendance
          ? ` ${openAttendance} vergangene ${openAttendance === 1 ? "Termin wartet" : "Termine warten"} auf Bestätigung.`
          : ""}
      </p>

      <div className="d26-kpis">
        {[
          { label: "Spieler", value: data.players.length, icon: Users },
          { label: "Diese Woche", value: weekTotal, icon: CalendarDays },
          { label: "Offen zu bestätigen", value: openAttendance, icon: Inbox },
          { label: "Berichte", value: data.reports.length, icon: FileText },
        ].map((k) => (
          <div className="d26-card d26-kpi" key={k.label}>
            <k.icon size={18} />
            <b>{k.value}</b>
            <span>{k.label}</span>
          </div>
        ))}
      </div>

      <div className="d26-bento">
        <section className="d26-card d26-span-2 d26-timeline">
          <div className="d26-card-head">
            <h3>
              {isToday
                ? "Heute auf dem Platz"
                : `Als Nächstes · ${formatDate(focusDay.toISOString(), { weekday: "long", day: "numeric", month: "long" })}`}
            </h3>
            <Link href="/admin/trainingsplanung">
              Planung <ChevronRight size={15} />
            </Link>
          </div>
          {focus.length ? (
            <ol>
              {focus.map((e: Training) => {
                const past = Date.parse(e.ends_at) < Date.now();
                const running = Date.parse(e.starts_at) <= Date.now() && !past;
                return (
                  <li
                    key={e.id}
                    className={running ? "is-live" : past ? "is-past" : ""}
                  >
                    <time>{formatTime(e.starts_at)}</time>
                    <div>
                      <b>{e.title}</b>
                      <small>
                        <MapPin size={13} /> {e.location_name}
                        {e.trainer_name ? ` · ${e.trainer_name}` : ""}
                      </small>
                      <span className="d26-avatars">
                        {e.participants.slice(0, 5).map((p) => (
                          <i key={p.id} title={playerName(p.player_id)}>
                            {playerName(p.player_id).charAt(0)}
                          </i>
                        ))}
                        <em>
                          {e.participants.length}{" "}
                          {e.participants.length === 1
                            ? "Teilnehmer"
                            : "Teilnehmer"}
                        </em>
                      </span>
                    </div>
                    {running && (
                      <span className="d26-pill tone-lime">Läuft</span>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="d26-empty">
              Keine Trainings in den nächsten 14 Tagen.
            </p>
          )}
        </section>

        <section className="d26-card d26-weekchart">
          <div className="d26-card-head">
            <h3>Diese Woche</h3>
            <span>{weekTotal} Trainings</span>
          </div>
          <div className="d26-bars">
            {week.map(({ d, count }) => (
              <div
                key={d.toISOString()}
                className={d.getTime() === today.getTime() ? "is-today" : ""}
              >
                <i style={{ height: `${(count / maxWeek) * 100}%` }}>
                  {count > 0 && <em>{count}</em>}
                </i>
                <small>
                  {d.toLocaleDateString("de-DE", { weekday: "narrow" })}
                </small>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="d26-list-section">
        <div className="d26-section-head">
          <h2>Schnellzugriff</h2>
        </div>
        <div className="d26-actions">
          {actions.map((a) => (
            <Link key={a.href} href={a.href} className="d26-action">
              <span className={`d26-app-icon tone-${a.tone}`}>
                <a.icon size={22} />
              </span>
              <span>{a.title}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="d26-list-section">
        <div className="d26-section-head">
          <h2>Posteingang</h2>
          <span>Abos, Zahlungen und Zuordnungen</span>
        </div>
        <div className="d26-inbox">
          <SubscriptionReviews includeActivities />
        </div>
      </section>
    </div>
  );
}
