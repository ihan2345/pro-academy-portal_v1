"use client";
// Design 2026: neue Elternansichten "Heute", "Kalender" und "Fortschritt".
// Nutzt ausschließlich die Daten und Aktionen, die das Portal schon hat
// (Kind wählen, Zeitraum wählen, Termindetails öffnen, Berichte als PDF).
// Neu sind nur Darstellung, Sortierung, Filter und Suche im Browser.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Flame,
  LayoutGrid,
  List,
  MapPin,
  Navigation,
  Percent,
  Search,
  Sparkles,
  Timer,
  TrendingUp,
  UserRound,
  Zap,
} from "lucide-react";
import { BreakdownBars, CountUp, Countdown, Sheet, glowFollow } from "./ui";
import type { Period, PortalData, Report, Training } from "@/lib/types";
import {
  STATUS_LABELS,
  durationLabel,
  formatDate,
  formatTime,
  isAttended,
  isChargedAbsence,
  periodLabel,
  type Attendance,
} from "@/lib/domain";

type Stats = {
  completed: number;
  planned: number;
  minutes: number;
  charged?: number;
  neutral?: number;
};

export type ParentExperienceProps = {
  section: string;
  data: PortalData;
  playerId: string;
  selectPlayer: (id: string) => void;
  periods: Period[];
  period?: Period;
  selectPeriod: (id: string) => void;
  stats: Stats;
  events: Training[];
  upcoming: Training[];
  reports: Report[];
  openDetail: (event: Training) => void;
  stampCard: React.ReactNode;
};

const statusTone: Record<Attendance, string> = {
  planned: "purple",
  attended_auto: "lime",
  attended_manual: "lime",
  absent: "red",
  excused: "amber",
  cancelled: "red",
};
const subscriptionLabel: Record<string, string> = {
  active: "Aktiv",
  trialing: "Testphase",
  past_due: "Zahlung offen",
  canceled: "Gekündigt",
  unpaid: "Nicht bezahlt",
  incomplete: "Unvollständig",
  paused: "Pausiert",
};

function dayKey(iso: string) {
  return formatDate(iso, { year: "numeric", month: "2-digit", day: "2-digit" });
}
function relativeDay(iso: string, now = new Date()) {
  const start = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(new Date(iso)) - start(now)) / 86400000);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  if (diff === 2) return "Übermorgen";
  if (diff === -1) return "Gestern";
  if (diff > 2 && diff < 7) return `In ${diff} Tagen`;
  return formatDate(iso, { weekday: "long" });
}
function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 11) return "Guten Morgen";
  if (h < 18) return "Hallo";
  return "Guten Abend";
}
function statusOf(event: Training, playerId: string): Attendance {
  return (
    event.participants.find((p) => p.player_id === playerId)?.status ??
    "planned"
  );
}
function icsFor(event: Training) {
  const stamp = (iso: string) =>
    new Date(iso)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const text = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ProAcademy//Portal//DE",
    "BEGIN:VEVENT",
    `UID:${event.id}@proacademy`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(event.starts_at)}`,
    `DTEND:${stamp(event.ends_at)}`,
    `SUMMARY:ProAcademy · ${event.title}`,
    `LOCATION:${[event.location_name, event.address].filter(Boolean).join(", ")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
}

