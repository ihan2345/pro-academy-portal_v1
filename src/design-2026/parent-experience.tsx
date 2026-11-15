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
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  MapPin,
  Navigation,
  Search,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-react";
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
          ? `${player?.first_name ?? "Dein Kind"} trainiert ${relativeDay(next.starts_at).toLowerCase()}.`
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
              <div className="d26-hero-meta">
                <span>
                  {formatDate(next.starts_at, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </span>
                <span>
                  <MapPin size={15} /> {next.location_name}
                </span>
                {next.trainer_name && (
                  <span>
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

        <section className="d26-card d26-rings-card">
          <div className="d26-card-head">
            <h3>Dein Zeitraum</h3>
            <Link href="/stempelkarte">
              Fortschritt <ChevronRight size={15} />
            </Link>
          </div>
          <ProgressRings period={period} stats={stats} compact />
        </section>

        <Link href="/konto" className="d26-card d26-plan">
          <span className="d26-icon is-purple">
            <Zap size={18} fill="currentColor" />
          </span>
          <small>Trainingspaket</small>
          <h3>
            {period?.product_name ?? "Kein aktives Paket"}
            <span className="d26-pill tone-lime">{status}</span>
          </h3>
          <div className="d26-bar">
            <i style={{ width: `${periodShare * 100}%` }} />
          </div>
          <p>
            {period
              ? `${periodLabel(period.starts_at, period.ends_at)} · noch ${daysLeft} Tage`
              : "Noch nicht zugeordnet"}
          </p>
        </Link>

        <Link href="/stempelkarte" className="d26-card d26-stamps-mini">
          <small>Stempelkarte</small>
          <h3>
            {stats.completed}
            <span> / {included}</span>
          </h3>
          <div className="d26-dots">
            {Array.from({ length: Math.max(included, stats.completed) }).map(
              (_, i) => (
                <i
                  key={i}
                  className={
                    i < stats.completed
                      ? "is-done"
                      : i < stats.completed + stats.planned
                        ? "is-planned"
                        : ""
                  }
                />
              ),
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
    </>
  );
}

/* ---------- Kalender ---------- */

function Calendar(props: ParentExperienceProps) {
  const { events, playerId, openDetail } = props;
  const [filter, setFilter] = useState<"upcoming" | "past" | "all">("upcoming");
  const [query, setQuery] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [day, setDay] = useState<string | null>(null);
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
  const busy = new Set(events.map((e) => dayKey(e.starts_at)));
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
        <span>
          <b>{counts.upcoming}</b> anstehend
        </span>
        <span>
          <b>{counts.done}</b> absolviert
        </span>
        <span>
          <b>{counts.charged}</b> angerechnet abgesagt
        </span>
      </div>
      <section className="d26-card d26-week">
        <button
          type="button"
          className="d26-round"
          aria-label="Vorherige Woche"
          onClick={() => setWeekOffset((w) => w - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <div className="d26-week-days">
          {week.map((d) => {
            const k = dayKey(d.toISOString());
            const isToday = k === dayKey(new Date().toISOString());
            return (
              <button
                type="button"
                key={k}
                className={`${day === k ? "is-selected" : ""} ${isToday ? "is-today" : ""}`}
                onClick={() => setDay(day === k ? null : k)}
              >
                <small>
                  {d.toLocaleDateString("de-DE", { weekday: "short" })}
                </small>
                <b>{d.getDate()}</b>
                <i className={busy.has(k) ? "has-event" : ""} />
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
        <button type="button" className="d26-chip" onClick={() => setDay(null)}>
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
  );
}

/* ---------- Fortschritt ---------- */

function Progress(props: ParentExperienceProps) {
  const { section, periods, period, selectPeriod, stats, reports, stampCard } =
    props;
  const tab = section === "berichte" ? "berichte" : "stempelkarte";
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
            <section className="d26-card d26-metric">
              <small>Angerechnet</small>
              <h3>
                {stats.completed}
                <span> / {period?.included_units ?? 0}</span>
              </h3>
              <p>Einheiten in diesem Zeitraum</p>
            </section>
            <section className="d26-card d26-metric">
              <small>Trainingszeit</small>
              <h3>
                {Math.floor(stats.minutes / 60)}
                <span> Std. {stats.minutes % 60} Min.</span>
              </h3>
              <p>auf dem Platz verbracht</p>
            </section>
          </div>
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
    <div className="d26-experience">
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
