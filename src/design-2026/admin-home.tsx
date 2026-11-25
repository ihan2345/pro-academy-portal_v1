"use client";
// Design 2026: neue Admin-Startseite ("Zentrale").
// Liest nur die Portaldaten, die die Admin-Übersicht schon bekommt, und bindet
// den bestehenden Stripe-/Abo-Posteingang unverändert ein.
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
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
import { DisclosureAsChip } from "@/components/dashboard-disclosure";
import { TrialDashboard } from "@/components/trials/team";
import { useMounted } from "./parent-experience";
import { NewestPlayersTile } from "./newest-players";
import { json, useEverything } from "./people-heads";
import type { ArchivePage, ArchivePlayer } from "@/lib/player-archive";
import { playerKinds } from "@/lib/player-kinds";
import { TeamKindSwitch, useTeamKind } from "./team-kind-switch";

function dayStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function AdminHome({ data }: { data: PortalData }) {
  const mounted = useMounted();
  if (!mounted) return <div className="d26-experience" aria-busy="true" />;
  return <AdminHomeView data={data} />;
}

type AdminSheet =
  | { kind: "players" | "week" | "open" | "field" }
  | { kind: "day"; day: Date }
  | { kind: "event"; event: Training }
  | null;
type Range = "focus" | "tomorrow" | "week";

