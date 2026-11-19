"use client";
// Probetraining rückwirkend eintragen: Kalender-Pop-up (Tag -> Einheit), danach
// direkt das Academy-Feedback. Mit der Freigabe startet der normale Mailablauf.
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { formatDate, formatTime } from "@/lib/domain";
import type { TrialRow } from "@/lib/trials/domain";
import { Sheet } from "@/design-2026/ui";
import { trialApi } from "./public";

export interface PastEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string;
  coach: string;
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const BACK_DAYS = 90;
const dayKey = (iso: string) => formatDate(iso);
function weekStart(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** Kann dieses Kind rückwirkend eingetragen werden? */
export function canAssignPast(r: TrialRow) {
  return !r.converted_at && !r.confirmed_at && r.status !== "closed";
}

export function TrialPastAssign({
  row: r,
  refresh,
}: {
  row: TrialRow;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="d26-chip trial-past-trigger"
        onClick={() => setOpen(true)}
      >
        <CalendarClock size={15} /> Rückwirkend eintragen
      </button>
      {open && (
        <PastAssignSheet
          row={r}
          refresh={refresh}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PastAssignSheet({
  row: r,
  refresh,
  onClose,
}: {
  row: TrialRow;
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<PastEvent[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [monthOffset, setMonthOffset] = useState(0),
    [day, setDay] = useState(""),
    [eventId, setEventId] = useState(""),
    [step, setStep] = useState<"pick" | "feedback" | "done">("pick"),
    [rating, setRating] = useState(0),
    [feedback, setFeedback] = useState(""),
    [released, setReleased] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/probetraining/past-events", { cache: "no-store" })
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
        if (!alive) return;
        const list = d.events as PastEvent[];
        setEvents(list);
        // Mit dem Monat der letzten Einheit starten.
        const last = list.at(-1);
        if (last) {
          const now = new Date(),
            at = new Date(last.starts_at);
          setMonthOffset(
            (at.getFullYear() - now.getFullYear()) * 12 +
              at.getMonth() -
              now.getMonth(),
          );
          setDay(dayKey(last.starts_at));
        }
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  const byDay = useMemo(() => {
    const m = new Map<string, PastEvent[]>();
    for (const e of events ?? [])
      m.set(dayKey(e.starts_at), [...(m.get(dayKey(e.starts_at)) ?? []), e]);
    return m;
  }, [events]);

  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const minOffset = -Math.ceil(BACK_DAYS / 30) - 1;
  const startGrid = weekStart(first);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(startGrid);
    d.setDate(d.getDate() + i);
    return d;
  });
  const rows = cells[35].getMonth() === first.getMonth() ? 42 : 35;
  const todayKey = dayKey(now.toISOString());
  const dayEvents = byDay.get(day) ?? [];
  const chosen = events?.find((e) => e.id === eventId);

  async function assign() {
    if (!chosen) return;
    setBusy(true);
    setError("");
    try {
      await trialApi("team", {
        action: "assign_past",
        request_id: r.id,
        event_id: chosen.id,
      });
      await refresh();
      setStep("feedback");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review(ready: boolean) {
    if (!chosen) return;
    setBusy(true);
    setError("");
    try {
      await trialApi("team", {
        action: "review",
        request_id: r.id,
        event_id: chosen.id,
        rating,
        feedback,
        ready,
      });
      await refresh();
      setReleased(ready);
      setStep("done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const footer =
    step === "pick" ? (
      <>
        <button type="button" className="d26-btn" onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className="d26-btn is-primary"
          disabled={!chosen || busy}
          onClick={() => void assign()}
        >
          {busy ? "Wird eingetragen …" : "Eintragen"}
        </button>
      </>
    ) : step === "feedback" ? (
      <>
        <button
          type="button"
          className="d26-btn"
          disabled={busy}
          onClick={() => setStep("done")}
        >
          Später bewerten
        </button>
        <button
          type="button"
          className="d26-btn is-primary"
          disabled={busy || !rating || feedback.trim().length < 3}
          onClick={() => void review(true)}
        >
          {busy ? "Wird gespeichert …" : "Feedback freigeben"}
        </button>
      </>
    ) : (
      <button type="button" className="d26-btn is-primary" onClick={onClose}>
        Fertig
      </button>
    );

  return (
    <Sheet
      open
      onClose={onClose}
      eyebrow={`Probetraining · ${r.first_name} ${r.last_name}`}
      title={
        step === "pick"
          ? "Rückwirkend eintragen"
          : step === "feedback"
            ? "Feedback für die Eltern"
            : "Eingetragen"
      }
      footer={<div className="trial-past-footer">{footer}</div>}
    >
      <div className="trial-past">
        {step === "pick" && (
          <>
            <p className="trial-past-hint">
              Wähle Tag und Einheit, an der {r.first_name} bereits teilgenommen
              hat. Die Teilnahme wird direkt als „Teilgenommen“ bestätigt.
              Möglich für die letzten {BACK_DAYS} Tage.
            </p>
            {!events && !error && <p>Einheiten werden geladen …</p>}
            {events && (
              <section className="d26-card trial-past-month">
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
                      className="trial-past-round"
                      aria-label="Vorheriger Monat"
                      disabled={monthOffset <= minOffset}
                      onClick={() => setMonthOffset((m) => m - 1)}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      type="button"
                      className="trial-past-round"
                      aria-label="Nächster Monat"
                      disabled={monthOffset >= 0}
                      onClick={() => setMonthOffset((m) => m + 1)}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
                <div className="d26-month-grid" key={monthOffset}>
                  {WEEKDAYS.map((w) => (
                    <small key={w}>{w}</small>
                  ))}
                  {cells.slice(0, rows).map((d) => {
                    const k = dayKey(d.toISOString());
                    const items = byDay.get(k) ?? [];
                    const outside = d.getMonth() !== first.getMonth();
                    return (
                      <button
                        type="button"
                        key={k}
                        disabled={!items.length}
                        aria-pressed={k === day}
                        aria-label={`${k}: ${items.length} ${items.length === 1 ? "Einheit" : "Einheiten"}`}
                        className={`${outside ? "is-outside" : ""} ${k === todayKey ? "is-today" : ""} ${items.length ? "has-events" : ""} ${k === day ? "is-selected" : ""}`}
                        onClick={() => {
                          setDay(k);
                          setEventId("");
                        }}
                      >
                        <b>{d.getDate()}</b>
                        <span>
                          {items.slice(0, 3).map((e) => (
                            <i key={e.id} />
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!events.length && (
                  <p className="trial-past-hint">
                    In den letzten {BACK_DAYS} Tagen gab es keine Einheiten.
                  </p>
                )}
              </section>
            )}
            {day && dayEvents.length > 0 && (
              <div className="d26-sheet-group">
                <h3>Einheiten am {day}</h3>
                <div className="d26-mini-list" role="radiogroup">
                  {dayEvents.map((e) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={e.id === eventId}
                      key={e.id}
                      className={`d26-mini-event ${e.id === eventId ? "is-chosen" : ""}`}
                      onClick={() => setEventId(e.id)}
                    >
                      <span className="d26-mini-index">
                        {formatTime(e.starts_at)}
                      </span>
                      <span>
                        <b>{e.title}</b>
                        <small>
                          {formatTime(e.starts_at)}–{formatTime(e.ends_at)} Uhr
                          {e.location ? ` · ${e.location}` : ""}
                          {e.coach ? ` · ${e.coach}` : ""}
                        </small>
                      </span>
                      <span className="trial-past-check" aria-hidden="true">
                        {e.id === eventId && <Check size={16} />}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {r.event_id && r.starts_at && (
              <p className="trial-past-hint">
                Aktuell zugeordnet: {formatDate(r.starts_at)}{" "}
                {formatTime(r.starts_at)} Uhr · {r.event_title}. Diese Zuordnung
                wird durch die gewählte Einheit ersetzt.
              </p>
            )}
          </>
        )}
        {step === "feedback" && chosen && (
          <>
            <div className="d26-chips">
              <span className="d26-chip is-active">
                <Check size={14} /> Teilgenommen
              </span>
              <span className="d26-chip">
                {formatDate(chosen.starts_at)} · {formatTime(chosen.starts_at)}{" "}
                Uhr
              </span>
              {chosen.coach && <span className="d26-chip">{chosen.coach}</span>}
            </div>
            <div className="d26-sheet-group">
              <h3>Eindruck vom Probetraining</h3>
              <div className="d26-chips" role="radiogroup">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={rating === n}
                    key={n}
                    className={`d26-chip ${rating === n ? "is-active" : ""}`}
                    onClick={() => setRating(n)}
                  >
                    {n} von 5
                  </button>
                ))}
              </div>
            </div>
            <label className="trial-past-field">
              Persönliche Beobachtung und nächster Schritt
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                minLength={3}
                maxLength={2000}
                rows={5}
                placeholder="Dieses Feedback sehen die Eltern im Portal und in der Feedbackmail."
              />
            </label>
            <p className="trial-past-hint">
              Mit „Feedback freigeben“ startet der normale Ablauf: Feedbackmail
              an die Eltern, danach die Folge-Mails an Tag 7 und Tag 14.
              {!r.email_verified &&
                " Achtung: Die Eltern haben ihre E-Mail noch nicht bestätigt. Die Mails gehen erst nach der Bestätigung raus."}
            </p>
          </>
        )}
        {step === "done" && (
          <div className="trial-past-done">
            <span className="trial-past-done-icon">
              <Check size={26} />
            </span>
            <p>
              {r.first_name} ist für{" "}
              {chosen
                ? `${formatDate(chosen.starts_at)} · ${formatTime(chosen.starts_at)} Uhr`
                : "die Einheit"}{" "}
              als teilgenommen eingetragen.
            </p>
            <p className="trial-past-hint">
              {released
                ? "Feedback ist freigegeben. Die Feedbackmail wird beim nächsten Versandlauf (alle 5 Minuten) verschickt, die Folge-Mails an Tag 7 und Tag 14 laufen automatisch."
                : "Das Kind steht jetzt unter „Zu bewerten“. Sobald das Feedback freigegeben ist, starten Feedbackmail und Folge-Mails automatisch."}
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
