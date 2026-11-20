"use client";
// Design 2026: Übersicht und Filter für die Trainingsplanung (Admin und Team).
// Nur Darstellung und Filter im Browser. Speichern, Absagen, Teilnahmen und
// Benachrichtigungen laufen unverändert über die bestehenden Aktionen.
import {
  AlertCircle,
  CalendarCheck,
  CalendarDays,
  Search,
  Users,
  XCircle,
} from "lucide-react";
import type { PortalData, Training } from "@/lib/types";
import { formatDate, formatTime, isAttended } from "@/lib/domain";
import { addDays, calendarDate } from "@/lib/calendar";
import { CountUp, glowFollow } from "./ui";

export type PlanningFilter = "all" | "upcoming" | "confirm" | "cancelled";
export type PlanningState = {
  filter: PlanningFilter;
  place: string;
  coaches: string[];
  query: string;
};
export const initialPlanning: PlanningState = {
  filter: "all",
  place: "",
  coaches: [],
  query: "",
};

const active = (e: Training) =>
  e.participants.filter((p) => !p.removed_from_event);
export const needsConfirmation = (e: Training, now: number) =>
  e.status !== "cancelled" &&
  Date.parse(e.ends_at) < now &&
  active(e).some((p) => p.status === "planned");

/** Wendet die Design-Filter auf die Terminliste an. */
export function applyPlanning(
  visible: Training[],
  all: Training[],
  state: PlanningState,
  now: number,
) {
  const base =
    state.filter === "confirm"
      ? all
          .filter((e) => needsConfirmation(e, now))
          .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
      : visible;
  const q = state.query.trim().toLowerCase();
  return base.filter(
    (e) =>
      (state.filter !== "upcoming" || Date.parse(e.ends_at) >= now) &&
      (state.filter !== "cancelled" || e.status === "cancelled") &&
      (!state.place || e.location_name === state.place) &&
      (!state.coaches.length || state.coaches.includes(e.trainer_name)) &&
      (!q ||
        [e.title, e.location_name, e.trainer_name, e.event_type]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
}

export function PlanningOverview({
  data,
  now,
  today,
  weekFrom,
  state,
  setState,
  jumpToday,
}: {
  data: PortalData;
  now: number;
  today: string;
  weekFrom: string;
  state: PlanningState;
  setState: (s: PlanningState) => void;
  jumpToday: () => void;
}) {
  const day = (iso: string) => calendarDate(iso);
  const weekTo = addDays(weekFrom, 7);
  const live = data.events.filter((e) => e.status !== "cancelled");
  const todays = live
    .filter((e) => day(e.starts_at) === today)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const nextToday = todays.find((e) => Date.parse(e.ends_at) > now);
  const week = live.filter(
    (e) => day(e.starts_at) >= weekFrom && day(e.starts_at) < weekTo,
  );
  const seats = week.reduce((s, e) => s + active(e).length, 0);
  const confirm = data.events.filter((e) => needsConfirmation(e, now)).length;
  const cancelled = data.events.filter(
    (e) =>
      e.status === "cancelled" && Date.parse(e.starts_at) > now - 30 * 86400000,
  ).length;
  const places = [
    ...new Set(data.events.map((e) => e.location_name).filter(Boolean)),
  ];
  const coaches = [
    ...new Set(data.events.map((e) => e.trainer_name).filter(Boolean)),
  ];
  const set = (patch: Partial<PlanningState>) =>
    setState({ ...state, ...patch });
  const tiles = [
    {
      key: "today",
      icon: CalendarDays,
      value: todays.length,
      label: "Heute",
      hint: nextToday
        ? `Als Nächstes ${formatTime(nextToday.starts_at)} · ${nextToday.title}`
        : "Heute nichts mehr geplant",
      onClick: () => {
        jumpToday();
        set({ filter: "all" });
      },
      active: false,
    },
    {
      key: "upcoming",
      icon: Users,
      value: week.length,
      label: "Diese Woche",
      hint: `${seats} gebuchte Plätze`,
      onClick: () =>
        set({ filter: state.filter === "upcoming" ? "all" : "upcoming" }),
      active: state.filter === "upcoming",
    },
    {
      key: "confirm",
      icon: confirm ? AlertCircle : CalendarCheck,
      value: confirm,
      label: "Zu bestätigen",
      hint: confirm
        ? "Vergangene Termine mit offenen Teilnahmen"
        : "Alles bestätigt",
      onClick: () =>
        set({ filter: state.filter === "confirm" ? "all" : "confirm" }),
      active: state.filter === "confirm",
      alert: confirm > 0,
    },
    {
      key: "cancelled",
      icon: XCircle,
      value: cancelled,
      label: "Abgesagt",
      hint: "In den letzten 30 Tagen",
      onClick: () =>
        set({ filter: state.filter === "cancelled" ? "all" : "cancelled" }),
      active: state.filter === "cancelled",
    },
  ];
  return (
    <div className="d26-planning" onPointerMove={glowFollow}>
      <div className="d26-kpis">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            data-tip={t.hint}
            className={`d26-card d26-kpi is-tappable ${t.active ? "is-selected" : ""} ${t.alert ? "is-alert" : ""}`}
            onClick={t.onClick}
          >
            <t.icon size={18} />
            <b>
              <CountUp value={t.value} />
            </b>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="d26-planning-filters">
        <label className="d26-search">
          <Search size={16} />
          <input
            placeholder="Training, Ort, Coach oder Typ"
            value={state.query}
            onChange={(e) => set({ query: e.target.value })}
          />
        </label>
        {places.length > 1 && (
          <div className="d26-chips" aria-label="Standort">
            <button
              type="button"
              className={`d26-chip ${!state.place ? "is-active" : ""}`}
              onClick={() => set({ place: "" })}
            >
              Alle Orte
            </button>
            {places.map((p) => (
              <button
                type="button"
                key={p}
                className={`d26-chip ${state.place === p ? "is-active" : ""}`}
                onClick={() => set({ place: state.place === p ? "" : p })}
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {coaches.length > 1 && (
          <div className="d26-chips" aria-label="Coach">
            <button
              type="button"
              className={`d26-chip ${!state.coaches.length ? "is-active" : ""}`}
              onClick={() => set({ coaches: [] })}
            >
              Alle Coaches
            </button>
            {coaches.map((c) => (
              <button
                type="button"
                key={c}
                className={`d26-chip ${state.coaches.includes(c) ? "is-active" : ""}`}
                aria-pressed={state.coaches.includes(c)}
                data-tip="Mehrere Coaches gleichzeitig wählbar"
                onClick={() =>
                  set({
                    coaches: state.coaches.includes(c)
                      ? state.coaches.filter((x) => x !== c)
                      : [...state.coaches, c],
                  })
                }
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
      {state.filter === "confirm" && (
        <p className="d26-filter-note">
          Alle vergangenen Termine mit offenen Teilnahmen, unabhängig vom
          gewählten Datum.{" "}
          <button type="button" onClick={() => set({ filter: "all" })}>
            Filter aufheben
          </button>
        </p>
      )}
    </div>
  );
}

/** Teilnehmer-Avatare und Bestätigungsstand für eine Terminkarte. */
export function EventPulse({
  event,
  data,
  now,
}: {
  event: Training;
  data: PortalData;
  now: number;
}) {
  const people = active(event);
  const done = people.filter((p) => isAttended(p.status)).length;
  const past = Date.parse(event.ends_at) < now;
  const running = !past && Date.parse(event.starts_at) <= now;
  const name = (id: string) => {
    const p = data.players.find((x) => x.id === id);
    return p ? `${p.first_name} ${p.last_name}` : "Spieler";
  };
  const startsIn = Math.round((Date.parse(event.starts_at) - now) / 60000);
  return (
    <div className="d26-event-pulse">
      <span className="d26-avatars">
        {people.slice(0, 6).map((p) => (
          <i
            key={p.id}
            data-tip={[
              name(p.player_id),
              p.parent_active ? "Elternprofil aktiv" : "",
              isAttended(p.status)
                ? p.attendance_mail_sent
                  ? "Teilnahme bestätigt · Mail versendet"
                  : "Teilnahme bestätigt"
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
            className={[
              p.parent_active ? "is-parent-active" : "",
              isAttended(p.status) && p.attendance_mail_sent ? "is-sent" : "",
              isAttended(p.status) && !p.parent_active ? "is-done" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {name(p.player_id).charAt(0)}
          </i>
        ))}
        {people.length > 6 && <i>+{people.length - 6}</i>}
      </span>
      {event.status !== "cancelled" && people.length > 0 && (
        <span
          className="d26-meter"
          data-tip={`${done} von ${people.length} Teilnahmen bestätigt`}
        >
          <i style={{ width: `${(done / people.length) * 100}%` }} />
        </span>
      )}
      <span
        className={`d26-pill ${running ? "tone-lime" : needsConfirmation(event, now) ? "tone-amber" : past ? "" : "tone-purple"}`}
      >
        {event.status === "cancelled"
          ? "Abgesagt"
          : running
            ? "Läuft gerade"
            : needsConfirmation(event, now)
              ? "Bestätigung offen"
              : past
                ? "Abgeschlossen"
                : startsIn < 60 * 24 && startsIn > 0
                  ? `In ${startsIn >= 60 ? `${Math.floor(startsIn / 60)} Std.` : `${startsIn} Min.`}`
                  : formatDate(event.starts_at, { weekday: "long" })}
      </span>
    </div>
  );
}

/** Schnellauswahl im Terminformular: setzt nur die Formularfelder. */
export function QuickPicks({
  day,
  startTime,
  endTime,
  setDay,
  setStart,
  setEnd,
}: {
  day: string;
  startTime: string;
  endTime: string;
  setDay: (d: string) => void;
  setStart: (t: string) => void;
  setEnd: (t: string) => void;
}) {
  const today = calendarDate();
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const fmt = (min: number) =>
    `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const duration = toMin(endTime) - toMin(startTime);
  const days: [string, string][] = [
    ["Heute", today],
    ["Morgen", addDays(today, 1)],
    ["+1 Woche", addDays(day || today, 7)],
  ];
  return (
    <div className="d26-quickpicks">
      <div>
        <small>Datum</small>
        {days.map(([label, value]) => (
          <button
            type="button"
            key={label}
            className={`d26-chip ${day === value && label !== "+1 Woche" ? "is-active" : ""}`}
            onClick={() => setDay(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div>
        <small>Beginn</small>
        {["16:00", "17:00", "18:00"].map((t) => (
          <button
            type="button"
            key={t}
            className={`d26-chip ${startTime === t ? "is-active" : ""}`}
            onClick={() => {
              setStart(t);
              if (duration > 0) setEnd(fmt(toMin(t) + duration));
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div>
        <small>Dauer</small>
        {[60, 90, 120].map((m) => (
          <button
            type="button"
            key={m}
            className={`d26-chip ${duration === m ? "is-active" : ""}`}
            onClick={() => setEnd(fmt(toMin(startTime) + m))}
          >
            {m} Min.
          </button>
        ))}
      </div>
    </div>
  );
}

/** Ein Satz zur Lage für den Seitenkopf. */
export function planningGreeting(events: Training[], now: number) {
  const day = calendarDate();
  const week = addDays(day, 7);
  const next = events.filter(
    (e) =>
      e.status !== "cancelled" &&
      calendarDate(e.starts_at) >= day &&
      calendarDate(e.starts_at) < week,
  ).length;
  const open = events.filter((e) => needsConfirmation(e, now)).length;
  return `${next ? `In den nächsten 7 Tagen ${next === 1 ? "steht 1 Training" : `stehen ${next} Trainings`} an.` : "Die nächsten 7 Tage sind noch frei."}${open ? ` ${open} vergangene ${open === 1 ? "Termin wartet" : "Termine warten"} auf Bestätigung.` : " Alle Teilnahmen sind bestätigt."}`;
}
