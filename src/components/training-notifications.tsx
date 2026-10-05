"use client";
import { useEffect, useRef, useState } from "react";
import { Modal } from "./portal";
import { api } from "./team";
import type { Training } from "@/lib/types";

type Kind = "planning" | "training_reminder" | "attendance";
interface Option {
  parent_id: string;
  player_id: string;
  parent_name: string;
  player_name: string;
  kind: Kind;
  state: string;
  reason: string;
  enabled: boolean;
  activated: boolean;
}
interface Preview {
  rows: Option[];
  ended: boolean;
  buffer_active: boolean;
  unconfirmed: { id: string; name: string }[];
}
const key = (row: Option) => `${row.parent_id}:${row.player_id}:${row.kind}`;
const actions: Record<Kind, { title: string; description: string }> = {
  planning: {
    title: "Trainingsplanung / Aktualisierung",
    description:
      "Den aktuellen Trainingsstand im nächsten Versandlauf senden. Eine Aktualisierung erhalten nur bereits informierte Eltern. Auch innerhalb der letzten 24 Stunden auswählbar.",
  },
  training_reminder: {
    title: "Trainingserinnerung",
    description:
      "Einmalige Erinnerung 24 Stunden vor Beginn freigeben. Später hinzugefügte Kinder erhalten keine zusätzliche Erinnerung.",
  },
  attendance: {
    title: "Teilnahmebestätigung",
    description:
      "Versand nach bestätigter Teilnahme. Vor dem Termin wird nur die spätere Benachrichtigung freigegeben; nach Terminende wird sie für bestätigte Kinder im nächsten Versandlauf eingeplant.",
  },
};
export function TrainingNotifications({
  event,
  close,
  notify,
  confirmIndividually,
  updateParticipants,
}: {
  event: Training;
  close: () => void;
  notify: (message: string) => void;
  confirmIndividually: () => void;
  updateParticipants: (participants: Training["participants"]) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [confirmAll, setConfirmAll] = useState(false);
  const submitting = useRef(false);
  const [staffInput, setStaffInput] = useState("");
  const [staffEmails, setStaffEmails] = useState<string[]>([]);
  const enteredStaffEmails = () => [
    ...new Set(
      [...staffEmails, ...staffInput.split(/[\s,;]+/).filter(Boolean)].map(
        (email) => email.trim().toLowerCase(),
      ),
    ),
  ];
  async function addStaffEmails() {
    if (submitting.current || !staffInput.trim()) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api("team/validate-training-staff", {
        emails: enteredStaffEmails(),
      });
      setStaffEmails(result.emails);
      setStaffInput("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Team-Adressen konnten nicht geprüft werden.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    setPreview(null);
    setError("");
    setSelected(new Set());
    api("team/notification-options", { id: event.id })
      .then((result: Preview) => {
        if (active) setPreview(result);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [event.id, reload]);
  useEffect(() => {
    const boundaries = [
      Date.parse(event.starts_at) - 86400000,
      Date.parse(event.starts_at),
      Date.parse(event.ends_at),
      Date.parse(event.auto_attendance_at),
    ];
    const next = Math.min(...boundaries.filter((time) => time > Date.now()));
    const timer = Number.isFinite(next)
      ? setTimeout(
          () => setReload((value) => value + 1),
          Math.min(Math.max(1, next - Date.now() + 50), 2147483647),
        )
      : undefined;
    return () => clearTimeout(timer);
  }, [event.starts_at, event.ends_at, event.auto_attendance_at, reload]);
  async function submit(all = false) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (all) {
        const result = await api("team/confirm-all-attendance", {
          id: event.id,
          confirmed: true,
        });
        updateParticipants(result.participants ?? []);
        notify(
          `${result.confirmed} geplante Teilnahme(n) bestätigt. Aktivierte Eltern werden wie bisher automatisch benachrichtigt.`,
        );
        setConfirmAll(false);
      } else {
        const selections = preview?.rows
          .filter((row) => row.enabled && selected.has(key(row)))
          .map(({ parent_id, player_id, kind }) => ({
            parent_id,
            player_id,
            kind,
          }));
        const emails = preview?.ended ? enteredStaffEmails() : [];
        if (!selections?.length && !emails.length) return;
        const result = await api("team/notify-parents", {
          id: event.id,
          selections: selections ?? [],
          ...(emails.length ? { staff_emails: emails } : {}),
        });
        setStaffEmails([]);
        setStaffInput("");
        notify(
          `${result.queued + (result.staff_queued ?? 0)} Mail(s) eingeplant. ${result.approved} Freigabe(n) gespeichert.${result.blocked ? ` ${result.blocked} Auswahl(en) inzwischen gesperrt; bitte erneut prüfen.` : ""}${result.staff_skipped ? ` ${result.staff_skipped} Team-Bestätigung(en) bereits versendet oder eingeplant.` : ""}`,
        );
      }
      setReload((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Aktion fehlgeschlagen.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const ended =
    preview?.ended ?? new Date(event.ends_at).getTime() <= Date.now();
  return (
    <Modal
      title={ended ? "Trainingsbestätigung absenden" : "Eltern benachrichtigen"}
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="form-body training-notification-dialog">
        <p>
          <strong>{event.title}</strong>
        </p>
        {error && (
          <div role="alert">
            <p>{error}</p>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setReload((value) => value + 1)}
            >
              Neu laden
            </button>
          </div>
        )}
        {!preview && !error && (
          <p role="status">Versandstatus wird geladen …</p>
        )}
        {confirmAll ? (
          <>
            <p>
              Sind Sie sicher? Hiermit werden alle noch geplanten Kinder als
              „teilgenommen“ bestätigt. Entschuldigte, abwesende und entfernte
              Kinder bleiben unverändert.
            </p>
            <p>
              Die Bestätigung kann automatische Teilnahmemails an aktivierte
              Eltern und bereits freigegebene Empfänger auslösen.
            </p>
            <div className="form-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setConfirmAll(false)}
              >
                Abbrechen
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void submit(true)}
              >
                {busy
                  ? "Wird bestätigt …"
                  : "Ja, alle geplanten Teilnahmen bestätigen"}
              </button>
            </div>
          </>
        ) : (
          preview && (
            <>
              {ended && preview.unconfirmed.length > 0 && (
                <div className="panel">
                  <p>
                    <strong>
                      Teilnahmen wurden noch nicht bestätigt. Bitte zuerst die
                      Teilnahme bestätigen.
                    </strong>
                  </p>
                  <p>
                    {preview.buffer_active
                      ? "Die Pufferzeit ist noch aktiv."
                      : "Die Pufferzeit ist abgelaufen; es gibt noch unbestätigte Teilnahmen."}{" "}
                    Bereits bestätigte Kinder sind unten auswählbar.
                  </p>
                  <p>
                    {preview.unconfirmed.map((child) => child.name).join(", ")}
                  </p>
                  <div className="form-actions">
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={confirmIndividually}
                    >
                      Bestätigen
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => setConfirmAll(true)}
                    >
                      Alle bestätigen
                    </button>
                  </div>
                </div>
              )}
              <p>
                Nur ausgewählte Aktionen werden freigegeben. Eltern mit
                Portal-Aktivierung bleiben sichtbar und sind nicht zusätzlich
                auswählbar. Bereits versendete oder eingeplante Mails werden
                nicht doppelt erstellt.
              </p>
              {(ended
                ? ["attendance" as const]
                : (["planning", "training_reminder", "attendance"] as const)
              ).map((kind) => (
                <fieldset key={kind} disabled={busy}>
                  <legend>{actions[kind].title}</legend>
                  <p>{actions[kind].description}</p>
                  {preview.rows
                    .filter((row) => row.kind === kind)
                    .map((row) => (
                      <label
                        className="checkbox-label training-mail-option"
                        key={key(row)}
                      >
                        <input
                          type="checkbox"
                          disabled={!row.enabled || busy}
                          checked={selected.has(key(row))}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSelected((current) => {
                              const next = new Set(current);
                              if (checked) next.add(key(row));
                              else next.delete(key(row));
                              return next;
                            });
                          }}
                        />
                        <span>
                          <strong>{row.parent_name}</strong> · {row.player_name}
                          <small>{row.reason}</small>
                        </span>
                      </label>
                    ))}
                  {!preview.rows.some((row) => row.kind === kind) && (
                    <p>Keine zugeordneten Eltern vorhanden.</p>
                  )}
                </fieldset>
              ))}
              {ended && (
                <fieldset disabled={busy}>
                  <legend>Bestätigung an Coaches / Admins</legend>
                  <p>
                    Nur bestätigte Teamkonten. Jede Adresse erhält eine eigene
                    Mail mit allen tatsächlich teilgenommenen Kindern. Mehrere
                    Adressen mit Komma, Semikolon oder Zeilenumbruch trennen.
                  </p>
                  <label>
                    E-Mail-Adressen
                    <textarea
                      rows={3}
                      value={staffInput}
                      onChange={(e) => setStaffInput(e.target.value)}
                      placeholder="coach@beispiel.de"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={busy || !staffInput.trim()}
                    onClick={() => void addStaffEmails()}
                  >
                    Adressen prüfen und hinzufügen
                  </button>
                  {staffEmails.map((email) => (
                    <div className="row-between" key={email}>
                      <span style={{ overflowWrap: "anywhere", minWidth: 0 }}>
                        {email}
                      </span>
                      <button
                        className="text-button"
                        aria-label={`${email} entfernen`}
                        onClick={() =>
                          setStaffEmails((current) =>
                            current.filter((value) => value !== email),
                          )
                        }
                      >
                        Entfernen
                      </button>
                    </div>
                  ))}
                </fieldset>
              )}
              <div className="form-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={close}
                >
                  Schließen
                </button>
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    (selected.size === 0 &&
                      (!ended || (!staffEmails.length && !staffInput.trim())))
                  }
                  onClick={() => void submit()}
                >
                  {busy
                    ? "Wird gespeichert …"
                    : ended
                      ? "Ausgewählte Bestätigungen absenden"
                      : "Auswahl absenden / freigeben"}
                </button>
              </div>
            </>
          )
        )}
      </div>
    </Modal>
  );
}
