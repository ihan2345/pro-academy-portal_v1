import type { ProfileFinances } from "@/lib/server/parent-profile-finances";
import type { ProfileSubscriptions } from "@/lib/server/profile-subscription-summary";
import { formatDate } from "@/lib/domain";
import { childCardTheme } from "@/lib/parent-profile";
import { DESIGN_2026 } from "@/design-2026/flag";

const statuses = {
  succeeded: "Erfolgreich",
  pending: "Ausstehend",
  failed: "Fehlgeschlagen",
  refunded: "Erstattet",
  partial_refund: "Teilweise erstattet",
  disputed: "Angefochten",
};
const subscriptionStatuses: Record<string, string> = {
  active: "Aktiv",
  canceled: "Gekündigt",
  past_due: "Zahlung überfällig",
  unpaid: "Unbezahlt",
  paused: "Pausiert",
  trialing: "Testphase",
  incomplete: "Unvollständig",
  incomplete_expired: "Abgelaufen",
};
const methods: Record<string, string> = {
  card: "Karte",
  paypal: "PayPal",
  klarna: "Klarna",
  sepa_debit: "SEPA-Lastschrift",
  link: "Link",
  amazon_pay: "Amazon Pay",
};
const date = (value: string) =>
  formatDate(value, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export function ProfileSubscriptionStatus({
  data,
}: {
  data?: ProfileSubscriptions;
}) {
  if (!data?.complete)
    return (
      <aside className="profile-subscription-summary">
        <strong>Abo-Status derzeit nicht vollständig verfügbar</strong>
        <span>Bitte die Finanzübersicht erneut aktualisieren.</span>
      </aside>
    );
  if (DESIGN_2026 && data.active.length)
    // Design 2026: jedes aktive Abo als Karte in der Farbe der Spielerkarten.
    return (
      <div className="profile-subscription-cards" aria-label="Abo-Status">
        {data.active.map((sub) => (
          <aside
            key={sub.id}
            className={`premium-child profile-subscription-card ${childCardTheme(sub.names)}`}
          >
            <small className="profile-muted">Aktives Abo</small>
            <strong className="profile-product">
              {sub.names.join(" · ") || "Abo ohne Tarifname"}
            </strong>
            {sub.cancel_at && (
              <small className="profile-muted">
                Gekündigt zum {formatDate(sub.cancel_at)}
              </small>
            )}
          </aside>
        ))}
      </div>
    );
  return (
    <aside className="profile-subscription-summary" aria-label="Abo-Status">
      <strong>{data.active.length ? "Aktives Abo" : "Kein aktives Abo"}</strong>
      {data.active.map((sub) => (
        <div key={sub.id}>
          <span>{sub.names.join(" · ") || "Abo ohne Tarifname"}</span>
          {sub.cancel_at && (
            <small>Gekündigt zum {formatDate(sub.cancel_at)}</small>
          )}
        </div>
      ))}
      {!data.active.length &&
        (data.previous ? (
          <div>
            <span>
              Letztes aktives Abo:{" "}
              <b>
                {data.previous.names.join(" · ") || "Tarifname nicht verfügbar"}
              </b>
            </span>
            <small>
              {subscriptionStatuses[data.previous.status] ??
                data.previous.status}
              {data.previous.ended_at
                ? ` · beendet am ${formatDate(data.previous.ended_at)}`
                : ""}
            </small>
            <small>
              Kündigungsgrund:{" "}
              {data.previous.cancellation_reason ||
                "In Stripe nicht hinterlegt"}
            </small>
          </div>
        ) : (
          <span>Kein früheres aktives Abo belegt.</span>
        ))}
    </aside>
  );
}
export function ProfileStripePayments({
  data,
  money,
}: {
  data: ProfileFinances;
  money: (amount: number, currency: string) => string;
}) {
  if (!data.payments)
    return (
      <p>Zahlungsdetails sind derzeit nicht verfügbar. Bitte aktualisieren.</p>
    );
  if (!data.payments.length) return <p>Keine Stripe-Zahlungen gefunden.</p>;
  return (
    <>
      <div
        className="profile-payment-table"
        role="region"
        aria-label="Stripe-Zahlungen"
        tabIndex={0}
      >
        <table>
          <caption className="sr-only">
            Zahlungshistorie aus Stripe, neueste Zahlung zuerst
          </caption>
          <thead>
            <tr>
              <th scope="col">Betrag</th>
              <th scope="col">Status</th>
              <th scope="col">Beschreibung</th>
              <th scope="col">Datum</th>
              <th scope="col">Zahlungsart</th>
            </tr>
          </thead>
          <tbody>
            {data.payments.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{money(p.amount, p.currency)}</strong>
                  <small>
                    {p.currency.toUpperCase()}
                    {p.refunded > 0
                      ? ` · ${money(p.refunded, p.currency)} erstattet`
                      : ""}
                  </small>
                </td>
                <td>
                  <span className={`profile-payment-status ${p.status}`}>
                    {statuses[p.status]}
                  </span>
                </td>
                <td>{p.description}</td>
                <td>{p.created_at ? date(p.created_at) : "Nicht verfügbar"}</td>
                <td>{p.method ? (methods[p.method] ?? p.method) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small>
        {data.payments.length}{" "}
        {data.payments.length === 1 ? "Zahlung" : "Zahlungen"} · Fehlgeschlagene
        und ausstehende Zahlungen zählen nicht zum vereinnahmten Umsatz.
      </small>
    </>
  );
}