function weekStart(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function mode(values: (string | undefined)[]) {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
type Bucket = "planned" | "done" | "missed";
function bucketOf(event: Training, playerId: string): Bucket {
  const s = statusOf(event, playerId);
  if (
    event.status === "cancelled" ||
    ["absent", "excused", "cancelled"].includes(s)
  )
    return "missed";
  return isAttended(s) ? "done" : "planned";
}
const bucketTone: Record<Bucket, string> = {
  planned: "purple",
  done: "lime",
  missed: "red",
};

/** Kennzahlen, die nur aus den vorhandenen Terminen im Browser berechnet werden. */
function insightsFor(events: Training[], playerId: string) {
  const now = Date.now();
  const attended = events
    .filter((e) => isAttended(statusOf(e, playerId)))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = events.filter(
    (e) => Date.parse(e.ends_at) < now && e.status !== "cancelled",
  );
  const missed = past.filter((e) =>
    ["absent", "excused"].includes(statusOf(e, playerId)),
  ).length;
  const weeks = new Set(
    attended.map((e) => weekStart(new Date(e.starts_at)).getTime()),
  );
  let streak = 0;
  const cursor = weekStart(new Date());
  if (!weeks.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 7);
  while (weeks.has(cursor.getTime())) {
    streak++;
    cursor.setDate(cursor.getDate() - 7);
  }
  const first = attended[0] ? Date.parse(attended[0].starts_at) : now;
  const spanWeeks = Math.max(1, Math.ceil((now - first) / (7 * 86400000)));
  const lastWeeks = Array.from({ length: 8 }, (_, i) => {
    const d = weekStart(new Date());
    d.setDate(d.getDate() - (7 - i) * 7);
    const count = attended.filter(
      (e) => weekStart(new Date(e.starts_at)).getTime() === d.getTime(),
    ).length;
    return { d, count };
  });
  return {
    attended,
    streak,
    perWeek: attended.length / spanWeeks,
    rate:
      attended.length + missed
        ? attended.length / (attended.length + missed)
        : 0,
    locations: mode(attended.map((e) => e.location_name)),
    coaches: mode(attended.map((e) => e.trainer_name)),
    lastWeeks,
  };
}

/* ---------- Bausteine ---------- */

function Ring({
  value,
  max,
  color,
  size = 132,
  stroke = 14,
  inset = 0,
}: {
  value: number;
  max: number;
  color: string;
  size?: number;
  stroke?: number;
  inset?: number;
}) {
  const r = (size - stroke) / 2 - inset;
  const c = 2 * Math.PI * r;
  const share = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <g>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeOpacity={0.16}
        strokeWidth={stroke}
      />
      <circle
        className="d26-ring-arc"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${c * share} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </g>
  );
}

function ProgressRings({
  period,
  stats,
  compact,
}: {
  period?: Period;
  stats: Stats;
  compact?: boolean;
}) {
  const included = period?.included_units ?? 0;
  const open = Math.max(included - stats.completed, 0);
  const total = period
    ? Math.max(
        1,
        Math.round(
          (Date.parse(period.ends_at) - Date.parse(period.starts_at)) /
            86400000,
        ),
      )
    : 1;
  const elapsed = period
    ? Math.min(
        total,
        Math.max(
          0,
          Math.round((Date.now() - Date.parse(period.starts_at)) / 86400000),
        ),
      )
    : 0;
  const size = compact ? 116 : 150;
  const rings = [
    {
      label: "Einheiten",
      value: stats.completed,
      max: included,
      text: `${stats.completed} von ${included}`,
      color: "#8eff01",
    },
    {
      label: "Eingeplant",
      value: Math.min(stats.planned, open),
      max: open || 1,
      text: open
        ? `${Math.min(stats.planned, open)} von ${open} offenen`
        : "Alles erledigt",
      color: "#8b53fe",
    },
    {
      label: "Zeitraum",
      value: elapsed,
      max: total,
      text: `Tag ${elapsed} von ${total}`,
      color: "#22c3ff",
    },
  ];
  return (
    <div className={`d26-rings ${compact ? "is-compact" : ""}`}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        {rings.map((ring, i) => (
          <Ring
            key={ring.label}
            value={ring.value}
            max={ring.max}
            color={ring.color}
            size={size}
            stroke={compact ? 12 : 15}
            inset={i * (compact ? 14 : 18)}
          />
        ))}
      </svg>
      <ul>
        {rings.map((ring) => (
          <li key={ring.label}>
            <i style={{ background: ring.color }} />
            <span>{ring.label}</span>
            <b>{ring.text}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChildSwitch({
  data,
  playerId,
  selectPlayer,
}: Pick<ParentExperienceProps, "data" | "playerId" | "selectPlayer">) {
  if (data.players.length < 2) {
    const p = data.players[0];
    return p ? (
      <div className="d26-children" aria-label="Dein Kind">
        <span className="d26-child is-active">
          <i>{p.first_name.charAt(0)}</i>
          {p.first_name}
        </span>
      </div>
    ) : null;
  }
  return (
    <div className="d26-children" role="tablist" aria-label="Kind auswählen">
      {data.players.map((p) => (
        <button
          key={p.id}
          type="button"
          role="tab"
          aria-selected={p.id === playerId}
          className={`d26-child ${p.id === playerId ? "is-active" : ""}`}
          onClick={() => selectPlayer(p.id)}
        >
          <i>{p.first_name.charAt(0)}</i>
          {p.first_name}
        </button>
      ))}
    </div>
  );
}

function LargeTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="d26-large-title">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {children}
    </header>
  );
}

function EventRow({
  event,
  playerId,
  open,
}: {
  event: Training;
  playerId: string;
  open: (e: Training) => void;
}) {
  const status = statusOf(event, playerId);
  return (
    <button
      type="button"
      className={`d26-row tone-${event.status === "cancelled" ? "red" : statusTone[status]}`}
      onClick={() => open(event)}
    >
      <span className="d26-row-time">
        <b>{formatTime(event.starts_at)}</b>
        <small>{formatTime(event.ends_at)}</small>
      </span>
      <span className="d26-row-main">
        <b>{event.title}</b>
        <small>
          {event.location_name}
          {event.trainer_name ? ` · ${event.trainer_name}` : ""}
        </small>
      </span>
      <span className="d26-pill">
        {event.status === "cancelled"
          ? "Termin abgesagt"
          : STATUS_LABELS[status]}
      </span>
      <ChevronRight size={18} className="d26-chevron" />
    </button>
  );
}

/* ---------- Heute ---------- */

type TodaySheet = "rings" | "plan" | "insights" | null;

function MiniEvent({
  event,
  playerId,
  index,
  onOpen,
}: {
  event: Training;
  playerId: string;
  index?: number;
  onOpen: (e: Training) => void;
}) {
  const bucket = bucketOf(event, playerId);
  return (
    <button
      type="button"
      className={`d26-mini-event tone-${bucketTone[bucket]}`}
      onClick={() => onOpen(event)}
    >
      <span className="d26-mini-index">
        {index !== undefined ? index : formatTime(event.starts_at)}
      </span>
      <span>
        <b>{event.title}</b>
        <small>
          {formatDate(event.starts_at, {
            weekday: "short",
            day: "numeric",
            month: "short",
          })}{" "}
          · {formatTime(event.starts_at)} · {event.location_name}
        </small>
      </span>
      <span className="d26-pill">
        {event.status === "cancelled"
          ? "Termin abgesagt"
          : STATUS_LABELS[statusOf(event, playerId)]}
      </span>
    </button>
  );
}

function WeekSpark({ weeks }: { weeks: { d: Date; count: number }[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.count));
  return (
    <div className="d26-spark">
      {weeks.map(({ d, count }) => (
        <span
          key={d.getTime()}
          data-tip={`KW ab ${formatDate(d.toISOString(), { day: "numeric", month: "short" })}: ${count} ${count === 1 ? "Einheit" : "Einheiten"}`}
        >
          <i style={{ height: `${Math.max(8, (count / max) * 100)}%` }} />
        </span>
      ))}
    </div>
  );
}

function Today(props: ParentExperienceProps) {
  const {
    data,
    period,
    stats,
    upcoming,
    events,
    reports,
    playerId,
    openDetail,
  } = props;
  const [sheet, setSheet] = useState<TodaySheet>(null);
  const next = upcoming[0];
  const recent = events
    .filter((e) => Date.parse(e.starts_at) < Date.now())
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    .slice(0, 3);
  const included = period?.included_units ?? 0;
  const player = data.players.find((p) => p.id === playerId);
  const status =
    subscriptionLabel[period?.subscription_status ?? period?.status ?? ""] ??
    "Offen";
  const periodShare = period
    ? Math.min(
        1,
        Math.max(
          0,
          (Date.now() - Date.parse(period.starts_at)) /
            (Date.parse(period.ends_at) - Date.parse(period.starts_at)),
        ),
      )
    : 0;
  const daysLeft = period
    ? Math.max(
        0,
        Math.ceil((Date.parse(period.ends_at) - Date.now()) / 86400000),
      )
    : 0;
  const inPeriod = events
    .filter((e) =>
      e.participants.some(
        (p) => p.player_id === playerId && p.period_id === period?.id,
      ),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const counted = inPeriod.filter((e) => isAttended(statusOf(e, playerId)));
  const plannedIn = inPeriod.filter(
    (e) =>
      statusOf(e, playerId) === "planned" &&
      e.status !== "cancelled" &&
      Date.parse(e.starts_at) > Date.now(),
  );
  const insight = insightsFor(events, playerId);
  const openFromSheet = (e: Training) => {
    setSheet(null);
    openDetail(e);
  };
  const firstName = player?.first_name ?? "Dein Kind";
  return (
    <>
      <LargeTitle
        eyebrow={formatDate(new Date().toISOString(), {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
        title="Heute"
      >
        <ChildSwitch {...props} />
      </LargeTitle>
      <p className="d26-greeting">
        {greeting()}, {data.user_name}.{" "}
        {next
          ? `${firstName} trainiert ${relativeDay(next.starts_at).toLowerCase()}.`
          : "Gerade ist kein Training geplant."}
      </p>

      <div className="d26-bento">
        <section className="d26-hero d26-span-2">
          <div className="d26-hero-top">
            <span className="d26-live">
              <i /> Nächstes Training
            </span>
            {next && <span>{relativeDay(next.starts_at)}</span>}
          </div>
          {next ? (
            <>
              <h2>
                {formatTime(next.starts_at)}
                <span> – {formatTime(next.ends_at)}</span>
              </h2>
              <p className="d26-hero-title">{next.title}</p>
              <Countdown to={next.starts_at} />
              <div className="d26-hero-meta">
                <span>
                  {formatDate(next.starts_at, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </span>
                <span data-tip={next.address || undefined}>
                  <MapPin size={15} /> {next.location_name}
                </span>
                {next.trainer_name && (
                  <span data-tip="Dein Coach für diese Einheit">
                    <UserRound size={15} /> {next.trainer_name}
                  </span>
                )}
              </div>
              <div className="d26-hero-actions">
                <button
                  type="button"
                  className="d26-btn is-primary"
                  onClick={() => openDetail(next)}
                >
                  Details <ArrowUpRight size={16} />
                </button>
                <button
                  type="button"
                  className="d26-btn"
                  data-tip="Als .ics für Apple, Google oder Outlook"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = icsFor(next);
                    a.download = `proacademy-${dayKey(next.starts_at).replace(/\./g, "-")}.ics`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                  }}
                >
                  <CalendarPlus size={16} /> In Kalender
                </button>
                {(next.address || next.location_name) && (
                  <a
                    className="d26-btn"
                    target="_blank"
                    rel="noreferrer"
                    data-tip="Öffnet Apple Karten"
                    href={`https://maps.apple.com/?q=${encodeURIComponent(
                      [next.location_name, next.address]
                        .filter(Boolean)
                        .join(", "),
                    )}`}
                  >
                    <Navigation size={16} /> Route
                  </a>
                )}
              </div>
            </>
          ) : (
            <>
              <h2 className="d26-hero-empty">
                Bereit für den nächsten Schritt.
              </h2>
              <p className="d26-hero-title">
                Sobald unser Team trainiert, erscheint es hier.
              </p>
            </>
          )}
        </section>

        <button
          type="button"
          className="d26-card d26-rings-card is-tappable"
          onClick={() => setSheet("rings")}
        >
          <div className="d26-card-head">
            <h3>Dein Zeitraum</h3>
            <span className="d26-more">
              Details <ChevronRight size={15} />
            </span>
          </div>
          <ProgressRings period={period} stats={stats} compact />
        </button>

        <button
          type="button"
          className="d26-card d26-plan is-tappable"
          onClick={() => setSheet("plan")}
        >
          <span className="d26-icon is-purple">
            <Zap size={18} fill="currentColor" />
          </span>
          <small>Trainingspaket</small>
          <h3>
            {period?.product_name ?? "Kein aktives Paket"}
            <span className="d26-pill tone-lime">{status}</span>
          </h3>
          <div
            className="d26-bar"
            data-tip={`${Math.round(periodShare * 100)} % des Zeitraums vorbei`}
          >
            <i style={{ width: `${periodShare * 100}%` }} />
          </div>
          <p>
            {period
              ? `${periodLabel(period.starts_at, period.ends_at)} · noch ${daysLeft} Tage`
              : "Noch nicht zugeordnet"}
          </p>
        </button>

        <Link href="/stempelkarte" className="d26-card d26-stamps-mini">
          <small>Stempelkarte</small>
          <h3>
            <CountUp value={stats.completed} />
            <span> / {included}</span>
          </h3>
          <div className="d26-dots">
            {Array.from({ length: Math.max(included, stats.completed) }).map(
              (_, i) => {
                const e = counted[i] ?? plannedIn[i - counted.length];
                return (
                  <i
                    key={i}
                    data-tip={
                      e
                        ? `${i < counted.length ? "Angerechnet" : "Eingeplant"}: ${formatDate(e.starts_at, { day: "numeric", month: "short" })} · ${e.title}`
                        : "Noch frei"
                    }
                    className={
                      i < stats.completed
                        ? "is-done"
                        : i < stats.completed + stats.planned
                          ? "is-planned"
                          : ""
                    }
                  />
                );
              },
            )}
          </div>
          <p>{durationLabel(stats.minutes)} Training</p>
        </Link>

        <Link href="/berichte" className="d26-card d26-report-mini">
          <span className="d26-icon is-lime">
            <FileText size={18} />
          </span>
          <small>Berichte</small>
          <h3>{reports[0]?.period_label ?? "Noch keiner"}</h3>
          <p>
            {reports.length
              ? `${reports.length} ${reports.length === 1 ? "Bericht" : "Berichte"} als PDF`
              : "Kommt nach deinem ersten Zeitraum."}
          </p>
        </Link>
      </div>

      <section className="d26-list-section">
        <div className="d26-section-head">
          <h2>Insights</h2>
          <button
            type="button"
            className="d26-link"
            onClick={() => setSheet("insights")}
          >
            Alle Statistiken <ArrowRight size={15} />
          </button>
        </div>
        <div className="d26-insights">
          <button
            type="button"
            className="d26-card d26-insight is-tappable tone-orange"
            data-tip="Wochen in Folge mit mindestens einem absolvierten Training"
            onClick={() => setSheet("insights")}
          >
            <Flame size={18} />
            <b>
              <CountUp value={insight.streak} />
            </b>
            <span>{insight.streak === 1 ? "Woche" : "Wochen"} Serie</span>
          </button>
          <button
            type="button"
            className="d26-card d26-insight is-tappable tone-blue"
            data-tip="Durchschnitt seit dem ersten Training"
            onClick={() => setSheet("insights")}
          >
            <TrendingUp size={18} />
            <b>{insight.perWeek.toFixed(1).replace(".", ",")}</b>
            <span>Trainings pro Woche</span>
          </button>
          <button
            type="button"
            className="d26-card d26-insight is-tappable tone-lime"
            data-tip="Absolviert im Verhältnis zu allen vergangenen Terminen"
            onClick={() => setSheet("insights")}
          >
            <Percent size={18} />
            <b>
              <CountUp value={Math.round(insight.rate * 100)} />
              <small>%</small>
            </b>
            <span>Anwesenheit</span>
          </button>
          <button
            type="button"
            className="d26-card d26-insight is-tappable tone-purple"
            data-tip={insight.locations[0]?.[0] ?? "Noch kein Ort"}
            onClick={() => setSheet("insights")}
          >
            <MapPin size={18} />
            <b className="is-text">{insight.locations[0]?.[0] ?? "–"}</b>
            <span>Lieblingsort</span>
          </button>
        </div>
      </section>

      <section className="d26-list-section">
        <div className="d26-section-head">
          <h2>Zuletzt auf dem Platz</h2>
          <Link href="/termine">
            Alle Termine <ArrowRight size={15} />
          </Link>
        </div>
        <div className="d26-list">
          {recent.length ? (
            recent.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                playerId={playerId}
                open={openDetail}
              />
            ))
          ) : (
            <p className="d26-empty">Hier erscheinen absolvierte Trainings.</p>
          )}
        </div>
      </section>

      <Sheet
        open={sheet === "rings"}
        onClose={() => setSheet(null)}
        eyebrow={
          period ? periodLabel(period.starts_at, period.ends_at) : undefined
        }
        title="Dein Zeitraum"
        footer={
          <Link href="/stempelkarte" className="d26-btn is-primary">
            Zur Stempelkarte <ArrowRight size={16} />
          </Link>
        }
      >
        <ProgressRings period={period} stats={stats} />
        <div className="d26-sheet-stats">
          <div>
            <b>{stats.completed}</b>
            <span>angerechnet</span>
          </div>
          <div>
            <b>{Math.max(included - stats.completed, 0)}</b>
            <span>noch offen</span>
          </div>
          <div>
            <b>{daysLeft}</b>
            <span>Tage übrig</span>
          </div>
        </div>
        <h4>Angerechnete Einheiten</h4>
        <div className="d26-mini-list">
          {counted.length ? (
            counted.map((e, i) => (
              <MiniEvent
                key={e.id}
                event={e}
                playerId={playerId}
                index={i + 1}
                onOpen={openFromSheet}
              />
            ))
          ) : (
            <p className="d26-empty">Noch keine Einheit angerechnet.</p>
          )}
        </div>
        <h4>Eingeplant</h4>
        <div className="d26-mini-list">
          {plannedIn.length ? (
            plannedIn.map((e) => (
              <MiniEvent
                key={e.id}
                event={e}
                playerId={playerId}
                onOpen={openFromSheet}
              />
            ))
          ) : (
            <p className="d26-empty">Gerade nichts eingeplant.</p>
          )}
        </div>
      </Sheet>

      <Sheet
        open={sheet === "plan"}
        onClose={() => setSheet(null)}
        eyebrow="Trainingspaket"
        title={period?.product_name ?? "Kein aktives Paket"}
        footer={
          <Link href="/konto" className="d26-btn is-primary">
            Konto & Abo verwalten <ArrowRight size={16} />
          </Link>
        }
      >
        <div className="d26-plan-hero">
          <span className="d26-pill tone-lime">{status}</span>
          <h3>
            {period
              ? periodLabel(period.starts_at, period.ends_at)
              : "Noch nicht zugeordnet"}
          </h3>
          <div className="d26-bar is-large">
            <i style={{ width: `${periodShare * 100}%` }} />
          </div>
          <p>
            {Math.round(periodShare * 100)} % vorbei · noch {daysLeft} Tage
          </p>
        </div>
        <dl className="d26-facts">
          <div>
            <dt>Enthaltene Einheiten</dt>
            <dd>{included}</dd>
          </div>
          <div>
            <dt>Angerechnet</dt>
            <dd>{stats.completed}</dd>
          </div>
          <div>
            <dt>Eingeplant</dt>
            <dd>{stats.planned}</dd>
          </div>
          <div>
            <dt>Trainingszeit</dt>
            <dd>{durationLabel(stats.minutes)}</dd>
          </div>
          {period && (
            <>
              <div>
                <dt>Beginn</dt>
                <dd>{formatDate(period.starts_at)}</dd>
              </div>
              <div>
                <dt>Ende</dt>
                <dd>{formatDate(period.ends_at)}</dd>
              </div>
            </>
          )}
        </dl>
      </Sheet>

      <Sheet
        open={sheet === "insights"}
        onClose={() => setSheet(null)}
        eyebrow={firstName}
        title="Statistiken"
      >
        <div className="d26-sheet-stats">
          <div>
            <b>{insight.attended.length}</b>
            <span>Trainings gesamt</span>
          </div>
          <div>
            <b>{insight.streak}</b>
            <span>Wochen Serie</span>
          </div>
          <div>
            <b>{Math.round(insight.rate * 100)} %</b>
            <span>Anwesenheit</span>
          </div>
        </div>
        <h4>Letzte 8 Wochen</h4>
        <WeekSpark weeks={insight.lastWeeks} />
        <h4>Nach Ort</h4>
        <BreakdownBars
          rows={insight.locations.map(([label, value]) => ({
            label,
            value,
            tone: "purple",
          }))}
        />
        <h4>Nach Coach</h4>
        <BreakdownBars
          rows={insight.coaches.map(([label, value]) => ({
            label,
            value,
            tone: "lime",
          }))}
        />
        <h4>Verlauf</h4>
        <div className="d26-mini-list">
          {[...insight.attended].reverse().map((e) => (
            <MiniEvent
              key={e.id}
              event={e}
              playerId={playerId}
              onOpen={openFromSheet}
            />
          ))}
        </div>
      </Sheet>
    </>
  );
}

/* ---------- Kalender ---------- */

function MonthGrid({
  events,
  playerId,
  monthOffset,
  setMonthOffset,
  bucket,
  onDay,
}: {
  events: Training[];
  playerId: string;
  monthOffset: number;
  setMonthOffset: (fn: (m: number) => number) => void;
  bucket: Bucket | "all";
  onDay: (key: string) => void;
}) {
  const base = new Date();
  const first = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const startGrid = weekStart(first);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(startGrid);
    d.setDate(d.getDate() + i);
    return d;
  });
  const byDay = new Map<string, Training[]>();
  for (const e of events) {
    if (bucket !== "all" && bucketOf(e, playerId) !== bucket) continue;
    const k = dayKey(e.starts_at);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const todayKey = dayKey(new Date().toISOString());
  const lastRowNeeded = cells[35].getMonth() === first.getMonth();
  return (
    <section className="d26-card d26-month">
      <div className="d26-card-head">
        <h3>
          {first.toLocaleDateString("de-DE", {
            month: "long",
            year: "numeric",
          })}
        </h3>
        <div className="d26-month-nav">
          <button
            type="button"
            className="d26-round"
            aria-label="Vorheriger Monat"
            onClick={() => setMonthOffset((m) => m - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="d26-chip"
            onClick={() => setMonthOffset(() => 0)}
          >
            Heute
          </button>
          <button
            type="button"
            className="d26-round"
            aria-label="Nächster Monat"
            onClick={() => setMonthOffset((m) => m + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="d26-month-grid" key={monthOffset}>
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((w) => (
          <small key={w}>{w}</small>
        ))}
        {cells.slice(0, lastRowNeeded ? 42 : 35).map((d) => {
          const k = dayKey(d.toISOString());
          const items = byDay.get(k) ?? [];
          const outside = d.getMonth() !== first.getMonth();
          return (
            <button
              type="button"
              key={k}
              disabled={!items.length}
              data-tip={
                items.length
                  ? items
                      .map((e) => `${formatTime(e.starts_at)} ${e.title}`)
                      .join(" · ")
                  : undefined
              }
              className={`${outside ? "is-outside" : ""} ${k === todayKey ? "is-today" : ""} ${items.length ? "has-events" : ""}`}
              onClick={() => onDay(k)}
            >
              <b>{d.getDate()}</b>
              <span>
                {items.slice(0, 3).map((e) => (
                  <i
                    key={e.id}
                    className={`tone-${bucketTone[bucketOf(e, playerId)]}`}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="d26-legend">
        <span>
          <i className="tone-purple" /> Geplant
        </span>
        <span>
          <i className="tone-lime" /> Absolviert
        </span>
        <span>
          <i className="tone-red" /> Abgesagt / gefehlt
        </span>
      </div>
    </section>
  );
}

function Calendar(props: ParentExperienceProps) {
  const { events, playerId, openDetail } = props;
  const [view, setView] = useState<"list" | "month">("list");
  const [filter, setFilter] = useState<"upcoming" | "past" | "all">("upcoming");
  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [query, setQuery] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [day, setDay] = useState<string | null>(null);
  const [sheetDay, setSheetDay] = useState<string | null>(null);
  const now = Date.now();
  const monday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weekOffset * 7);
    return d;
  }, [weekOffset]);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
  const titlesByDay = new Map<string, string[]>();
  for (const e of events) {
    const k = dayKey(e.starts_at);
    titlesByDay.set(k, [
      ...(titlesByDay.get(k) ?? []),
      `${formatTime(e.starts_at)} ${e.title}`,
    ]);
  }
  const q = query.trim().toLowerCase();
  const list = events
    .filter((e) =>
      day
        ? dayKey(e.starts_at) === day
        : filter === "all" ||
          (filter === "upcoming"
            ? Date.parse(e.ends_at) >= now
            : Date.parse(e.ends_at) < now),
    )
    .filter((e) => bucket === "all" || bucketOf(e, playerId) === bucket)
    .filter(
      (e) =>
        !q ||
        [e.title, e.location_name, e.trainer_name]
          .join(" ")
          .toLowerCase()
          .includes(q),
    )
    .sort((a, b) =>
      filter === "past" && !day
        ? b.starts_at.localeCompare(a.starts_at)
        : a.starts_at.localeCompare(b.starts_at),
    );
  const groups: [string, Training[]][] = [];
  for (const e of list) {
    const k = dayKey(e.starts_at);
    const last = groups[groups.length - 1];
    if (last && last[0] === k) last[1].push(e);
    else groups.push([k, [e]]);
  }
  const counts = {
    upcoming: events.filter((e) => Date.parse(e.ends_at) >= now).length,
    done: events.filter((e) => isAttended(statusOf(e, playerId))).length,
    charged: events.filter((e) => isChargedAbsence(statusOf(e, playerId)))
      .length,
  };
  const bucketCounts = {
    all: events.length,
    planned: events.filter((e) => bucketOf(e, playerId) === "planned").length,
    done: events.filter((e) => bucketOf(e, playerId) === "done").length,
    missed: events.filter((e) => bucketOf(e, playerId) === "missed").length,
  };
  const sheetItems = sheetDay
    ? events
        .filter((e) => dayKey(e.starts_at) === sheetDay)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    : [];
  return (
    <>
      <LargeTitle
        eyebrow={formatDate(monday.toISOString(), {
          month: "long",
          year: "numeric",
        })}
        title="Kalender"
      >
        <ChildSwitch {...props} />
      </LargeTitle>
      <div className="d26-summary">
        <span data-tip="Alle Termine ab jetzt">
          <b>{counts.upcoming}</b> anstehend
        </span>
        <span data-tip="Automatisch oder vom Coach bestätigt">
          <b>{counts.done}</b> absolviert
        </span>
        <span data-tip="Kurzfristig abgesagt oder nicht erschienen, zählt als Einheit">
          <b>{counts.charged}</b> angerechnet abgesagt
        </span>
      </div>
      <div className="d26-toolbar">
        <div className="d26-segments d26-view-switch" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            className={view === "list" ? "is-active" : ""}
            onClick={() => setView("list")}
          >
            <List size={15} /> Liste
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "month"}
            className={view === "month" ? "is-active" : ""}
            onClick={() => setView("month")}
          >
            <LayoutGrid size={15} /> Monat
          </button>
        </div>
        <div className="d26-chips d26-filter-chips" aria-label="Status">
          {(
            [
              ["all", "Alle"],
              ["planned", "Geplant"],
              ["done", "Absolviert"],
              ["missed", "Abgesagt"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`d26-chip ${v !== "all" ? `has-dot tone-${bucketTone[v]}` : ""} ${bucket === v ? "is-active" : ""}`}
              onClick={() => setBucket(v)}
            >
              {v !== "all" && <i />}
              {label}
              <em>{bucketCounts[v]}</em>
            </button>
          ))}
        </div>
      </div>
      {view === "month" ? (
        <MonthGrid
          events={events}
          playerId={playerId}
          monthOffset={monthOffset}
          setMonthOffset={setMonthOffset}
          bucket={bucket}
          onDay={setSheetDay}
        />
      ) : (
        <>
          <section className="d26-card d26-week">
            <button
              type="button"
              className="d26-round"
              aria-label="Vorherige Woche"
              onClick={() => setWeekOffset((w) => w - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <div className="d26-week-days" key={weekOffset}>
              {week.map((d) => {
                const k = dayKey(d.toISOString());
                const isToday = k === dayKey(new Date().toISOString());
                const titles = titlesByDay.get(k);
                return (
                  <button
                    type="button"
                    key={k}
                    data-tip={titles?.join(" · ")}
                    className={`${day === k ? "is-selected" : ""} ${isToday ? "is-today" : ""}`}
                    onClick={() => setDay(day === k ? null : k)}
                  >
                    <small>
                      {d.toLocaleDateString("de-DE", { weekday: "short" })}
                    </small>
                    <b>{d.getDate()}</b>
                    <i className={titles ? "has-event" : ""} />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="d26-round"
              aria-label="Nächste Woche"
              onClick={() => setWeekOffset((w) => w + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </section>
          <div className="d26-toolbar">
            <div className="d26-segments" role="tablist">
              {(
                [
                  ["upcoming", "Anstehend"],
                  ["past", "Vergangen"],
                  ["all", "Alle"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={!day && filter === v}
                  className={!day && filter === v ? "is-active" : ""}
                  onClick={() => {
                    setDay(null);
                    setFilter(v);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="d26-search">
              <Search size={16} />
              <input
                placeholder="Training, Ort oder Coach"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          {day && (
            <button
              type="button"
              className="d26-chip"
              onClick={() => setDay(null)}
            >
              Nur{" "}
              {formatDate(list[0]?.starts_at ?? monday.toISOString(), {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}{" "}
              ✕
            </button>
          )}
          {groups.length ? (
            groups.map(([k, items]) => (
              <section className="d26-list-section" key={k}>
                <div className="d26-day-head">
                  <b>{relativeDay(items[0].starts_at)}</b>
                  <span>
                    {formatDate(items[0].starts_at, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </span>
                </div>
                <div className="d26-list">
                  {items.map((e) => (
                    <EventRow
                      key={e.id}
                      event={e}
                      playerId={playerId}
                      open={openDetail}
                    />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="d26-card d26-empty-card">
              <Clock size={28} />
              <h3>Keine Termine</h3>
              <p>
                {q
                  ? "Für diese Suche gibt es keinen Treffer."
                  : "Für diese Auswahl ist nichts geplant."}
              </p>
            </div>
          )}
        </>
      )}
      <Sheet
        open={!!sheetItems.length}
        onClose={() => setSheetDay(null)}
        eyebrow={sheetItems[0] ? relativeDay(sheetItems[0].starts_at) : ""}
        title={
          sheetItems[0]
            ? formatDate(sheetItems[0].starts_at, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : ""
        }
      >
        {sheetItems.map((e) => (
          <article className="d26-day-card" key={e.id}>
            <div>
              <b>
                {formatTime(e.starts_at)} – {formatTime(e.ends_at)}
              </b>
              <span
                className={`d26-pill tone-${bucketTone[bucketOf(e, playerId)]}`}
              >
                {e.status === "cancelled"
                  ? "Termin abgesagt"
                  : STATUS_LABELS[statusOf(e, playerId)]}
              </span>
            </div>
            <h3>{e.title}</h3>
            <p>
              <MapPin size={14} /> {e.location_name}
              {e.trainer_name && (
                <>
                  {" "}
                  · <UserRound size={14} /> {e.trainer_name}
                </>
              )}
            </p>
            <button
              type="button"
              className="d26-btn is-primary"
              onClick={() => {
                setSheetDay(null);
                openDetail(e);
              }}
            >
              Termindetails <ArrowUpRight size={16} />
            </button>
          </article>
        ))}
      </Sheet>
    </>
  );
}

/* ---------- Fortschritt ---------- */

function History({
  periods,
  period,
  events,
  playerId,
  selectPeriod,
}: Pick<
  ParentExperienceProps,
  "periods" | "period" | "events" | "playerId" | "selectPeriod"
>) {
  const rows = [...periods]
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((p) => ({
      p,
      done: events.filter((e) =>
        e.participants.some(
          (x) =>
            x.player_id === playerId &&
            x.period_id === p.id &&
            isAttended(x.status),
        ),
      ).length,
    }));
  const max = Math.max(
    1,
    ...rows.map((r) => Math.max(r.done, r.p.included_units)),
  );
  return (
    <section className="d26-card d26-history">
      <div className="d26-card-head">
        <h3>Verlauf</h3>
        <span>Angerechnet je Zeitraum</span>
      </div>
      <div className="d26-history-bars">
        {rows.map(({ p, done }) => (
          <button
            type="button"
            key={p.id}
            className={p.id === period?.id ? "is-active" : ""}
            data-tip={`${periodLabel(p.starts_at, p.ends_at)}: ${done} von ${p.included_units} Einheiten`}
            onClick={() => selectPeriod(p.id)}
          >
            <span>
              <i
                className="is-goal"
                style={{ height: `${(p.included_units / max) * 100}%` }}
              />
              <i
                className="is-done"
                style={{ height: `${(done / max) * 100}%` }}
              />
            </span>
            <b>
              {done}/{p.included_units}
            </b>
            <small>
              {new Date(p.starts_at).toLocaleDateString("de-DE", {
                month: "short",
              })}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

function Progress(props: ParentExperienceProps) {
  const {
    section,
    periods,
    period,
    selectPeriod,
    stats,
    reports,
    stampCard,
    events,
    playerId,
    openDetail,
  } = props;
  const tab = section === "berichte" ? "berichte" : "stempelkarte";
  const insight = insightsFor(events, playerId);
  const counted = events
    .filter((e) =>
      e.participants.some(
        (p) =>
          p.player_id === playerId &&
          p.period_id === period?.id &&
          isAttended(p.status),
      ),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return (
    <>
      <LargeTitle
        eyebrow={period?.product_name ?? "Trainingsfortschritt"}
        title="Fortschritt"
      >
        <ChildSwitch {...props} />
      </LargeTitle>
      <div className="d26-segments is-wide" role="tablist">
        <Link
          href="/stempelkarte"
          role="tab"
          aria-selected={tab === "stempelkarte"}
          className={tab === "stempelkarte" ? "is-active" : ""}
        >
          Stempelkarte
        </Link>
        <Link
          href="/berichte"
          role="tab"
          aria-selected={tab === "berichte"}
          className={tab === "berichte" ? "is-active" : ""}
        >
          Berichte {reports.length ? `(${reports.length})` : ""}
        </Link>
      </div>
      {tab === "stempelkarte" ? (
        <>
          {periods.length > 1 && (
            <div className="d26-chips" aria-label="Leistungszeitraum">
              {periods.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={`d26-chip ${p.id === period?.id ? "is-active" : ""}`}
                  onClick={() => selectPeriod(p.id)}
                >
                  {periodLabel(p.starts_at, p.ends_at)}
                </button>
              ))}
            </div>
          )}
          <div className="d26-bento">
            <section className="d26-card d26-span-2 d26-rings-large">
              <div className="d26-card-head">
                <h3>
                  {period
                    ? periodLabel(period.starts_at, period.ends_at)
                    : "Noch kein Zeitraum"}
                </h3>
              </div>
              <ProgressRings period={period} stats={stats} />
            </section>
            <section
              className="d26-card d26-metric"
              data-tip="Absolviert plus angerechnete Absagen"
            >
              <small>Angerechnet</small>
              <h3>
                <CountUp value={stats.completed} />
                <span> / {period?.included_units ?? 0}</span>
              </h3>
              <p>
                {stats.completed > (period?.included_units ?? 0)
                  ? `Über dem Kontingent: ${stats.completed - (period?.included_units ?? 0)} Einheiten`
                  : "Einheiten in diesem Zeitraum"}
              </p>
            </section>
            <section className="d26-card d26-metric">
              <small>Trainingszeit</small>
              <h3>
                <CountUp value={Math.floor(stats.minutes / 60)} />
                <span> Std. {stats.minutes % 60} Min.</span>
              </h3>
              <p>auf dem Platz verbracht</p>
            </section>
            <section
              className="d26-card d26-metric"
              data-tip="Wochen in Folge mit mindestens einem Training"
            >
              <small>
                <Flame size={13} /> Serie
              </small>
              <h3>
                <CountUp value={insight.streak} />
                <span> {insight.streak === 1 ? "Woche" : "Wochen"}</span>
              </h3>
              <p>ohne Pause trainiert</p>
            </section>
            <section className="d26-card d26-metric">
              <small>
                <Timer size={13} /> Anwesenheit
              </small>
              <h3>
                <CountUp value={Math.round(insight.rate * 100)} />
                <span> %</span>
              </h3>
              <p>aller vergangenen Termine</p>
            </section>
          </div>
          {periods.length > 0 && (
            <History
              periods={periods}
              period={period}
              events={events}
              playerId={playerId}
              selectPeriod={selectPeriod}
            />
          )}
          <section className="d26-list-section">
            <div className="d26-section-head">
              <h2>Deine Einheiten</h2>
              <span>
                <CheckCircle2 size={14} /> {counted.length} angerechnet
              </span>
            </div>
            <ol className="d26-unit-timeline">
              {counted.length ? (
                counted.map((e, i) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => openDetail(e)}>
                      <span className="d26-unit-stamp">{i + 1}</span>
                      <span>
                        <b>{e.title}</b>
                        <small>
                          {formatDate(e.starts_at, {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                          })}{" "}
                          · {e.location_name}
                          {e.trainer_name ? ` · ${e.trainer_name}` : ""}
                        </small>
                      </span>
                      <ChevronRight size={16} className="d26-chevron" />
                    </button>
                  </li>
                ))
              ) : (
                <li className="d26-empty">
                  Noch keine Einheit in diesem Zeitraum angerechnet.
                </li>
              )}
            </ol>
          </section>
          <section className="d26-card d26-stamp-host">{stampCard}</section>
        </>
      ) : (
        <>
          <div className="d26-reports">
            {reports.length ? (
              reports.map((r) => (
                <article className="d26-card d26-report" key={r.id}>
                  <div className="d26-report-cover">
                    <Sparkles size={18} />
                    <span>Trainingsreport</span>
                    <b>{r.period_label}</b>
                  </div>
                  <div className="d26-report-body">
                    <h3>{r.product_name}</h3>
                    <div
                      className="d26-bar"
                      data-tip={`${r.completed} von ${r.units} Einheiten`}
                    >
                      <i
                        style={{
                          width: `${Math.min(100, (r.completed / Math.max(1, r.units)) * 100)}%`,
                        }}
                      />
                    </div>
                    <p>
                      {r.completed} von {r.units} Einheiten ·{" "}
                      {durationLabel(r.minutes)}
                    </p>
                    {(r.athletics_units ?? 0) > 0 && (
                      <p>
                        Fußball {r.football_completed ?? 0} /{" "}
                        {r.units - r.athletics_units!} · Athletik{" "}
                        {r.athletics_completed ?? 0} / {r.athletics_units}
                      </p>
                    )}
                    <small>
                      Version {r.version} · erstellt am{" "}
                      {formatDate(r.created_at)}
                    </small>
                    <a
                      className="d26-btn is-primary"
                      href={`/api/reports/${r.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download size={16} /> PDF
                    </a>
                  </div>
                </article>
              ))
            ) : (
              <div className="d26-card d26-empty-card">
                <FileText size={28} />
                <h3>Dein erster Bericht kommt bald.</h3>
                <p>
                  Nach Ende deines persönlichen Leistungszeitraums erscheint er
                  hier.
                </p>
              </div>
            )}
          </div>
          <p className="d26-footnote">
            Berichte zeigen den Datenstand zum Erstellungszeitpunkt. Noch nicht
            bestätigte Einheiten sind als „Prüfung ausstehend“ gekennzeichnet.
          </p>
        </>
      )}
    </>
  );
}

// Zeitabhängige Texte (Begrüßung, "Übermorgen", Ringe) erst im Browser
// berechnen, damit Server- und Browser-Zeitzone nicht auseinanderlaufen.
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export function ParentExperience(props: ParentExperienceProps) {
  const mounted = useMounted();
  if (!mounted) return <div className="d26-experience" aria-busy="true" />;
  return (
    <div className="d26-experience" onPointerMove={glowFollow}>
      {props.section === "termine" ? (
        <Calendar {...props} />
      ) : props.section === "stempelkarte" || props.section === "berichte" ? (
        <Progress {...props} />
      ) : (
        <Today {...props} />
      )}
    </div>
  );
}
