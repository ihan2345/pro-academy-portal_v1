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
  const fresh = data.rows.filter((r) => r.status === "new");
  const review = data.rows.filter(needsReview);
  const visible = selected
    ? data.rows.filter((r) => r.id === selected)
    : data.rows.filter((r) =>
        tab === "review"
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
  refresh,
}: {
  row: TrialRow;
  events: { id: string; title: string; starts_at: string }[];
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
    <article className="trial-card">
      <h2>
        {r.first_name} {r.last_name}
      </h2>
      <span
        className={`trial-tag ${r.confirmed_at && !r.academy_ready ? "trial-pending" : ""}`}
      >
        {r.confirmed_at && !r.academy_ready
          ? "Bewertung offen"
          : r.academy_ready
            ? "Feedback freigegeben"
            : r.status === "planned"
              ? "Eingeplant"
              : r.status === "closed"
                ? "Abgeschlossen"
                : "Kontakt / Anfrage"}
      </span>
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
          <button
            disabled={busy || !r.email_verified}
            className="primary-button"
          >
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
            status: f.get("status"),
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
            defaultValue={
              r.status === "closed"
                ? "closed"
                : r.status === "new"
                  ? "new"
                  : "contacted"
            }
          >
            <option value="new">Neu</option>
            <option value="contacted">Kontakt aufgenommen</option>
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
              Bitte persönlich nachfassen. Weitere Angebotsmails sind pausiert.
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
    </article>
  );
}
