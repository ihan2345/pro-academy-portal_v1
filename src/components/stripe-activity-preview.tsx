"use client";
import { useEffect, useState } from "react";
import type {
  StripeActivity,
  StripeActivityPage,
} from "@/lib/stripe-activities";
import Link from "next/link";
import { TriangleAlert, CheckCircle2, Circle } from "lucide-react";
import { formatDate, formatTime } from "@/lib/domain";

export function StripeActivityPreview() {
  const [week, setWeek] = useState(false);
  const [asOf, setAsOf] = useState(() => new Date().toISOString());
  const [rows, setRows] = useState<StripeActivity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      window: week ? "week" : "all",
      limit: week ? "50" : "3",
      asOf,
      ...(cursor ? { cursor } : {}),
    });
    fetch(`/api/admin/stripe-activities?${query}`, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json() as Promise<StripeActivityPage>;
      })
      .then((page) => {
        if (abort.signal.aborted) return;
        setRows((old) => (cursor ? [...old, ...page.rows] : page.rows));
        setNext(page.next);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("Stripe-Aktivitäten konnten nicht geladen werden.");
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [week, asOf, cursor, retry]);
  function reset(showWeek: boolean) {
    setRows([]);
    setCursor(null);
    setNext(null);
    setLoading(true);
    setWeek(showWeek);
    setAsOf(new Date().toISOString());
  }
  return (
    <section
      className="panel"
      aria-label="Stripe-Aktivitäten"
      style={{ padding: 24, marginBottom: 24 }}
    >
      <h2>Stripe-Aktivitäten</h2>
      <p className="profile-muted">
        {week ? "Letzte 7 Tage" : "Die letzten 3 Aktivitäten"} ·
        Originalereignisse von Stripe. Zuordnungsstatus: aktueller Stand im
        Portal.
      </p>
      <ol className="activity-list">
        {rows.map((row) => (
          <li key={row.id} className="activity-entry">
            {row.actionRequired ? (
              <TriangleAlert
                size={19}
                style={{ color: "#c62828" }}
                aria-label="Aktion erforderlich"
              />
            ) : row.assignment === "assigned" ? (
              <CheckCircle2
                size={19}
                style={{ color: "#377240" }}
                aria-hidden="true"
              />
            ) : (
              <Circle size={19} aria-hidden="true" />
            )}
            <div>
              <h3>{row.title}</h3>
              <strong className="activity-subject">{row.customer}</strong>
              <p>
                <strong>
                  {
                    {
                      assigned: "Bereits zugeordnet",
                      unassigned: "Noch nicht zugeordnet",
                      partial: "Teilweise zugeordnet",
                      not_applicable: "Keine Abo-Zuordnung erforderlich",
                    }[row.assignment]
                  }
                </strong>
                {!!row.children.length && ` · ${row.children.join(" · ")}`}
              </p>
              {!!row.trialCandidates?.length && (
                <p
                  style={{
                    background: "#97E9E5",
                    padding: 10,
                    borderRadius: 8,
                  }}
                >
                  Mögliche Übernahme aus Probetraining:{" "}
                  {row.trialCandidates.join(" · ")}. Vorhandene Angaben können
                  bei der Abo-Zuordnung übernommen werden.
                </p>
              )}
              <small>
                <time dateTime={row.at}>
                  {formatDate(row.at)} · {formatTime(row.at)}
                </time>{" "}
                · Stripe
              </small>
              {row.actionRequired && (
                <p style={{ color: "#c62828" }}>
                  Aktion erforderlich
                  {row.href && (
                    <>
                      {" "}
                      · <Link href={row.href}>{row.actionLabel} →</Link>
                    </>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!loading && !error && !rows.length && (
        <p>
          Keine Stripe-Aktivitäten{week ? " in den letzten 7 Tagen" : ""}{" "}
          vorhanden.
        </p>
      )}
      {loading && <p role="status">Aktivitäten werden geladen …</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className="secondary-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Erneut versuchen
          </button>
        </p>
      )}
      <div
        style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}
      >
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => reset(!week)}
        >
          {week
            ? "Zurück zu den letzten 3"
            : "Stripe-Aktivitäten der letzten 7 Tage"}
        </button>
        {week && next && !error && (
          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={() => setCursor(next)}
          >
            Weitere Aktivitäten laden
          </button>
        )}
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => reset(week)}
        >
          Aktualisieren
        </button>
      </div>
    </section>
  );
}
