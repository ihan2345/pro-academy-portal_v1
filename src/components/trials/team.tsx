"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  formatDate,
  formatTime,
  STATUS_LABELS,
  type Attendance,
} from "@/lib/domain";
import type { TrialRow } from "@/lib/trials/domain";
import { trialApi } from "./public";
export function TrialMenuBadge() {
  const [counts, setCounts] = useState<{ new: number; review: number } | null>(
    null,
  );
  useEffect(() => {
    const abort = new AbortController();
    const load = () => {
      fetch("/api/probetraining/summary", {
        cache: "no-store",
        signal: abort.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then(setCounts)
        .catch(() => {});
    };
    load();
    window.addEventListener("trial-updated", load);
    const timer = window.setInterval(load, 60000);
    return () => {
      window.clearInterval(timer);
      abort.abort();
      window.removeEventListener("trial-updated", load);
    };
  }, []);
  return counts && counts.new + counts.review > 0 ? (
    <span
      className="badge purple"
      title={`${counts.new} neue Anfragen, ${counts.review} Bewertungen offen`}
    >
      {counts.new + counts.review}
    </span>
  ) : null;
}
export function TrialParticipantActions({
  participant,
  base,
  onMarked,
  name,
}: {
  participant: {
    id: string;
    player_id: string;
    status: string;
    trial_request_id?: string | null;
  };
  base: string;
  name?: string;
  onMarked?: (id: string) => void;
}) {
  const [mark, setMark] = useState(false),
    [consent, setConsent] = useState(false),
    [marketing, setMarketing] = useState(false),
    [birthDate, setBirthDate] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (participant.trial_request_id)
    return (
      <Link
        className="trial-tag"
        href={`${base}/probetraining?request=${participant.trial_request_id}`}
      >
        {name ? `${name} · ` : ""}
        {["attended_auto", "attended_manual"].includes(participant.status)
          ? "Probetraining · Bewerten / Feedback"
          : "Probetraining · Feedback vorbereiten"}
      </Link>
    );
  if (participant.status !== "planned") return null;
  return (
    <div>
      {!mark ? (
        <button
          className="text-button"
          type="button"
          onClick={() => setMark(true)}
        >
          {name
            ? `${name}: als Probetraining kennzeichnen`
            : "Als Probetraining kennzeichnen"}
        </button>
      ) : (
        <div className="trial-form">
          <p>
            Die Teilnahme wird kostenlos und verbraucht keine Aboeinheit.
            Vorhandene Eltern- und Spielerdaten bleiben erhalten.
          </p>
          <label>
            Geburtsdatum, falls noch nicht hinterlegt
            <input
              type="date"
              min="2000-01-01"
              max={new Date().toISOString().slice(0, 10)}
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Zustimmung zur Termin- und Feedbackkommunikation sowie
            Datenschutzhinweis liegen vor.
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
            />
            Zusätzliche Angebotsmails wurden ausdrücklich erlaubt (optional).
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !consent}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await trialApi("team", {
                  action: "mark",
                  participant_id: participant.id,
                  birth_date: birthDate || undefined,
                  operational_consent: consent,
                  marketing_consent: marketing,
                });
                onMarked?.(r.id);
                window.dispatchEvent(new Event("trial-updated"));
                setMark(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Probetraining übernehmen
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function TrialTeam() {
  const [data, setData] = useState<{
      rows: TrialRow[];
      events: { id: string; title: string; starts_at: string }[];
      staff: { id: string; display_name: string }[];
    } | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("new"),
    [selected, setSelected] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/probetraining/team", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData(d);
      window.dispatchEvent(new Event("trial-updated"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    setSelected(
      new URLSearchParams(window.location.search).get("request") ?? "",
    );
    void load();
  }, [load]);
  if (!data)
    return (
      <section className="panel">
        <h1>Probetraining</h1>
        <p role={error ? "alert" : undefined}>
          {error || "Anfragen werden geladen …"}
        </p>
      </section>
    );
  const needsReview = (r: TrialRow) =>
    !!r.confirmed_at && !r.academy_ready && r.status !== "closed";
  const fresh = data.rows.filter((r) =>
    ["new", "contacted"].includes(r.status),
  );
  const review = data.rows.filter(needsReview);
  const planned = data.rows.filter((r) => r.status === "planned");
  const visible = selected
    ? data.rows.filter((r) => r.id === selected)
    : data.rows.filter((r) =>
        tab === "planned"
          ? r.status === "planned"
          : tab === "review"
            ? needsReview(r)
            : tab === "new"
              ? ["new", "contacted"].includes(r.status)
              : true,
      );
  return (
    <section>
      <div className="page-heading">
        <h1>Probetraining</h1>
        <p>Vom ersten Kontakt bis zum persönlichen Feedback.</p>
        <a
          className="secondary-button"
          href="/probetraining"
          target="_blank"
          rel="noreferrer"
        >
          Anfrageformular öffnen
        </a>
      </div>
      <div className="trial-toolbar">
        {[
          ["new", `Neue Anfragen (${fresh.length})`],
          ["planned", `Geplante Teilnehmer (${planned.length})`],
          ["review", `Teilnehmer bewerten (${review.length})`],
          ["all", "Alle Anfragen"],
        ].map(([value, label]) => (
          <button
            className={
              tab === value && !selected ? "primary-button" : "secondary-button"
            }
            key={value}
            onClick={() => {
              setTab(value);
              setSelected("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="trial-grid">
        {visible.map((r) => (
          <TrialTeamCard
            key={`${r.id}:${r.event_id}:${r.academy_ready}`}
            row={r}
            events={data.events}
            staff={data.staff ?? []}
            refresh={load}
          />
        ))}
      </div>
      {!visible.length && <p>Hier gibt es aktuell keine offenen Einträge.</p>}
    </section>
  );
}
function TrialTeamCard({
  row: r,
  events,
  staff,
  refresh,
}: {
  row: TrialRow;
  staff: { id: string; display_name: string }[];
  events: { id: string; title: string; starts_at: string }[];
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [noteStatus, setNoteStatus] = useState(r.status);
  useEffect(() => setNoteStatus(r.status), [r.status]);
  async function action(input: unknown) {
    setBusy(true);
    setError("");
    try {
      await trialApi("team", input);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="trial-card trial-player-card">
      <div className="trial-player-cover">
        <span>PROACADEMY · PROBETRAINING</span>
        <div className="trial-avatar">
          {r.first_name[0]}
          {r.last_name[0]}
        </div>
      </div>
      <h2>
        {r.first_name} {r.last_name}
      </h2>
      <span
        className={`trial-tag ${r.confirmed_at && !r.academy_ready ? "trial-pending" : ""}`}
      >
        {r.converted_player_id
          ? "Ins Spielerprofil übernommen"
          : r.confirmed_at && !r.academy_ready
            ? "Bewertung offen"
            : r.academy_ready
              ? "Feedback freigegeben"
              : r.status === "planned"
                ? "Eingeplant"
                : r.status === "closed"
                  ? "Abgeschlossen"
                  : "Kontakt / Anfrage"}
      </span>
      <p className="trial-owner">
        Betreuung: <strong>{r.assigned_name || "Noch nicht übernommen"}</strong>
      </p>
      <details
        className="trial-card-details"
        open={
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).has("request")
        }
      >
        <summary>Profil, Termin und Aktionen öffnen</summary>
        <form
          className="trial-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action({
              action: "owner",
              request_id: r.id,
              assigned_to: new FormData(e.currentTarget).get("assigned_to"),
            });
          }}
        >
          <label>
            Zuständiger Mitarbeiter
            <select
              name="assigned_to"
              required
              defaultValue={r.assigned_to ?? ""}
            >
              <option value="" disabled>
                Mitarbeiter wählen
              </option>
              {staff.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button" disabled={busy}>
            Betreuung übernehmen / zuweisen
          </button>
        </form>
        {r.attendance === "planned" &&
          r.ends_at &&
          new Date(r.ends_at).getTime() <= Date.now() &&
          r.event_status === "scheduled" && (
            <div className="trial-attendance-task">
              <h3>Teilnahme manuell bestätigen</h3>
              <p>
                Für Probetraining-Kinder erfolgt keine automatische Bestätigung.
              </p>
              {(
                [
                  ["attended_manual", "Teilgenommen"],
                  ["absent", "Nicht erschienen"],
                  ["excused", "Entschuldigt"],
                ] as const
              ).map(([status, label]) => (
                <button
                  className="secondary-button"
                  key={status}
                  disabled={busy}
                  onClick={() =>
                    void action({
                      action: "attendance",
                      request_id: r.id,
                      status,
                    })
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        <TrialProfileEditor row={r} busy={busy} save={action} />
        <p>
          Geboren: {formatDate(`${r.birth_date}T12:00:00Z`)}
          <br />
          Verein: {r.club || "Nicht angegeben"}
        </p>
        <p>
          <strong>{r.parent_name}</strong>
          <br />
          <a href={`mailto:${r.email}`}>{r.email}</a>
          <br />
          {r.phone ? (
            <a href={`tel:${r.phone.replace(/[^+\d]/g, "")}`}>{r.phone}</a>
          ) : (
            "Telefonnummer beim Elternteil erfragen"
          )}
          <br />
          {r.email_verified
            ? "E-Mail bestätigt"
            : "E-Mail-Bestätigung ausstehend"}
        </p>
        <p>
          Standortwunsch: {r.preferred_location || "Offen"}
          <br />
          {r.availability}
        </p>
        {r.starts_at && (
          <p>
            <strong>{r.event_title}</strong>
            <br />
            {formatDate(r.starts_at)} · {formatTime(r.starts_at)} Uhr
            <br />
            {r.location_name} · {r.coach_name}
            <br />
            Teilnahme: {STATUS_LABELS[r.attendance as Attendance] ?? "Offen"}
          </p>
        )}
        {!r.confirmed_at && r.status !== "closed" && (
          <form
            className="trial-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action({
                action: "assign",
                request_id: r.id,
                event_id: f.get("event"),
              });
            }}
          >
            <label>
              Telefonisch vereinbarten Termin zuordnen
              <select name="event" required defaultValue="">
                <option value="" disabled>
                  Bestehendes Training auswählen
                </option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {formatDate(e.starts_at)} {formatTime(e.starts_at)} ·{" "}
                    {e.title}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={busy} className="primary-button">
              Spieler zum Training hinzufügen
            </button>
          </form>
        )}
        <form
          className="trial-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action({
              action: "note",
              request_id: r.id,
              note: f.get("note"),
              status: ["planned", "attended"].includes(noteStatus)
                ? "contacted"
                : noteStatus,
            });
          }}
        >
          <label>
            Interne Gesprächsnotiz
            <textarea name="note" defaultValue={r.team_note} maxLength={2000} />
          </label>
          <label>
            Bearbeitungsstand
            <select
              name="status"
              value={noteStatus}
              onChange={(e) => setNoteStatus(e.target.value)}
            >
              {["planned", "attended"].includes(r.status) ? (
                <option value={r.status} disabled>
                  {r.status === "attended"
                    ? "Teilgenommen"
                    : "Training geplant"}
                </option>
              ) : (
                <>
                  <option value="new">Neu</option>
                  <option value="contacted">Kontakt aufgenommen</option>
                </>
              )}
              <option value="closed">Kein Interesse / abgeschlossen</option>
            </select>
          </label>
          <button disabled={busy} className="secondary-button">
            Notiz speichern
          </button>
        </form>
        {r.event_id && (
          <form
            className="trial-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action({
                action: "review",
                request_id: r.id,
                event_id: r.event_id,
                rating: Number(f.get("rating")),
                feedback: f.get("feedback"),
                ready: f.get("ready") === "on",
              });
            }}
          >
            <h3>Academy-Feedback für die Eltern</h3>
            <label>
              Eindruck vom Probetraining
              <select
                name="rating"
                required
                defaultValue={r.academy_rating ?? ""}
              >
                <option value="" disabled>
                  Bewertung wählen
                </option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} von 5
                  </option>
                ))}
              </select>
            </label>
            <label>
              Persönliche Beobachtung und nächster Schritt
              <textarea
                name="feedback"
                minLength={3}
                maxLength={2000}
                required
                defaultValue={r.academy_feedback ?? ""}
                placeholder="Dieses Feedback wird den Eltern angezeigt und in die erste Mail übernommen."
              />
            </label>
            <label className="checkbox-label">
              <input
                name="ready"
                type="checkbox"
                disabled={!r.confirmed_at}
                defaultChecked={r.academy_ready}
              />
              Für Eltern und Feedbackmail freigeben
            </label>
            {!r.confirmed_at && (
              <p>
                Vor der Teilnahmebestätigung wird das Feedback als Entwurf
                gespeichert.
              </p>
            )}
            <button disabled={busy} className="primary-button">
              Bewertung speichern
            </button>
          </form>
        )}
        {r.parent_rating && (
          <div>
            <h3>Rückmeldung der Eltern: {r.parent_rating}/5</h3>
            <p className="trial-feedback">
              {r.parent_feedback || "Keine zusätzliche Nachricht"}
            </p>
            {r.parent_rating <= 2 && (
              <p className="error-message">
                Bitte persönlich nachfassen. Weitere Angebotsmails sind
                pausiert.
              </p>
            )}
          </div>
        )}
        {r.subscribed && (
          <span className="trial-tag">Abo vorhanden · keine Angebotsfolge</span>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </details>
    </article>
  );
}

function TrialProfileEditor({
  row: r,
  busy,
  save,
}: {
  row: TrialRow;
  busy: boolean;
  save: (body: unknown) => Promise<void>;
}) {
  return (
    <details>
      <summary>Spielerangaben bearbeiten</summary>
      {r.converted_player_id ? (
        <p>Das reguläre Spielerprofil ist bereits vorhanden.</p>
      ) : (
        <form
          className="trial-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save({
              action: "profile",
              request_id: r.id,
              ...Object.fromEntries(f),
              height_cm: f.get("height_cm") ? Number(f.get("height_cm")) : null,
            });
          }}
        >
          {(
            [
              ["first_name", "Vorname", r.first_name],
              ["last_name", "Nachname", r.last_name],
              ["birth_date", "Geburtsdatum", r.birth_date],
              ["team", "Team / Altersklasse", r.team],
              ["club", "Verein", r.club],
              ["position", "Position", r.position],
              ["height_cm", "Größe (cm)", r.height_cm],
            ] as const
          ).map(([key, label, value]) => (
            <label key={key}>
              {label}
              {["first_name", "last_name", "birth_date"].includes(key)
                ? " *"
                : ""}
              <input
                name={key}
                defaultValue={value ?? ""}
                type={
                  key === "birth_date"
                    ? "date"
                    : key === "height_cm"
                      ? "number"
                      : "text"
                }
                required={["first_name", "last_name", "birth_date"].includes(
                  key,
                )}
                maxLength={120}
              />
            </label>
          ))}
          <label>
            Geschlecht
            <select name="gender" defaultValue={r.gender ?? ""}>
              {["", "männlich", "weiblich", "divers"].map((v) => (
                <option value={v} key={v}>
                  {v || "Keine Angabe"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Starker Fuß
            <select name="strong_foot" defaultValue={r.strong_foot ?? ""}>
              {["", "rechts", "links", "beidfüßig"].map((v) => (
                <option value={v} key={v}>
                  {v || "Keine Angabe"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Entwicklungsziele
            <textarea
              name="development_goals"
              maxLength={2000}
              defaultValue={r.development_goals ?? ""}
            />
          </label>
          <button className="primary-button" disabled={busy}>
            Spielerprofil speichern
          </button>
        </form>
      )}
      <details>
        <summary>Ursprüngliche Angaben</summary>
        <p>
          Vorname: {String(r.original_data?.first_name ?? r.first_name)} ·
          Nachname: {String(r.original_data?.last_name ?? r.last_name)} ·
          Geburtsdatum:{" "}
          {String(
            r.original_data?.birth_date ??
              r.original_data?.camp_birth_date ??
              r.birth_date,
          )}
        </p>
      </details>
    </details>
  );
}
export function TrialDashboard({ base }: { base: string }) {
  const [rows, setRows] = useState<TrialRow[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      fetch("/api/probetraining/team", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (r) => {
          if (!r.ok) throw Error("Aufgaben konnten nicht geladen werden");
          return r.json();
        })
        .then((d) => {
          setRows(d.rows);
          setError("");
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    load();
    window.addEventListener("trial-updated", load);
    const timer = setInterval(load, 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("trial-updated", load);
    };
  }, []);
  const tasks = rows.flatMap((r) => {
    if (r.status === "closed") return [];
    const action =
      r.attendance === "planned" &&
      r.ends_at &&
      Date.parse(r.ends_at) < Date.now() &&
      r.event_status === "scheduled"
        ? "Teilnahme bestätigen"
        : r.confirmed_at && !r.academy_ready
          ? "Coachfeedback freigeben"
          : ["new", "contacted"].includes(r.status)
            ? "Kontakt / Termin abstimmen"
            : r.parent_rating && r.parent_rating <= 2
              ? "Elternfeedback persönlich klären"
              : null;
    return action ? [{ r, action }] : [];
  });
  return (
    <details className="panel trial-dashboard">
      <summary>
        <strong>Probetraining</strong>{" "}
        <span className="badge">{tasks.length} offene Aktionen</span>
      </summary>
      {error && <p role="alert">{error}</p>}
      {!tasks.length && !error && <p>Aktuell keine offenen Aufgaben.</p>}
      {tasks.map(({ r, action }) => (
        <div key={r.id} className="trial-task">
          <strong>
            {r.first_name} {r.last_name}
          </strong>
          <Link href={`${base}/probetraining?request=${r.id}`}>{action} →</Link>
          <details>
            <summary aria-label={`Information zu ${r.first_name}`}>
              ⓘ Info
            </summary>
            <p>
              Betreuung: {r.assigned_name || "Noch offen"}
              <br />
              {r.event_title || "Termin offen"}
              <br />
              {r.parent_name} · {r.phone}
              <br />
              {r.team_note || "Keine interne Notiz"}
            </p>
          </details>
        </div>
      ))}
    </details>
  );
}
