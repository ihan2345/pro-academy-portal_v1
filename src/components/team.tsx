"use client";
import { useState } from "react";
import {
  Plus,
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
  remainingActiveMinutes,
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
  const [date, setDate] = useState(
      data.demo
        ? "2026-09-10"
        : new Intl.DateTimeFormat("sv-SE", {
            timeZone: "Europe/Berlin",
          }).format(new Date()),
    ),
    [mode, setMode] = useState("week"),
    [editor, setEditor] = useState<Training | "new" | null>(null),
    [exceptions, setExceptions] = useState<Training | null>(null);
  const anchor = new Date(`${date}T12:00:00Z`),
    monday = new Date(anchor);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const visible = data.events
    .filter((e) => {
      const d = new Date(e.starts_at);
      return mode === "day"
        ? formatDate(e.starts_at) === formatDate(anchor.toISOString())
        : d >= new Date(new Date(monday).setUTCHours(0, 0, 0, 0)) &&
            d < new Date(monday.getTime() + 7 * 86400000);
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  function move(n: number) {
    setDate(
      new Date(anchor.getTime() + n * (mode === "week" ? 7 : 1) * 86400000)
        .toISOString()
        .slice(0, 10),
    );
  }
  async function status(
    event: Training,
    participant: string,
    next: Attendance,
    reason: string,
    mail: boolean,
  ) {
    try {
      if (!data.demo)
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
      notify(
        data.demo
          ? "Ausnahme in den lokalen Testdaten gespeichert."
          : "Teilnahme korrigiert. Die Statistik ist aktualisiert.",
      );
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
          <p>Plane die Woche. Wir kümmern uns um die Bestätigung.</p>
        </div>
        <button className="primary-button" onClick={() => setEditor("new")}>
          <Plus size={18} /> Termin erstellen
        </button>
      </div>
      <section className="panel">
        <div className="calendar-toolbar">
          <div className="calendar-controls">
            <button
              className="icon-button"
              onClick={() => move(-1)}
              aria-label="Vorheriger Zeitraum"
            >
              <ChevronLeft />
            </button>
            <input
              type="date"
              aria-label="Datum"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <button
              className="icon-button"
              onClick={() => move(1)}
              aria-label="Nächster Zeitraum"
            >
              <ChevronRight />
            </button>
          </div>
          <div className="segmented">
            <button
              className={mode === "day" ? "selected" : ""}
              onClick={() => setMode("day")}
            >
              Tag
            </button>
            <button
              className={mode === "week" ? "selected" : ""}
              onClick={() => setMode("week")}
            >
              Woche
            </button>
          </div>
        </div>
        <div className="team-list">
          {visible.length ? (
            visible.map((e) => (
              <article className="team-event" key={e.id}>
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
                  <button className="title-button" onClick={() => setEditor(e)}>
                    {e.title}
                    <Badge
                      tone={e.status === "cancelled" ? "neutral" : "purple"}
                    >
                      {e.status === "cancelled" ? "Storniert" : e.event_type}
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
                  <p className="auto-label">
                    <Clock size={14} /> Automatische Bestätigung{" "}
                    {formatDate(e.auto_attendance_at)} um{" "}
                    {formatTime(e.auto_attendance_at)} Uhr
                  </p>
                </div>
                <div className="team-event-actions">
                  <button
                    className="secondary-button"
                    onClick={() => setExceptions(e)}
                  >
                    Ausnahmen eintragen
                  </button>
                  <button className="text-button" onClick={() => setEditor(e)}>
                    Termin bearbeiten
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <CalendarDays />
              <h2>Platz für Training.</h2>
              <p>In diesem Zeitraum gibt es noch keine Termine.</p>
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
      <div className="info-note">
        <Clock size={20} />
        <p>
          Reguläre Teilnahmen werden nach zwölf aktiven Pufferstunden
          automatisch bestätigt. Zwischen 00:00 und 06:00 Uhr pausiert die Zeit.
          Trage hier nur Ausnahmen ein.
        </p>
      </div>
      {editor && (
        <EventEditor
          data={data}
          event={editor === "new" ? undefined : editor}
          defaultDate={date}
          close={() => setEditor(null)}
          save={async (input, local) => {
            try {
              if (!data.demo) {
                const result = await api("team/events", input);
                local.id = result.id;
              }
              update({
                ...data,
                events: [
                  ...data.events.filter((e) => e.id !== local.id),
                  local,
                ],
              });
              setEditor(null);
              notify(
                data.demo
                  ? "Termin in den lokalen Testdaten gespeichert. Es wurde keine E-Mail verschickt."
                  : "Termin gespeichert. Benachrichtigungen wurden eingeplant.",
              );
            } catch (e) {
              notify((e as Error).message);
              throw e;
            }
          }}
          cancel={async (event, reason) => {
            if (!data.demo) await api("team/cancel", { id: event.id, reason });
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
            notify("Termin storniert. Der Verlauf bleibt erhalten.");
          }}
        />
      )}
      {exceptions && (
        <Modal title="Teilnahmen & Ausnahmen" close={() => setExceptions(null)}>
          <div className="form-body">
            <p>
              {exceptions.title} · {formatDate(exceptions.starts_at)} ·{" "}
              {formatTime(exceptions.starts_at)} Uhr
            </p>
            <div className="info-note">
              <Clock size={18} />
              <p>
                Noch{" "}
                {Math.min(
                  720,
                  remainingActiveMinutes(
                    data.demo
                      ? "2026-09-09T10:00:00Z"
                      : new Date().toISOString(),
                    exceptions.auto_attendance_at,
                  ),
                )}{" "}
                aktive Puffer-Minuten bis zur automatischen Bestätigung.
              </p>
            </div>
            {exceptions.participants.map((p) => (
              <ExceptionRow
                key={p.id}
                name={
                  data.players.find((c) => c.id === p.player_id)?.first_name ??
                  "Kind"
                }
                status={p.status}
                onSave={(s, r, m) => status(exceptions, p.id, s, r, m)}
              />
            ))}
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
      const id = event?.id ?? `PA-DEMO-${crypto.randomUUID().slice(0, 6)}`;
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
        const period = data.periods.find(
          (p) =>
            p.player_id === child &&
            p.starts_at <= start &&
            p.ends_at > start &&
            ["active", "trialing"].includes(p.status) &&
            disciplineUnits(p, input.event_type) > 0,
        );
        if (!period)
          throw new Error(
            `Für ${data.players.find((p) => p.id === child)?.first_name} fehlt ein passender Leistungszeitraum. Bitte zuerst die Abo-Zuordnung prüfen.`,
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
              defaultValue={event ? formatTime(event.starts_at) : "16:30"}
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
              const period = data.periods.find(
                (per) =>
                  per.player_id === p.id &&
                  per.starts_at <= localToUtc(day, "12:00") &&
                  per.ends_at > localToUtc(day, "12:00"),
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
                      {disciplineUnits(period, eventType) === 0 &&
                        " · Kein Kontingent für diese Trainingsart"}
                    </small>
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
              Alle zugeordneten Teilnahmen werden storniert. Der Verlauf bleibt
              erhalten.
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
              disabled={cancelReason.trim().length < 3}
              onClick={async () => {
                try {
                  await cancel(event!, cancelReason);
                } catch (e) {
                  setError((e as Error).message);
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
