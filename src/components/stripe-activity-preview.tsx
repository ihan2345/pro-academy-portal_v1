"use client";
import { useEffect, useState } from "react";
import type { Activity, ActivityPage } from "@/lib/activities";
import { ActivityRows } from "./activities";

export function StripeActivityPreview() {
  const [week, setWeek] = useState(false);
  const [asOf, setAsOf] = useState(() => new Date().toISOString());
  const [rows, setRows] = useState<Activity[]>([]);
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
      scope: "stripe",
      window: week ? "week" : "all",
      limit: week ? "50" : "3",
      asOf,
      ...(cursor ? { cursor } : {}),
    });
    fetch(`/api/activities?${query}`, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json() as Promise<ActivityPage>;
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
        {week ? "Letzte 7 Tage" : "Die letzten 3 Aktivitäten"} · Abo-Abgleiche,
        Paketänderungen und Zuordnungen. Ein rotes Achtung-Icon zeigt offenen
        Handlungsbedarf.
      </p>
      <ActivityRows rows={rows} />
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
