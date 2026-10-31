"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, RefreshCw, CheckCircle2, Gift, ArrowRight } from "lucide-react";
import { productRequest } from "./shared";
import { GiftCardArtwork } from "./gift-artwork";
import { giftMoney } from "@/lib/gifts/domain";
import { giftExpiry } from "@/lib/gifts/artwork";
import "./gifts.css";
import "./gift-status.css";
export function GiftStatusView({
  order,
  onRefresh,
}: {
  order: any;
  onRefresh?: () => void;
}) {
  const [notice, setNotice] = useState("");
  const recipient = order.viewer === "recipient",
    paid = order.status === "issued",
    available = order.remaining ?? order.amount;
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Kopiert.");
    } catch {
      setNotice("Bitte den Text markieren und kopieren.");
    }
  }
  return (
    <article className="gift-status-window">
      <header className="gift-status-header">
        <a href="/produkte" className="gift-status-brand">
          PROACADEMY
        </a>
        <span>
          {recipient
            ? "Dein Gutschein & Guthaben"
            : "Dein Kauf- & Zahlungsstatus"}
        </span>
      </header>
      <div className="gift-status-content">
        <div className="gift-status-title">
          <div>
            <p className="gift-status-kicker">BESTELLSTATUS</p>
            <h1>
              {recipient
                ? available === 0 && paid
                  ? "Gemeinsam erlebt."
                  : "Dein Geschenk. Dein nächster Schritt."
                : "Danke fürs Verschenken."}
            </h1>
          </div>
          {onRefresh && (
            <button
              type="button"
              className="secondary-button"
              onClick={onRefresh}
              aria-label="Status aktualisieren"
            >
              <RefreshCw size={15} />
            </button>
          )}
        </div>
        <div className="gift-status-reference">
          <span>Bestellnummer</span>
          <code>{order.id}</code>
          <button
            type="button"
            aria-label="Bestellnummer kopieren"
            onClick={() => void copy(order.id)}
          >
            <Copy size={14} />
          </button>
        </div>
        <div className="gift-status-facts">
          <div>
            <small>
              {recipient
                ? "Ursprünglicher Geschenkwert"
                : "Gekaufter Geschenkwert"}
            </small>
            <strong>{giftMoney(order.initial_amount)}</strong>
          </div>
          {recipient && (
            <div>
              <small>Aktueller Restbetrag</small>
              <strong>{giftMoney(available)}</strong>
            </div>
          )}
          <div>
            <small>Zahlungsstatus</small>
            <strong className="gift-status-payment">
              {paid ? (
                <>
                  <CheckCircle2 size={16} />
                  Bestätigt
                </>
              ) : order.status === "refunded" ? (
                "Erstattet"
              ) : order.status === "review" ? (
                "In Prüfung"
              ) : order.status === "expired" ? (
                "Checkout abgelaufen"
              ) : (
                "Noch offen"
              )}
            </strong>
          </div>
        </div>
        {order.expires_at && (
          <p className="gift-status-validity">
            Einlösbar bis <strong>{giftExpiry(order.expires_at)}</strong> · Die
            ursprüngliche Gültigkeit seit dem Erwerb bleibt bestehen.
          </p>
        )}
        {order.reserved > 0 && (
          <p className="notice">
            {giftMoney(order.reserved)} sind für einen offenen Kauf reserviert.
            Ein abgebrochener Checkout verbraucht kein Guthaben; die Freigabe
            erfolgt nach bestätigtem Ablauf.
          </p>
        )}
        {order.code && paid ? (
          <>
            <GiftCardArtwork
              data={{
                amount: recipient ? order.remaining : order.initial_amount,
                code: order.code,
                recipient_name: `${order.recipient.first_name} ${order.recipient.last_name}`,
                sender_name: order.buyer_name,
                expires_at: order.expires_at,
              }}
            />
            <div className="gift-status-code">
              <div>
                <small>
                  {recipient
                    ? "Dein aktueller Geschenkcode"
                    : "Ursprünglicher Geschenkcode zum Weitergeben"}
                </small>
                <code>{order.code}</code>
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={() => void copy(order.code)}
              >
                <Copy size={15} />
                Code kopieren
              </button>
            </div>
          </>
        ) : recipient && paid ? (
          <div className="gift-status-empty">
            <Gift size={28} />
            <h2>
              {available === 0
                ? "Dein Guthaben ist vollständig eingelöst."
                : "Dein Gutschein ist derzeit nicht einlösbar."}
            </h2>
            <p>
              Die bisherigen Vorgänge bleiben in deiner Guthaben-Historie
              sichtbar.
            </p>
          </div>
        ) : paid ? (
          <p className="gift-status-private">
            Die beschenkte Person erhält einen eigenen, persönlichen Link für
            ihren aktuellen Code und die Guthaben-Historie.
          </p>
        ) : (
          <p>
            {order.status === "refunded"
              ? "Die Zahlung wurde erstattet; der Geschenkcode ist gesperrt."
              : order.status === "review"
                ? "Die Zahlung benötigt eine Prüfung. Bitte keinen zweiten Kauf starten."
                : order.status === "expired"
                  ? "Dieser Checkout ist abgelaufen. Es wurde keine Geschenkkarte freigegeben."
                  : "Die Geschenkkarte wird erst nach bestätigter Zahlung freigegeben. Bitte keinen zweiten Kauf starten, solange der Zahlungsstatus unklar ist."}
          </p>
        )}
        {order.checkout_url && (
          <a className="primary-button" href={order.checkout_url}>
            Checkout fortsetzen
            <ArrowRight size={15} />
          </a>
        )}
        {recipient && paid && (
          <>
            <div className="gift-status-history-heading">
              <h2>Deine Guthaben-Historie</h2>
              <span>
                {order.history?.length ?? 0}{" "}
                {order.history?.length === 1 ? "Einlösung" : "Einlösungen"}
              </span>
            </div>
            <div className="gift-status-history">
              <div className="gift-status-entry gift-status-acquired">
                <div>
                  <strong>Geschenkkarte erworben</strong>
                  <small>
                    {order.paid_at
                      ? new Date(order.paid_at).toLocaleDateString("de-DE", {
                          timeZone: "Europe/Berlin",
                        })
                      : "Kauf bestätigt"}
                  </small>
                </div>
                <strong>{giftMoney(order.initial_amount)}</strong>
              </div>
              {order.history?.map((h: any) => (
                <div
                  className="gift-status-entry"
                  key={`${h.order_id}:${h.state}`}
                >
                  <div>
                    <strong>{h.product_name}</strong>
                    <small>
                      {new Date(h.date).toLocaleString("de-DE", {
                        timeZone: "Europe/Berlin",
                      })}
                      {h.state === "returned"
                        ? " · Gutscheinanteil zurückgebucht"
                        : " · Erfolgreich eingelöst"}
                    </small>
                    <small className="gift-status-order">
                      Bestell-ID: {h.order_id}
                    </small>
                    <small>
                      Davor {giftMoney(h.before_balance)} → danach{" "}
                      {giftMoney(h.after_balance)}
                    </small>
                  </div>
                  <strong>
                    {h.state === "returned" ? "+" : "−"}
                    {giftMoney(h.used_amount)}
                  </strong>
                </div>
              ))}
            </div>
            <p className="gift-status-help">
              Nach jedem erfolgreichen Einsatz wird dein bisheriger Code
              ersetzt. Für verbleibendes Guthaben erscheint hier ein neuer Code;
              du erhältst dazu eine E-Mail. Bei 0 € wird kein weiterer Code
              ausgestellt.
            </p>
            <a className="primary-button" href="/produkte">
              Zum Shop
              <ArrowRight size={15} />
            </a>
          </>
        )}
        {!recipient && (
          <div className="gift-status-buyer-info">
            <h2>Dein Geschenk für {order.recipient.first_name}</h2>
            <p>
              Die Geschenkbenachrichtigung geht an {order.recipient.email}. Dein
              Link zeigt ausschließlich deine Kaufangaben; Verbrauchshistorie
              und spätere Restcodes erhält die beschenkte Person.
            </p>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
    </article>
  );
}
export function GiftStatusPage() {
  const [order, setOrder] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [hasLink, setHasLink] = useState(true),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const q = new URLSearchParams(location.search),
      id = q.get("order") ?? q.get("purchase"),
      key = q.get("key");
    if (!id || !key) {
      setHasLink(false);
      return;
    }
    setBusy(true);
    try {
      setOrder(
        await productRequest(
          `/api/products/gifts/status/${id}?key=${encodeURIComponent(key)}`,
        ),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    void (async () => {
      if (q.has("confirmed")) {
        try {
          await productRequest(
            `/api/products/gifts/orders/${q.get("order") ?? q.get("purchase")}/reconcile`,
            "POST",
            { key: q.get("key") },
          );
        } catch (e) {
          setError((e as Error).message);
        }
      }
      await load();
    })();
    const focus = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [load]);
  useEffect(() => {
    if (!order || !["reserved", "checkout"].includes(order.status)) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    return () => clearInterval(t);
  }, [order?.status, load]);
  async function requestLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const f = new FormData(e.currentTarget),
        r = await productRequest("/api/products/gifts/status-link", "POST", {
          id: f.get("id"),
          email: f.get("email"),
        });
      setNotice(r.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="gift-status-page">
      {order ? (
        <GiftStatusView order={order} onRefresh={() => void load()} />
      ) : hasLink ? (
        <p role="status">{error || "Dein Bestellstatus wird geladen …"}</p>
      ) : (
        <section className="gift-status-lookup">
          <p className="gift-status-kicker">PROACADEMY</p>
          <h1>Dein Bestellstatus.</h1>
          <p>
            Öffne den persönlichen Statuslink aus deiner E-Mail oder fordere ihn
            erneut an. Dafür ist kein Portalkonto nötig.
          </p>
          <form className="gift-form" onSubmit={requestLink}>
            <label>
              Bestellnummer
              <input
                name="id"
                required
                placeholder="Bestellnummer aus deiner E-Mail"
              />
            </label>
            <label>
              Hinterlegte E-Mail-Adresse
              <input type="email" name="email" required />
            </label>
            <button className="primary-button" disabled={busy}>
              Persönlichen Statuslink anfordern
            </button>
          </form>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
      {order && error && <p role="alert">{error}</p>}
    </main>
  );
}
