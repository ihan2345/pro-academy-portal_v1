"use client";
// Design 2026: neue Admin-Startseite ("Zentrale").
// Liest nur die Portaldaten, die die Admin-Übersicht schon bekommt, und bindet
// den bestehenden Stripe-/Abo-Posteingang unverändert ein.
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
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
  UserRound,
  Users,
} from "lucide-react";
import { BreakdownBars, CountUp, Sheet, glowFollow } from "./ui";
import type { PortalData, Training } from "@/lib/types";
import { STATUS_LABELS, formatDate, formatTime } from "@/lib/domain";
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

type AdminSheet =
  | { kind: "players" | "week" | "open" | "reports" }
  | { kind: "day"; day: Date }
  | { kind: "event"; event: Training }
  | null;
type Range = "focus" | "tomorrow" | "week";

function AdminHomeView({ data }: { data: PortalData }) {
  const [sheet, setSheet] = useState<AdminSheet>(null);
  const [range, setRange] = useState<Range>("focus");
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
  const openEvents = active
    .filter(
      (e) =>
        Date.parse(e.ends_at) < Date.now() &&
        e.participants.some((p) => p.status === "planned"),
    )
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const openAttendance = openEvents.length;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const shown =
    range === "focus"
      ? focus
      : range === "tomorrow"
        ? onDay(tomorrow)
        : active
            .filter(
              (e) =>
                Date.parse(e.starts_at) >= today.getTime() &&
                Date.parse(e.starts_at) < weekEnd.getTime(),
            )
            .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const in14 = active.filter(
    (e) =>
      Date.parse(e.starts_at) >= today.getTime() &&
      Date.parse(e.starts_at) < today.getTime() + 14 * 86400000,
  );
  const tally = (values: (string | undefined)[]) => {
    const m = new Map<string, number>();
    for (const v of values)
      m.set(v || "Ohne Angabe", (m.get(v || "Ohne Angabe") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const byLocation = tally(in14.map((e) => e.location_name));
  const byCoach = tally(in14.map((e) => e.trainer_name));
  const byTeam = tally(data.players.map((p) => p.team ?? undefined));
  const seats14 = in14.reduce((s, e) => s + e.participants.length, 0);
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
  const daySheet =
    sheet?.kind === "day" ? onDay(sheet.day) : ([] as Training[]);
  const kpis = [
    {
      key: "players" as const,
      label: "Spieler gesamt",
      value: data.players.length,
      icon: Users,
      tip: "Alle Spielerprofile, auch ohne aktives Abo. Spielerprofile zeigt nur Spieler mit aktivem Abo.",
    },
    {
      key: "week" as const,
      label: "Diese Woche",
      value: weekTotal,
      icon: CalendarDays,
      tip: "Trainings Montag bis Sonntag",
    },
    {
      key: "open" as const,
      label: "Offen zu bestätigen",
      value: openAttendance,
      icon: Inbox,
      tip: "Vergangene Termine mit geplanten Teilnehmern",
    },
    {
      key: "reports" as const,
      label: "Berichte",
      value: data.reports.length,
      icon: FileText,
      tip: "Erstellte Trainingsreports",
    },
  ];
  const EventLine = ({ e }: { e: Training }) => (
    <button
      type="button"
      className="d26-mini-event tone-purple"
      onClick={() => setSheet({ kind: "event", event: e })}
    >
      <span className="d26-mini-index">{formatTime(e.starts_at)}</span>
      <span>
        <b>{e.title}</b>
        <small>
          {formatDate(e.starts_at, {
            weekday: "short",
            day: "numeric",
            month: "short",
          })}{" "}
          · {e.location_name}
          {e.trainer_name ? ` · ${e.trainer_name}` : ""}
        </small>
      </span>
      <span className="d26-pill">{e.participants.length} TN</span>
    </button>
  );
  return (
    <div className="d26-experience" onPointerMove={glowFollow}>
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
        {kpis.map((k) => (
          <button
            type="button"
            className={`d26-card d26-kpi is-tappable ${k.key === "open" && k.value ? "is-alert" : ""}`}
            key={k.label}
            data-tip={k.tip}
            onClick={() => setSheet({ kind: k.key })}
          >
            <k.icon size={18} />
            <b>
              <CountUp value={k.value} />
            </b>
            <span>
              {k.label} <ChevronRight size={13} />
            </span>
          </button>
        ))}
      </div>

      <div className="d26-bento">
        <section className="d26-card d26-span-2 d26-timeline">
          <div className="d26-card-head">
            <h3>
              {range === "week"
                ? "Nächste 7 Tage"
                : range === "tomorrow"
                  ? "Morgen auf dem Platz"
                  : isToday
                    ? "Heute auf dem Platz"
                    : `Als Nächstes · ${formatDate(focusDay.toISOString(), { weekday: "long", day: "numeric", month: "long" })}`}
            </h3>
            <div className="d26-segments is-small" role="tablist">
              {(
                [
                  ["focus", "Heute"],
                  ["tomorrow", "Morgen"],
                  ["week", "7 Tage"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={range === v}
                  className={range === v ? "is-active" : ""}
                  onClick={() => setRange(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {shown.length ? (
            <ol key={range}>
              {shown.map((e: Training) => {
                const past = Date.parse(e.ends_at) < Date.now();
                const running = Date.parse(e.starts_at) <= Date.now() && !past;
                return (
                  <li
                    key={e.id}
                    className={running ? "is-live" : past ? "is-past" : ""}
                  >
                    <button
                      type="button"
                      onClick={() => setSheet({ kind: "event", event: e })}
                    >
                      <time>
                        {formatTime(e.starts_at)}
                        {range === "week" && (
                          <small>
                            {formatDate(e.starts_at, {
                              weekday: "short",
                              day: "numeric",
                            })}
                          </small>
                        )}
                      </time>
                      <div>
                        <b>{e.title}</b>
                        <small>
                          <MapPin size={13} /> {e.location_name}
                          {e.trainer_name ? ` · ${e.trainer_name}` : ""}
                        </small>
                        <span className="d26-avatars">
                          {e.participants.slice(0, 5).map((p) => (
                            <i key={p.id} data-tip={playerName(p.player_id)}>
                              {playerName(p.player_id).charAt(0)}
                            </i>
                          ))}
                          <em>{e.participants.length} Teilnehmer</em>
                        </span>
                      </div>
                      {running ? (
                        <span className="d26-pill tone-lime">Läuft</span>
                      ) : (
                        <ChevronRight size={16} className="d26-chevron" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="d26-empty">
              {range === "tomorrow"
                ? "Morgen ist kein Training geplant."
                : "Keine Trainings in diesem Zeitraum."}
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
              <button
                type="button"
                key={d.toISOString()}
                disabled={!count}
                data-tip={`${d.toLocaleDateString("de-DE", { weekday: "long" })}: ${count} ${count === 1 ? "Training" : "Trainings"}`}
                className={d.getTime() === today.getTime() ? "is-today" : ""}
                onClick={() => setSheet({ kind: "day", day: d })}
              >
                <i style={{ height: `${(count / maxWeek) * 100}%` }}>
                  {count > 0 && <em>{count}</em>}
                </i>
                <small>
                  {d.toLocaleDateString("de-DE", { weekday: "narrow" })}
                </small>
              </button>
            ))}
          </div>
        </section>

        <section className="d26-card d26-util">
          <div className="d26-card-head">
            <h3>Auslastung</h3>
            <span>14 Tage</span>
          </div>
          <BreakdownBars
            rows={byLocation.map(([label, value]) => ({
              label,
              value,
              tone: "purple",
              hint: `${value} Trainings in ${label}`,
            }))}
          />
          <p>{seats14} gebuchte Plätze insgesamt</p>
        </section>
        <section className="d26-card d26-util">
          <div className="d26-card-head">
            <h3>Coaches</h3>
            <span>14 Tage</span>
          </div>
          <BreakdownBars
            rows={byCoach.map(([label, value]) => ({
              label,
              value,
              tone: "lime",
              hint: `${label}: ${value} Einheiten`,
            }))}
          />
          <p>Einheiten je Coach</p>
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

      <Sheet
        open={sheet?.kind === "players"}
        onClose={() => setSheet(null)}
        eyebrow={`${data.players.length} Spieler`}
        title="Nach Team"
        footer={
          <Link href="/admin/spieler" className="d26-btn is-primary">
            Alle Familien <ArrowRight size={16} />
          </Link>
        }
      >
        <BreakdownBars
          rows={byTeam.map(([label, value]) => ({
            label,
            value,
            tone: "purple",
          }))}
        />
      </Sheet>
      <Sheet
        open={sheet?.kind === "week"}
        onClose={() => setSheet(null)}
        eyebrow={`${weekTotal} Trainings`}
        title="Diese Woche"
        footer={
          <Link href="/admin/trainingsplanung" className="d26-btn is-primary">
            Zur Planung <ArrowRight size={16} />
          </Link>
        }
      >
        {week.map(({ d, count }) => (
          <div key={d.toISOString()} className="d26-sheet-group">
            <h4>
              {d.toLocaleDateString("de-DE", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
              <span>{count}</span>
            </h4>
            <div className="d26-mini-list">
              {onDay(d).map((e) => (
                <EventLine key={e.id} e={e} />
              ))}
            </div>
          </div>
        ))}
      </Sheet>
      <Sheet
        open={sheet?.kind === "open"}
        onClose={() => setSheet(null)}
        eyebrow="Anwesenheit"
        title="Offen zu bestätigen"
        footer={
          <Link href="/admin/trainingsplanung" className="d26-btn is-primary">
            In der Planung bestätigen <ArrowRight size={16} />
          </Link>
        }
      >
        <div className="d26-mini-list">
          {openEvents.length ? (
            openEvents.map((e) => <EventLine key={e.id} e={e} />)
          ) : (
            <p className="d26-empty">Alles bestätigt.</p>
          )}
        </div>
      </Sheet>
      <Sheet
        open={sheet?.kind === "reports"}
        onClose={() => setSheet(null)}
        eyebrow={`${data.reports.length} Berichte`}
        title="Trainingsreports"
      >
        <div className="d26-mini-list">
          {data.reports.map((r) => (
            <a
              key={r.id}
              className="d26-mini-event tone-lime"
              href={`/api/reports/${r.id}`}
              target="_blank"
              rel="noreferrer"
            >
              <span className="d26-mini-index">
                <FileText size={16} />
              </span>
              <span>
                <b>
                  {playerName(r.player_id) || "Spieler"} · {r.period_label}
                </b>
                <small>
                  {r.product_name} · {r.completed} von {r.units} Einheiten ·
                  Version {r.version}
                </small>
              </span>
              <span className="d26-pill">PDF</span>
            </a>
          ))}
        </div>
      </Sheet>
      <Sheet
        open={sheet?.kind === "day" && daySheet.length > 0}
        onClose={() => setSheet(null)}
        eyebrow={`${daySheet.length} Trainings`}
        title={
          sheet?.kind === "day"
            ? sheet.day.toLocaleDateString("de-DE", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : ""
        }
      >
        <div className="d26-mini-list">
          {daySheet.map((e) => (
            <EventLine key={e.id} e={e} />
          ))}
        </div>
      </Sheet>
      <Sheet
        open={sheet?.kind === "event"}
        onClose={() => setSheet(null)}
        eyebrow={
          sheet?.kind === "event"
            ? `${formatDate(sheet.event.starts_at, { weekday: "long", day: "numeric", month: "long" })} · ${formatTime(sheet.event.starts_at)}–${formatTime(sheet.event.ends_at)}`
            : ""
        }
        title={sheet?.kind === "event" ? sheet.event.title : ""}
        footer={
          <Link href="/admin/trainingsplanung" className="d26-btn is-primary">
            In der Planung öffnen <ArrowRight size={16} />
          </Link>
        }
      >
        {sheet?.kind === "event" && (
          <>
            <dl className="d26-facts">
              <div>
                <dt>Ort</dt>
                <dd>{sheet.event.location_name}</dd>
              </div>
              <div>
                <dt>Coach</dt>
                <dd>{sheet.event.trainer_name || "Offen"}</dd>
              </div>
              <div>
                <dt>Teilnehmer</dt>
                <dd>{sheet.event.participants.length}</dd>
              </div>
            </dl>
            <h4>Teilnehmer</h4>
            <ul className="d26-people">
              {sheet.event.participants.map((p) => (
                <li key={p.id}>
                  <i>
                    <UserRound size={14} />
                  </i>
                  <b>{playerName(p.player_id) || "Spieler"}</b>
                  <span
                    className={`d26-pill tone-${p.status === "planned" ? "purple" : ["absent", "cancelled"].includes(p.status) ? "red" : p.status === "excused" ? "amber" : "lime"}`}
                  >
                    {STATUS_LABELS[p.status]}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Sheet>
    </div>
  );
}
