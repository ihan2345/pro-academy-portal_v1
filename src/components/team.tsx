"use client";
import { useEffect, useState } from "react";
import { MonthCalendar } from "./month-calendar";
import { TrainingNotifications } from "./training-notifications";
import { TrainingApiShare } from "./training-api-share";
import {
  calendarDate,
  compareTrainings,
  confirmationHint,
  addDays,
  addMonths,
  monthStart,
  weekStart,
} from "@/lib/calendar";
import {
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  MapPin,
  UserRound,
  Users,
  Clock,
  Search,
  Check,
  AlertCircle,
} from "lucide-react";
import { Modal, Badge } from "./portal";
import type { PortalData, Training } from "@/lib/types";
import { trainingPeriod } from "@/lib/training-period";
import {
  calculateAutoAttendanceAt,
  localToUtc,
  formatDate,
  formatTime,
  periodLabel,
  attendanceStats,
  disciplineStats,
  disciplineUnits,
  STATUS_LABELS,
  type Attendance,
} from "@/lib/domain";
export async function api(path: string, body?: unknown, method = "POST") {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error ?? "Aktion fehlgeschlagen");
  return result;
}
export function TeamView({
  data,
  update,
  notify,
}: {
  data: PortalData;
  update: (data: PortalData) => void;
  notify: (message: string) => void;
}) {
  const today = calendarDate();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const next = Math.min(
      ...data.events
        .flatMap((event) => [
          Date.parse(event.starts_at),
          Date.parse(event.ends_at),
        ])
        .filter((time) => time > Date.now()),
    );
    const timer = Number.isFinite(next)
      ? setTimeout(
          () => setNow(Date.now()),
          Math.min(Math.max(1, next - Date.now() + 50), 2147483647),
        )
      : undefined;
    const refresh = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [data.events, now]);
  const [notificationEventId, setNotificationEventId] = useState<string | null>(
    null,
  );
  const notificationEvent = data.events.find(
    (event) => event.id === notificationEventId,
  );
  const [date, setDate] = useState(today),
    [month, setMonth] = useState(monthStart(today)),
    [mode, setMode] = useState("day"),
    [editor, setEditor] = useState<Training | "new" | null>(null),
    [exceptions, setExceptions] = useState<Training | null>(null);
  const monday = weekStart(date);
  const counts = new Map<string, number>();
  for (const event of data.events) {
    const day = calendarDate(event.starts_at);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const visible = data.events
    .filter((e) => {
      const day = calendarDate(e.starts_at);
      return mode === "day"
        ? day === date
        : day >= monday && day < addDays(monday, 7);
    })
    .sort(compareTrainings);
  function selectDate(day: string) {
    if (!day) return;
    setDate(day);
    if (day < month || day >= addMonths(month, 2)) setMonth(monthStart(day));
  }
  function move(n: number) {
    if (mode === "week") selectDate(addDays(date, n * 7));
    else {
      const next = addMonths(month, n);
      setMonth(next);
      if (date < next || date >= addMonths(next, 2)) setDate(next);
    }
  }
  async function status(
    event: Training,
    participant: string,
    next: Attendance,
    reason: string,
    mail: boolean,
  ) {
    try {
      await api("team/attendance", {
        participant,
        new_status: next,
        reason,
        send_correction: mail,
      });
      const events = data.events.map((e) =>
        e.id === event.id
          ? {
              ...e,
              participants: e.participants.map((p) =>
                p.id === participant ? { ...p, status: next, reason } : p,
              ),
            }
          : e,
      );
      update({ ...data, events });
      setExceptions({
        ...event,
        participants: event.participants.map((p) =>
          p.id === participant ? { ...p, status: next, reason } : p,
        ),
      });
      notify("Teilnahme korrigiert. Die Statistik ist aktualisiert.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">GEMEINSAM AUF DEM PLATZ</div>
          <h1>
            Trainingsplanung<span className="greeting-dot">.</span>
          </h1>
          <p>Deine Monate im Blick. Dein Training im Detail.</p>
        </div>
        <div className="training-heading-actions">
          <button className="primary-button" onClick={() => setEditor("new")}>
            <Plus size={18} /> Termin erstellen
          </button>
          {data.role === "admin" && <TrainingApiShare notify={notify} />}
        </div>
      </div>
      <section className="panel training-calendar-shell">
        <div className="calendar-toolbar">
          <div className="calendar-controls">
            <button
              className="icon-button"
              onClick={() => move(-1)}
              aria-label={
                mode === "day" ? "Vorheriger Monat" : "Vorherige Woche"
              }
            >
              <ChevronLeft />
            </button>
            <input
              type="date"
              aria-label="Datum"
              value={date}
              onChange={(e) => selectDate(e.target.value)}
            />
            <button
              className="icon-button"
              onClick={() => move(1)}
              aria-label={mode === "day" ? "Nächster Monat" : "Nächste Woche"}
            >
              <ChevronRight />
            </button>
            <button
              className="calendar-today"
              onClick={() => {
                setDate(today);
                setMonth(monthStart(today));
              }}
            >
              Heute
            </button>
          </div>
          <div className="segmented">
            <button
              className={mode === "day" ? "selected" : ""}
              onClick={() => setMode("day")}
              aria-pressed={mode === "day"}
            >
              Kalender
            </button>
            <button
              className={mode === "week" ? "selected" : ""}
              onClick={() => setMode("week")}
              aria-pressed={mode === "week"}
            >
              Woche
            </button>
          </div>
        </div>
        <div
          className={
            mode === "day" ? "calendar-layout" : "calendar-week-layout"
          }
        >
          {mode === "day" && (
            <div className="calendar-months">
              {[month, addMonths(month, 1)].map((value) => (
                <MonthCalendar
                  key={value}
                  month={value}
                  selected={date}
                  today={today}
                  counts={counts}
                  select={selectDate}
                />
              ))}
              <div className="calendar-legend">
                <span>
                  <i /> Mit Terminen
                </span>
                <span>
                  <i className="today-key" /> Heute
                </span>
              </div>
              <a className="calendar-agenda-jump" href="#training-agenda">
                Termine des ausgewählten Tages ↓
              </a>
            </div>
          )}
          <section
            className="calendar-agenda"
            id="training-agenda"
            aria-labelledby="agenda-heading"
          >
            <div
              className="calendar-agenda-heading"
              aria-live="polite"
              aria-atomic="true"
            >
              <div>
                <span className="eyebrow">
                  {mode === "day"
                    ? date === today
                      ? "HEUTE"
                      : "DEIN TRAININGSTAG"
                    : "WOCHENÜBERSICHT"}
                </span>
                <h2 id="agenda-heading">
                  {mode === "day"
                    ? formatDate(`${date}T12:00:00Z`, {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : `${formatDate(`${monday}T12:00:00Z`)} – ${formatDate(`${addDays(monday, 6)}T12:00:00Z`)}`}
                </h2>
              </div>
              <span className="agenda-count">
                {visible.length} {visible.length === 1 ? "Termin" : "Termine"}
              </span>
            </div>
            <div
              className="team-list calendar-agenda-list"
              key={`${mode}-${date}`}
              tabIndex={0}
              role="region"
              aria-label={
                mode === "day"
                  ? "Termine des ausgewählten Tages"
                  : "Termine der Woche"
              }
            >
              {visible.length ? (
                visible.map((e) => (
                  <article
                    className={`team-event${e.status === "cancelled" ? " team-event-cancelled" : ""}`}
                    key={e.id}
                  >
                    <div className="team-event-time">
                      <b>
                        {formatDate(e.starts_at, {
                          weekday: "short",
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </b>
                      <strong>{formatTime(e.starts_at)}</strong>
                      <small>bis {formatTime(e.ends_at)} Uhr</small>
                    </div>
                    <div className="team-event-main">
                      <button
                        className="title-button"
                        onClick={() => setEditor(e)}
                      >
                        {e.title}
                        <Badge
                          tone={e.status === "cancelled" ? "danger" : "purple"}
                        >
                          {e.status === "cancelled"
                            ? "Storniert"
                            : e.event_type}
                        </Badge>
                      </button>
                      <div className="event-inline">
                        <span>
                          <MapPin size={15} />
                          {e.location_name}
                        </span>
                        <span>
                          <UserRound size={15} />
                          {e.trainer_name}
                        </span>
                        <span>
                          <Users size={15} />
                          {
                            e.participants.filter((p) => !p.removed_from_event)
                              .length
                          }{" "}
                          Teilnehmer
                        </span>
                      </div>
                      <p className="training-player-names">
                        {e.participants
                          .filter((p) => !p.removed_from_event)
                          .map((participant) => {
                            const player = data.players.find(
                              (p) => p.id === participant.player_id,
                            );
                            return player
                              ? `${player.first_name} ${player.last_name}`
                              : "Unbekannter Spieler";
                          })
                          .join(", ") || "Noch keine Spieler hinzugefügt"}
                      </p>
                      {e.status === "cancelled" ? (
                        <p className="cancellation-note">
                          Vom Team abgesagt · keine Einheit angerechnet
                        </p>
                      ) : (
                        <p className="auto-label">
                          <Clock size={14} />
                          {confirmationHint(e)}
                        </p>
                      )}
                    </div>
                    <div className="team-event-actions">
                      <button
                        className="secondary-button"
                        onClick={() => setExceptions(e)}
                      >
                        Ausnahmen eintragen
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setEditor(e)}
                      >
                        Termin bearbeiten
                      </button>
                      {e.status !== "cancelled" && (
                        <button
                          className="text-button"
                          disabled={
                            new Date(e.starts_at).getTime() <= now &&
                            new Date(e.ends_at).getTime() > now
                          }
                          onClick={() => setNotificationEventId(e.id)}
                        >
                          {new Date(e.ends_at).getTime() <= now
                            ? "Trainingsbestätigung absenden"
                            : "Alle Elternteile benachrichtigen"}
                        </button>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <CalendarDays />
                  <h3>
                    {mode === "day"
                      ? "Keine Termine an diesem Tag."
                      : "Keine Termine in dieser Woche."}
                  </h3>
                  <p>Hier ist noch Platz für Training.</p>
                  <button
                    className="primary-button"
                    onClick={() => setEditor("new")}
                  >
                    Ersten Termin erstellen
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
      {visible.some((e) => e.status !== "cancelled") && (
        <div className="info-note">
          <Clock size={20} />
          <p>
            Reguläre Teilnahmen werden nach zwölf aktiven Pufferstunden
            automatisch bestätigt. Zwischen 00:00 und 06:00 Uhr pausiert die
            Zeit. Trage hier nur Ausnahmen ein.
          </p>
        </div>
      )}
      {editor && (
        <EventEditor
          data={data}
          event={editor === "new" ? undefined : editor}
          defaultDate={date}
          close={() => setEditor(null)}
          save={async (input, local) => {
            try {
              const result = await api("team/events", input);
              local.id = result.id;

              update({
                ...data,
                events: [
                  ...data.events.filter((e) => e.id !== local.id),
                  local,
                ],
              });
              setEditor(null);
              notify(
                "Termin gespeichert. Benachrichtigungen wurden eingeplant.",
              );
            } catch (e) {
              notify((e as Error).message);
              throw e;
            }
          }}
          cancel={async (event, reason) => {
            await api("team/cancel", { id: event.id, reason });
            update({
              ...data,
              events: data.events.map((e) =>
                e.id === event.id
                  ? {
                      ...e,
                      status: "cancelled",
                      participants: e.participants.map((p) => ({
                        ...p,
                        status:
                          p.status === "excused"
                            ? ("excused" as const)
                            : ("cancelled" as const),
                      })),
                    }
                  : e,
              ),
            });
            setEditor(null);
            notify(
              "Termin storniert. Keine Einheit wird angerechnet; der Verlauf bleibt erhalten.",
            );
          }}
        />
      )}
      {notificationEvent && !exceptions && (
        <TrainingNotifications
          event={notificationEvent}
          close={() => setNotificationEventId(null)}
          notify={notify}
          confirmIndividually={() => setExceptions(notificationEvent)}
          updateParticipants={(participants) =>
            update({
              ...data,
              events: data.events.map((event) =>
                event.id === notificationEvent.id
                  ? { ...event, participants }
                  : event,
              ),
            })
          }
        />
      )}
      {exceptions && (
        <Modal title="Teilnahmen & Ausnahmen" close={() => setExceptions(null)}>
          <div className="form-body">
            <p>
              {exceptions.title} · {formatDate(exceptions.starts_at)} ·{" "}
              {formatTime(exceptions.starts_at)} Uhr
            </p>
            {exceptions.status === "cancelled" ? (
              <p className="cancellation-note">
                Vom Team abgesagt · keine Einheit angerechnet
              </p>
            ) : (
              <div className="info-note">
                <Clock size={18} />
                <p>{confirmationHint(exceptions)}</p>
              </div>
            )}
            {exceptions.participants
              .filter((p) => !p.removed_from_event)
              .map((p) => (
                <ExceptionRow
                  key={p.id}
                  name={
                    data.players.find((c) => c.id === p.player_id)
                      ?.first_name ?? "Kind"
                  }
                  status={p.status}
                  onSave={(s, r, m) => status(exceptions, p.id, s, r, m)}
                />
              ))}
            {notificationEventId === exceptions.id && (
              <button
                className="primary-button"
                onClick={() => setExceptions(null)}
              >
                Zurück zur Versandauswahl
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
function ExceptionRow({
  name,
  status,
  onSave,
}: {
  name: string;
  status: Attendance;
  onSave: (s: Attendance, r: string, m: boolean) => void;
}) {
  const [next, setNext] = useState<Attendance>(status),
    [reason, setReason] = useState(""),
    [mail, setMail] = useState(false);
  return (
    <form
      className="exception-row"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(next, reason, mail);
      }}
    >
      <div className="row-between">
        <b>{name}</b>
        <Badge>{STATUS_LABELS[status]}</Badge>
      </div>
      <label>
        Status
        <select
          aria-label="Status"
          value={next}
          onChange={(e) => setNext(e.target.value as Attendance)}
        >
          {Object.entries(STATUS_LABELS)
            .filter(
              ([v]) => v !== "attended_auto" || status === "attended_auto",
            )
            .map(([v, t]) => (
              <option key={v} value={v} disabled={v === "attended_auto"}>
                {t}
                {v === "attended_manual" ? " (manuell)" : ""}
              </option>
            ))}
        </select>
      </label>
      <label>
        Begründung
        <input
          required
          minLength={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="z. B. krankheitsbedingt entschuldigt"
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={mail}
          onChange={(e) => setMail(e.target.checked)}
        />{" "}
        Korrekturmail einplanen
      </label>
      <button
        disabled={next === status}
        className="secondary-button"
        type="submit"
      >
        Korrektur bestätigen
      </button>
    </form>
  );
}
function EventEditor({
  data,
  event,
  defaultDate,
  close,
  save,
  cancel,
}: {
  data: PortalData;
  event?: Training;
  defaultDate: string;
  close: () => void;
  save: (input: unknown, event: Training) => Promise<void>;
  cancel: (event: Training, reason: string) => Promise<void>;
}) {
  const [children, setChildren] = useState(
      event?.participants
        .filter((p) => !p.removed_from_event)
        .map((p) => p.player_id) ?? [],
    ),
    [eventType, setEventType] = useState(
      event?.event_type ?? "Gruppentraining",
    ),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [cancelMode, setCancelMode] = useState(false),
    [cancelReason, setCancelReason] = useState("");
  const [day, setDay] = useState(
    event
      ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(
          new Date(event.starts_at),
        )
      : defaultDate,
  );
  const [startTime, setStartTime] = useState(
    event ? formatTime(event.starts_at) : "16:30",
  );
  let previewStart = "";
  try {
    previewStart = localToUtc(day, startTime);
  } catch {
    // Incomplete input and ambiguous DST times are shown as validation issues.
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const f = new FormData(e.currentTarget),
        start = localToUtc(String(f.get("date")), String(f.get("start"))),
        end = localToUtc(
          f.get("next_day") === "on"
            ? new Date(Date.parse(`${f.get("date")}T12:00:00Z`) + 86400000)
                .toISOString()
                .slice(0, 10)
            : String(f.get("date")),
          String(f.get("end")),
        );
      if (Date.parse(end) - Date.parse(start) > 12 * 3600000)
        throw new Error("Ein Training darf höchstens zwölf Stunden dauern.");
      if (end <= start)
        throw new Error("Das Ende muss nach dem Beginn liegen.");
      if (!children.length) throw new Error("Wähle mindestens ein Kind aus.");
      const id = event?.id ?? crypto.randomUUID();
      const input = {
        id: event?.id,
        revision: (event as Training & { revision?: number })?.revision ?? 1,
        title: String(f.get("title")),
        starts_at: start,
        ends_at: end,
        location_id: String(f.get("location")),
        trainer_id: String(f.get("trainer")),
        event_type: String(f.get("type")),
        player_ids: children,
        note: String(f.get("note")),
        notify_parents: f.get("notify") === "on",
      };
      const participants = children.map((child) => {
        const { period, issue } = trainingPeriod(
          data.periods,
          child,
          start,
          input.event_type,
        );
        if (issue || !period)
          throw new Error(
            `${data.players.find((p) => p.id === child)?.first_name ?? "Kind"}: ${issue}`,
          );
        return {
          id:
            event?.participants.find((p) => p.player_id === child)?.id ??
            crypto.randomUUID(),
          player_id: child,
          period_id: period.id,
          status:
            (event?.participants.find((p) => p.player_id === child)
              ?.removed_from_event
              ? "planned"
              : event?.participants.find((p) => p.player_id === child)
                  ?.status) ?? ("planned" as const),
        };
      });
      const location = data.locations.find((l) => l.id === input.location_id)!;
      await save(input, {
        ...input,
        id,
        status: event?.status ?? "scheduled",
        auto_attendance_at: calculateAutoAttendanceAt(end),
        location_name: location.name,
        address: location.address,
        trainer_name:
          data.trainers.find((t) => t.id === input.trainer_id)?.name ?? "",
        participants,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={event ? "Termin bearbeiten" : "Neues Training planen"}
      close={close}
    >
      <form className="form-body" onSubmit={submit}>
        <label>
          Trainingstitel
          <input
            required
            name="title"
            defaultValue={event?.title ?? "Technik & Spielintelligenz"}
            maxLength={120}
          />
        </label>
        <div className="form-grid thirds">
          <label>
            Datum
            <input
              type="date"
              required
              name="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <label>
            Beginn
            <input
              type="time"
              required
              name="start"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </label>
          <label>
            Ende
            <input
              type="time"
              required
              name="end"
              defaultValue={event ? formatTime(event.ends_at) : "18:00"}
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Standort
            <select name="location" defaultValue={event?.location_id}>
              {data.locations.map((l) => (
                <option value={l.id} key={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Trainer
            <select name="trainer" defaultValue={event?.trainer_id}>
              {data.trainers.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            name="next_day"
            defaultChecked={
              event
                ? formatDate(event.starts_at) !== formatDate(event.ends_at)
                : false
            }
          />
          Training endet am Folgetag
        </label>
        <label>
          Terminart
          <select
            name="type"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          >
            <option>Gruppentraining</option>
            <option>Einzeltraining</option>
            <option>Athletiktraining</option>
            <option>Fördertraining</option>
          </select>
        </label>
        <div className="row-between">
          <h3>Kinder zuordnen</h3>
          <Badge tone="purple">{children.length} ausgewählt</Badge>
        </div>
        {children.length > 0 && (
          <div className="selected-players" aria-label="Hinzugefügte Spieler">
            {children.map((id) => {
              const p = data.players.find((p) => p.id === id);
              return (
                <button
                  type="button"
                  className="secondary-button assigned-button"
                  key={id}
                  onClick={() =>
                    setChildren((rows) => rows.filter((row) => row !== id))
                  }
                  aria-label={`${p?.first_name ?? "Spieler"} ${p?.last_name ?? ""} entfernen`}
                  title="Aus der Gruppe entfernen"
                >
                  {p?.first_name} {p?.last_name}
                  <Minus size={14} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
        <label className="search-input">
          <Search size={18} />
          <input
            aria-label="Kind suchen"
            placeholder="Kind suchen …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="child-picker">
          {data.players
            .filter((p) =>
              `${p.first_name} ${p.last_name}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((p) => {
              const { period, issue } = trainingPeriod(
                data.periods,
                p.id,
                previewStart,
                eventType,
              );
              const rows = data.events
                .filter((e) =>
                  e.participants.some(
                    (ep) =>
                      ep.player_id === p.id && ep.period_id === period?.id,
                  ),
                )
                .map((e) => ({
                  ...e,
                  event_cancelled: e.status === "cancelled",
                  status: e.participants.find((ep) => ep.player_id === p.id)!
                    .status,
                }));
              const stats = attendanceStats(rows);
              const split = disciplineStats(rows);
              return (
                <label key={p.id} className="child-option">
                  <input
                    type="checkbox"
                    checked={children.includes(p.id)}
                    onChange={(e) =>
                      setChildren(
                        e.target.checked
                          ? [...children, p.id]
                          : children.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <span>
                    <b>
                      {p.first_name} {p.last_name}
                    </b>
                    <small>
                      {period
                        ? `${period.product_name} · ${periodLabel(period.starts_at, period.ends_at)}`
                        : "Kein Leistungszeitraum"}
                    </small>
                    <small>
                      {stats.completed} angerechnet · {stats.planned} geplant ·
                      Anspruch {period?.included_units ?? 0}
                    </small>
                    <small>
                      Fußball {split.football.completed}/
                      {disciplineUnits(period, "Gruppentraining")} · Athletik{" "}
                      {split.athletics.completed}/
                      {disciplineUnits(period, "Athletiktraining")}
                    </small>
                    {issue && <small className="error-message">{issue}</small>}
                  </span>
                </label>
              );
            })}
        </div>
        <label>
          Interne Notiz
          <textarea
            name="note"
            defaultValue={event?.internal_note ?? ""}
            placeholder="Nur für unser Team sichtbar"
            maxLength={2000}
          />
        </label>
        <label className="checkbox-label">
          <input name="notify" type="checkbox" defaultChecked /> Eltern per
          E-Mail benachrichtigen
        </label>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          {event && event.status !== "cancelled" && (
            <button
              className="danger-button"
              type="button"
              onClick={() => setCancelMode(true)}
            >
              Termin stornieren
            </button>
          )}
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Wird gespeichert …" : "Termin speichern"}
            <Check size={17} />
          </button>
        </div>
        {cancelMode && (
          <div className="confirm-box">
            <h3>Termin wirklich stornieren?</h3>
            <p>
              Der Termin wird für alle Teilnehmenden abgesagt. Es wird keine
              Einheit angerechnet. Der Verlauf bleibt erhalten.
            </p>
            <input
              aria-label="Stornierungsgrund"
              placeholder="Begründung"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            <button
              className="danger-button"
              type="button"
              disabled={busy || cancelReason.trim().length < 3}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await cancel(event!, cancelReason);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Stornierung bestätigen
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