function AdminHomeView({ data }: { data: PortalData }) {
  const [sheet, setSheet] = useState<AdminSheet>(null);
  const [range, setRange] = useState<Range>("focus");
  const [split, setSplit] = useTeamKind();
  // Gleicher Schlüssel wie „Neueste Spieler“ und das Archiv: teilt den Cache.
  const archive = useEverything<ArchivePlayer>(
    "archive:0",
    async (signal) =>
      ((await json("/api/player-archive", signal)) as ArchivePage).rows,
  );
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
  const byKind = archive.rows
    ? playerKinds(
        data.players.map((p) => p.id),
        archive.rows,
      )
    : null;
  const seats14 = in14.reduce((s, e) => s + e.participants.length, 0);
  const playerName = (id: string) => {
    const p =
      data.players.find((x) => x.id === id) ??
      data.trial_players?.find((x) => x.id === id);
    return p ? `${p.first_name} ${p.last_name.charAt(0)}.` : "";
  };
  const isToday = focusDay.getTime() === today.getTime();
  const fieldTitle =
    range === "week"
      ? "Nächste 7 Tage"
      : range === "tomorrow"
        ? "Morgen auf dem Platz"
        : isToday
          ? "Heute auf dem Platz"
          : `Als Nächstes · ${formatDate(focusDay.toISOString(), { weekday: "long", day: "numeric", month: "long" })}`;
  // Kurzer Text für die Kachel (der lange fieldTitle bleibt Titel im Sheet).
  const shortDay = (d: Date | string) =>
    formatDate(typeof d === "string" ? d : d.toISOString(), {
      weekday: "short",
      day: "numeric",
      month: "numeric",
    });
  const trainingWord = (n: number) => (n === 1 ? "Training" : "Trainings");
  const fieldLabel =
    range === "week"
      ? `${trainingWord(shown.length)} in 7 Tagen`
      : range === "tomorrow"
        ? `${trainingWord(shown.length)} morgen`
        : isToday
          ? `${trainingWord(shown.length)} heute`
          : shown.length
            ? `Nächstes · ${shortDay(focusDay)}`
            : "Keins in 14 Tagen";
  const fieldSeats = shown.reduce((s, e) => s + e.participants.length, 0);
  const fieldTip = `${fieldTitle}: ${shown.length} ${trainingWord(shown.length)}, ${fieldSeats} Teilnehmer. Tippen für alle Termine mit Ort, Trainer und Teilnehmern.`;
  const nextUp = shown.find((e) => Date.parse(e.ends_at) >= Date.now());
  const nextLive = !!nextUp && Date.parse(nextUp.starts_at) <= Date.now();
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
  // Lese-Rolle: keine Schnellaktionen zu Einstellungen, Stripe, Einladungen, Planung.
  const shownActions = data.read_only
    ? actions.filter(
        (a) =>
          ![
            "/admin/einstellungen",
            "/admin/stripe",
            "/admin/einladungen",
            "/admin/trainingsplanung",
          ].includes(a.href),
      )
    : actions;
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
        <div className="d26-card d26-kpi d26-onfield">
          <div className="d26-onfield-head">
            <CalendarClock size={18} />
            <div className="d26-segments is-small" role="tablist">
              {(
                [
                  isToday
                    ? (["focus", "Heute", "Heute"] as const)
                    : (["focus", "Nächstes", "Nächst."] as const),
                  ["tomorrow", "Morgen", "Morgen"],
                  ["week", "7 Tage", "7 T"],
                ] as const
              ).map(([v, label, short]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={range === v}
                  aria-label={label}
                  className={range === v ? "is-active" : ""}
                  onClick={() => setRange(v)}
                >
                  <span className="is-long">{label}</span>
                  <span className="is-short">{short}</span>
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="d26-onfield-main"
            data-tip={fieldTip}
            aria-label={fieldTip}
            onClick={() => setSheet({ kind: "field" })}
          >
            <b>
              <CountUp value={shown.length} />
            </b>
            <span>
              {fieldLabel} <ChevronRight size={13} />
            </span>
          </button>
          <p className={`d26-onfield-next ${nextLive ? "is-live" : ""}`}>
            {nextUp ? (
              <>
                <i aria-hidden="true" />
                <time>
                  {nextLive
                    ? "Läuft"
                    : range === "week" || (range === "focus" && !isToday)
                      ? `${formatDate(nextUp.starts_at, { weekday: "short" })} ${formatTime(nextUp.starts_at)}`
                      : formatTime(nextUp.starts_at)}
                </time>
                <em>{nextUp.location_name || nextUp.title}</em>
                <small>{nextUp.participants.length} TN</small>
              </>
            ) : (
              <em>
                {shown.length ? "Alles gelaufen" : "Kein Training geplant"}
              </em>
            )}
          </p>
        </div>
      </div>

      {/* Posteingang: früher Aufklapp-Menüs ganz unten, jetzt Kacheln oben. */}
      <section className="d26-inbox-row" aria-label="Posteingang">
        <div className="d26-section-head">
          <h2>
            <Inbox size={18} aria-hidden="true" /> Posteingang
          </h2>
          <span>Probetraining, Abos, Zahlungen und Zuordnungen</span>
        </div>
        <div className="d26-kpis d26-inbox-chips">
          <DisclosureAsChip.Provider value>
            {data.trial_enabled && <TrialDashboard base="/admin" chip />}
            <SubscriptionReviews includeActivities />
          </DisclosureAsChip.Provider>
        </div>
      </section>

      <div className="d26-bento">
        <NewestPlayersTile />

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
          {shownActions.map((a) => (
            <Link key={a.href} href={a.href} className="d26-action">
              <span className={`d26-app-icon tone-${a.tone}`}>
                <a.icon size={22} />
              </span>
              <span>{a.title}</span>
            </Link>
          ))}
        </div>
      </section>

      <Sheet
        open={sheet?.kind === "field"}
        onClose={() => setSheet(null)}
        eyebrow={`${shown.length} ${shown.length === 1 ? "Training" : "Trainings"}`}
        title={fieldTitle}
        footer={
          <Link href="/admin/trainingsplanung" className="d26-btn is-primary">
            Zur Planung <ArrowRight size={16} />
          </Link>
        }
      >
        <div className="d26-timeline d26-onfield-list">
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
        </div>
      </Sheet>
      <Sheet
        open={sheet?.kind === "players"}
        onClose={() => setSheet(null)}
        eyebrow={`${data.players.length} Spieler`}
        title={split === "team" ? "Nach Team" : "Nach Art"}
        footer={
          <Link href="/admin/spieler" className="d26-btn is-primary">
            Alle Familien <ArrowRight size={16} />
          </Link>
        }
      >
        <TeamKindSwitch value={split} onChange={setSplit} />
        {split === "team" ? (
          <BreakdownBars
            rows={byTeam.map(([label, value]) => ({
              label,
              value,
              tone: "purple",
            }))}
          />
        ) : byKind ? (
          <BreakdownBars rows={byKind} />
        ) : archive.failed ? (
          <p className="d26-empty">
            Die Aufschlüsselung nach Art konnte nicht geladen werden.
          </p>
        ) : (
          <p className="d26-empty">Wird geladen …</p>
        )}
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
