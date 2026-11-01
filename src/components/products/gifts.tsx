"use client";
import { useEffect, useRef, useState } from "react";
import { Gift, Copy, ArrowRight, X, Check } from "lucide-react";
import { Modal } from "../portal";
import { productRequest } from "./shared";
import { giftMoney, parseGiftAmount } from "@/lib/gifts/domain";
import "./gifts.css";
import { GiftCardArtwork } from "./gift-artwork";
export function GiftPurchaseDialog({
  product,
  onClose,
  payments,
}: {
  product: any;
  onClose: () => void;
  payments: boolean;
}) {
  const variants = product.gift_variants ?? [
    { id: product.id, amount: product.gift_amount, name: product.name },
  ];
  const variantKey = (v: any) => `${v.id}:${v.amount}`;
  const [value, setValue] = useState(variantKey(variants[0])),
    [custom, setCustom] = useState(""),
    [settings, setSettings] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef(crypto.randomUUID());
  useEffect(() => {
    void productRequest("/api/products/gifts/settings")
      .then(setSettings)
      .catch((e) => setError(e.message));
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const selected = variants.find((v: any) => variantKey(v) === value),
        amount = value === "custom" ? parseGiftAmount(custom) : selected.amount;
      const r = await productRequest("/api/products/gifts/checkout", "POST", {
        request_id: request.current,
        product_id: selected?.id ?? product.id,
        amount,
        buyer: {
          full_name: f.get("buyer_name"),
          email: f.get("buyer_email"),
          phone: "",
        },
        recipient: {
          first_name: f.get("first_name"),
          last_name: f.get("last_name"),
          email: f.get("email"),
          phone: f.get("phone") ?? "",
        },
      });
      window.location.assign(r.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title="ProAcademy verschenken"
      close={onClose}
      className="gift-modal"
    >
      <form className="gift-form" onSubmit={submit}>
        <div className="gift-intro">
          <Gift size={28} />
          <p>
            Ein Geschenk. Alle Möglichkeiten.
            <small>Für Camps, Training und neue Abo-Buchungen.</small>
          </p>
        </div>
        <label>
          Geschenkwert
          <select
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              request.current = crypto.randomUUID();
            }}
          >
            {variants.map((v: any) => (
              <option key={variantKey(v)} value={variantKey(v)}>
                {giftMoney(v.amount)}
              </option>
            ))}
            {settings?.allow_custom && (
              <option value="custom">Eigener Betrag</option>
            )}
          </select>
        </label>
        {value === "custom" && (
          <label>
            Dein Betrag in Euro
            <input
              inputMode="decimal"
              required
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                request.current = crypto.randomUUID();
              }}
              placeholder="z. B. 75,00"
            />
            <small>
              {settings &&
                `${giftMoney(settings.min_amount)} bis ${giftMoney(settings.max_amount)}`}
            </small>
          </label>
        )}
        <fieldset>
          <legend>Wer verschenkt?</legend>
          <div className="gift-fields">
            <label>
              Vor- und Nachname
              <input
                name="buyer_name"
                autoComplete="name"
                required
                maxLength={160}
              />
            </label>
            <label>
              Deine E-Mail
              <input
                name="buyer_email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Wer wird beschenkt?</legend>
          <div className="gift-fields">
            <label>
              Vorname
              <input name="first_name" required maxLength={80} />
            </label>
            <label>
              Nachname
              <input name="last_name" required maxLength={80} />
            </label>
            <label>
              E-Mail
              <input name="email" type="email" required maxLength={254} />
            </label>
            <label>
              Telefon <small>optional</small>
              <input name="phone" type="tel" maxLength={40} />
            </label>
          </div>
        </fieldset>
        <p className="gift-help">
          Der persönliche Code entsteht nach bestätigter Zahlung. Käufer und
          beschenkte Person erhalten jeweils eine E-Mail. Die Karte ist bis zum
          Ende des dritten Jahres nach dem Kaufjahr einlösbar. Restguthaben
          behält dieses ursprüngliche Gültigkeitsdatum.
        </p>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {!payments && (
          <p className="notice">
            Lokale Vorbereitung: echte Zahlungen sind ausgeschaltet.
          </p>
        )}
        <button
          className="primary-button"
          disabled={busy || !payments || !settings}
          type="submit"
        >
          {busy ? "Checkout wird vorbereitet …" : "Sicher zur Kasse"}
          <ArrowRight size={16} />
        </button>
      </form>
    </Modal>
  );
}
export type GiftView = {
  id: string;
  amount: number;
  buyer_name: string;
  recipient: { first_name: string; last_name: string; email: string };
  code: string | null;
  expires_at: string | null;
  status: string;
  gift_status: string | null;
  messages: { audience: string; status: string }[];
  checkout_url?: string | null;
  appearance?: { effect_color?: string };
};
export function GiftReceipt({
  order,
  onClose,
}: {
  order: GiftView;
  onClose: () => void;
}) {
  const [notice, setNotice] = useState("");
  const text = `${order.buyer_name} schenkt dir ${giftMoney(order.amount)} von ProAcademy. Dein Code: ${order.code}. Einlösen unter ${typeof location !== "undefined" ? location.origin : ""}/produkte`;
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("In die Zwischenablage kopiert.");
    } catch {
      setNotice("Bitte den Code markieren und kopieren.");
    }
  }
  const ready = order.status === "issued" && !!order.code,
    mail = order.messages.find((m) => m.audience === "recipient");
  return (
    <article className="gift-receipt">
      <button className="gift-close" aria-label="Schließen" onClick={onClose}>
        <X size={20} />
      </button>
      <span className="gift-eyebrow">PROACADEMY</span>
      <h1>
        {ready
          ? "Freude zum Weitergeben."
          : order.status === "expired"
            ? "Checkout abgelaufen"
            : ["review", "refunded"].includes(order.status)
              ? "Geschenkkarte in Prüfung"
              : "Zahlung wird bestätigt …"}
      </h1>
      {ready ? (
        <>
          <GiftCardArtwork
            data={{
              amount: order.amount,
              code: order.code!,
              recipient_name: `${order.recipient.first_name} ${order.recipient.last_name}`,
              sender_name: order.buyer_name,
              expires_at: order.expires_at!,
            }}
          />
          <p>
            {order.gift_status === "claimed"
              ? "Den aktuellen Stand findest du unter deinem persönlichen Bestellstatus."
              : "Nach jedem erfolgreichen Einsatz erhält verbleibendes Guthaben einen neuen Code. Die ursprüngliche Gültigkeit bleibt bestehen."}
          </p>
          <div className="gift-actions">
            <button
              className="primary-button"
              onClick={() => void copy(order.code!)}
            >
              <Copy size={16} />
              Code kopieren
            </button>
            <button
              className="secondary-button"
              onClick={() => void copy(text)}
            >
              Nachricht kopieren
            </button>
          </div>
          <p className="gift-delivery">
            <Check size={17} />
            {mail?.status === "sent"
              ? `Dein Geschenk wurde per E-Mail an ${order.recipient.email} verschickt.`
              : mail?.status === "captured"
                ? "Lokale Vorschau: E-Mail erfasst, nicht versendet."
                : "Die E-Mail an die beschenkte Person wird noch zugestellt. Du kannst diese Seite bereits schließen oder das Geschenk selbst weitergeben."}
          </p>
          <p>
            <a href="/produkte">Geschenk im Shop einlösen</a> ·{" "}
            <a href="/login">Zum Elternportal</a>
          </p>
        </>
      ) : (
        <>
          <p>
            {order.status === "expired"
              ? "Es wurde keine Geschenkkarte ausgestellt. Bitte starte bei Bedarf einen neuen Kauf."
              : order.status === "refunded"
                ? "Diese Zahlung wurde erstattet. Der Code ist gesperrt."
                : order.status === "review"
                  ? "Der Zahlungsstatus benötigt eine Prüfung. Bitte nicht erneut kaufen."
                  : "Deine Geschenkkarte wird erst nach bestätigter Zahlung ausgestellt. Bitte nicht erneut kaufen."}
          </p>
          {order.checkout_url && (
            <a className="primary-button" href={order.checkout_url}>
              Checkout fortsetzen
            </a>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      <small className="gift-design-note">
        Vorder- und Rückseite enthalten deine persönlichen Geschenkangaben.
      </small>
    </article>
  );
}
