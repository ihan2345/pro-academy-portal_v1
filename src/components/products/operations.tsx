"use client";
import { useEffect, useState } from "react";
import { productRequest } from "./shared";
const labels: Record<string, string> = {
  reserved: "Kaufstart vorbereitet",
  checkout: "Checkout offen",
  fulfilled: "Buchung zugeordnet",
  review: "Prüfung erforderlich",
  failed: "Fehlgeschlagen – Status prüfen",
  expired: "Abgelaufen",
  refunded: "Erstattet",
  scheduled: "Vorgemerkt",
  pending_payment: "Zahlung offen",
  processing: "Wird verarbeitet",
  booked: "Gebucht",
  delivered: "Erbracht",
};
export function ProductOperations({ admin = false }: { admin?: boolean }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [after, setAfter] = useState<string | null>(null),
    [reason, setReason] = useState("");
  const base = admin ? "/api/admin/products" : "/api/products";
  async function load() {
    const q = after ? `?after=${after}` : "";
    setData(
      await productRequest(`${base}/${admin ? "operations" : "orders"}${q}`),
    );
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [after]);
  async function action(id: string, action: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    try {
      const r = await productRequest(
        `${base}/orders/${id}/${action}`,
        "POST",
        body,
      );
      if (r.url) {
        const u = new URL(r.url);
        if (u.origin !== "https://checkout.stripe.com")
          throw Error("Ungültiger Checkout-Link");
        window.location.assign(r.url);
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return error ? <p role="alert">{error}</p> : null;
  const health = data.processing;
  return (
    <details className="panel product-operations">
      <summary>
        {admin
          ? "Bestellungen, Tarifwechsel & Zahlungsbetrieb"
          : "Meine Buchungen und offenen Käufe"}
      </summary>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {health && (
        <p role="status">
          Stripe-Verbindung ({health.livemode ? "Live" : "Test"}):{" "}
          {health.stripe_connected ? "verbunden" : "nicht verbunden"} ·
          Automatischer Ereignisabruf:{" "}
          {health.worker_active ? "aktiv" : "nicht aktiv / prüfen"} · Webhook:{" "}
          {health.webhook_configured
            ? "konfiguriert"
            : "optional, nicht verbunden"}
          . Produktzahlungen:{" "}
          {health.payments_enabled ? "aktiviert" : "deaktiviert"}.{" "}
          {health.last_poll_at &&
            `Letzter erfolgreicher Abruf: ${new Date(health.last_poll_at).toLocaleString("de-DE")}`}
        </p>
      )}
      <button
        className="secondary-button"
        disabled={busy}
        onClick={() => void load().catch((e) => setError(e.message))}
      >
        Status aktualisieren
      </button>
      {admin && (
        <label>
          Begründung für erneute Prüfung / Leistungsbearbeitung
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={5}
          />
        </label>
      )}
      {!data.rows.length && <p>Keine Kaufaufträge vorhanden.</p>}
      {data.rows.map((o: any) => (
        <article key={o.id} className="product-operation-row">
          <strong>{o.name}</strong>
          <p>
            {o.family}
            {o.child ? ` · ${o.child}` : ""} · {labels[o.status] ?? o.status}
          </p>
          {o.reason && <p>{o.reason}</p>}
          {!admin && ["reserved", "checkout", "failed"].includes(o.status) && (
            <>
              <button
                disabled={busy}
                onClick={() => void action(o.id, "resume")}
              >
                Checkout fortsetzen / Zahlung prüfen
              </button>
              <button
                disabled={busy}
                onClick={() => void action(o.id, "cancel")}
              >
                Offenen Checkout sicher beenden
              </button>
            </>
          )}
          {admin &&
            ["review", "checkout", "failed", "paid"].includes(o.status) && (
              <button
                disabled={busy || reason.trim().length < 5}
                onClick={() => void action(o.id, "reconcile", { reason })}
              >
                Mit Stripe erneut prüfen
              </button>
            )}
          {admin && ["reserved", "checkout", "failed"].includes(o.status) && (
            <button disabled={busy} onClick={() => void action(o.id, "cancel")}>
              Unbezahlten Checkout sicher beenden
            </button>
          )}
          {o.kind === "other" && o.status === "fulfilled" && o.service && (
            <p>
              Leistung:{" "}
              {labels[o.service.service_status] ?? o.service.service_status}{" "}
              {o.service.service_note && `· ${o.service.service_note}`}
            </p>
          )}
          {admin && o.kind === "other" && o.status === "fulfilled" && (
            <select
              aria-label={`Leistungsstatus für ${o.name}`}
              value={o.service?.service_status ?? "booked"}
              disabled={busy || reason.trim().length < 5}
              onChange={(e) =>
                void action(o.id, "service", {
                  status: e.target.value,
                  note: reason,
                })
              }
            >
              <option value="booked">Gebucht</option>
              <option value="scheduled">Termin vereinbart</option>
              <option value="delivered">Erbracht</option>
            </select>
          )}
        </article>
      ))}
      {data.next && (
        <button onClick={() => setAfter(data.next)}>
          Weitere Kaufaufträge
        </button>
      )}
      {after && (
        <button onClick={() => setAfter(null)}>Zur ersten Seite</button>
      )}
      {admin &&
        data.changes?.map((c: any) => (
          <p key={c.id}>
            Tarifwechsel {c.preview?.player_name}: {c.preview?.current_name} →{" "}
            {c.preview?.target_name} · {labels[c.status] ?? c.status}
            {c.reason && ` · ${c.reason}`}
            <button
              disabled={busy || reason.trim().length < 5}
              onClick={() => {
                setBusy(true);
                setError("");
                void productRequest(
                  `${base}/changes/${c.id}/reconcile`,
                  "POST",
                  { reason },
                )
                  .then(load)
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Wechsel mit Stripe erneut prüfen
            </button>
          </p>
        ))}
      {admin &&
        data.events?.map((e: any) => (
          <p role="alert" key={e.id}>
            {e.type}: Verarbeitung fehlgeschlagen ({e.attempts} Versuche).{" "}
            {e.last_error} Nächste Wiederholung:{" "}
            {new Date(e.available_at).toLocaleString("de-DE")}
          </p>
        ))}
      {admin &&
        data.payments?.map((p: any) => (
          <p key={p.id}>
            Zahlungsprüfung {p.invoice_id || p.payment_intent_id} ·{" "}
            {labels[p.status] ?? p.status} · {p.reason}
            <button
              disabled={busy || reason.trim().length < 5}
              onClick={() => {
                setBusy(true);
                setError("");
                void productRequest(
                  `${base}/payments/${p.id}/resolve`,
                  "POST",
                  { reason },
                )
                  .then(load)
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Zahlungsprüfung dokumentiert abschließen
            </button>
            <small>
              Dokumentiert die fachliche Klärung. Erstattungen bleiben
              gespeichert; Verträge und Trainingseinheiten werden dadurch nicht
              geändert.
            </small>
          </p>
        ))}
    </details>
  );
}
