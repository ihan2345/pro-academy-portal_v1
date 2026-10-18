"use client";
import { useEffect, useState } from "react";
import { formatDate } from "@/lib/domain";
import type { StripeParentInputs as Inputs } from "@/lib/stripe-parent-inputs";

export function StripeParentInputs({
  customer,
  subscription,
}: {
  customer: string;
  subscription?: string;
}) {
  const [data, setData] = useState<Inputs | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    setError("");
    const query = new URLSearchParams({
      customer,
      ...(subscription ? { subscription } : {}),
    });
    fetch(`/api/admin/stripe-parent-inputs?${query}`, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok)
          throw Error(
            "Die Elternangaben aus Stripe konnten nicht geladen werden.",
          );
        return response.json();
      })
      .then((value) => {
        if (!abort.signal.aborted) setData(value);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError(
            "Die Elternangaben aus Stripe konnten nicht geladen werden.",
          );
      });
    return () => abort.abort();
  }, [customer, subscription, revision]);
  return (
    <section
      aria-label="Elternangaben aus Stripe"
      style={{
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: 16,
        minWidth: 0,
        overflowWrap: "anywhere",
      }}
    >
      <h3>Von Eltern im Stripe-Formular angegeben</h3>
      <p>
        Originalangaben aus abgeschlossenen Buchungen
        {subscription ? " dieses Abos" : " dieses Kunden"}. Sie dienen zur
        Prüfung und ändern keine Zuordnung.
      </p>
      {!data && !error && <p role="status">Elternangaben werden geladen …</p>}
      {error && <p role="alert">{error}</p>}
      {data?.partial && (
        <p role="status">
          Die Angaben sind noch nicht vollständig geladen. Bitte erneut
          versuchen.
        </p>
      )}
      {(error || data?.partial) && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => setRevision((n) => n + 1)}
        >
          Elternangaben erneut laden
        </button>
      )}
      {data && !data.partial && !data.entries.length && (
        <p>
          Für {subscription ? "dieses Abo" : "diesen Kunden"} sind in den
          abgeschlossenen Stripe-Buchungen keine Zusatzfelder hinterlegt.
        </p>
      )}
      {data?.entries.map((entry) => (
        <div key={entry.sessionId} style={{ marginTop: 16 }}>
          <p>
            <strong>Buchung vom {formatDate(entry.submittedAt)}</strong>
            {!subscription && entry.subscriptionId && (
              <> · Abo {entry.subscriptionId}</>
            )}
          </p>
          <dl>
            {entry.fields.map((field) => (
              <div key={field.key} style={{ marginTop: 10 }}>
                <dt>
                  <strong>{field.label}</strong>
                </dt>
                <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {field.value === null || field.value === ""
                    ? "Nicht ausgefüllt"
                    : field.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}
