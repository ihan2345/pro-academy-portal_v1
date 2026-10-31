"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Gift,
  Plus,
  ChevronDown,
  ArrowUpRight,
  ArrowLeft,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react";
import { Modal } from "../portal";
import { productRequest } from "./shared";
import { GiftStatusView } from "./gift-status";
import { giftMoney } from "@/lib/gifts/domain";
import { giftExpiry } from "@/lib/gifts/artwork";
import { claimGiftWelcome } from "@/lib/gifts/welcome";
import "./gift-account.css";
type AccountCard = {
  id: string;
  roles: ("buyer" | "recipient")[];
  initial_amount: number;
  remaining: number | null;
  reserved: number | null;
  available: number;
  gift_status: string;
  expires_at: string;
  buyer_name: string;
  recipient_name: string;
  code: string | null;
  status: string;
};
type AccountState = {
  cards: AccountCard[];
  available: number;
  has_cards: boolean;
  welcome_key: string;
  user_id: string;
  linked_order?: string;
  linked_scope?: string;
};
const changed = "pa:gift-account-updated";
function announce(data: AccountState) {
  window.dispatchEvent(new CustomEvent(changed, { detail: data }));
}
function useGiftAccount() {
  const [data, setData] = useState<AccountState | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [enabled, setEnabled] = useState(true);
  const version = useRef(0);
  const accept = useCallback((value: AccountState) => {
    version.current++;
    setData(value);
    setError("");
    setLoading(false);
  }, []);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    try {
      const res = await fetch("/api/products/gifts/mine", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if ([401, 403, 404].includes(res.status)) {
        if (current === version.current) {
          setEnabled(false);
          setData(null);
        }
        return;
      }
      const value = await res.json();
      if (!res.ok)
        throw Error(
          value.error ?? "Geschenkkarten konnten nicht geladen werden.",
        );
      if (current === version.current) {
        setData(value);
        setError("");
        setEnabled(true);
      }
    } catch (e) {
      if (current === version.current) setError((e as Error).message);
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const update = (e: Event) =>
      accept((e as CustomEvent<AccountState>).detail);
    window.addEventListener("focus", focus);
    window.addEventListener(changed, update);
    return () => {
      version.current++;
      window.removeEventListener("focus", focus);
      window.removeEventListener(changed, update);
    };
  }, [accept, refresh]);
  return { data, error, loading, enabled, refresh, accept };
}
export function GiftLinkDialog({
  onClose,
  onLinked,
}: {
  onClose: () => void;
  onLinked: (value: AccountState) => void;
}) {
  const [value, setValue] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Geschenkkarte hinzufügen"
      close={onClose}
      className="gift-link-modal"
    >
      <form
        className="gift-link-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          void productRequest<AccountState>(
            "/api/products/gifts/mine",
            "POST",
            { value },
          )
            .then((result) => {
              onLinked(result);
              announce(result);
              onClose();
            })
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <span className="gift-link-icon">
          <Gift size={27} />
        </span>
        <p>
          Verknüpfe deine Karte mit deinem Elternkonto. Der aktuelle Code und
          die Guthaben-Historie bleiben danach in deinem Profil verfügbar.
        </p>
        <label>
          Geschenkcode oder persönlicher Statuslink
          <textarea
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            maxLength={1500}
            placeholder="PA-… oder deinen Statuslink einfügen"
          />
        </label>
        <small>
          Bei einem Geschenkcode verwenden wir deine bestätigte E-Mail zur
          Zuordnung. Für eine andere Empfängeradresse nutze bitte den
          persönlichen Empfänger-Statuslink.
        </small>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="primary-button"
          disabled={busy || !value.trim()}
        >
          {busy ? "Wird verknüpft …" : "Karte in meinem Profil speichern"}
          <ArrowUpRight size={15} />
        </button>
      </form>
    </Modal>
  );
}
const particles = Array.from({ length: 38 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  delay: `${(i % 7) * 0.09}s`,
  drift: `${((i * 31) % 180) - 90}px`,
  color: ["#c8f37c", "#b8a4ec", "#f0ce81", "#91cbb5", "#ffffff"][i % 5],
  rotate: `${i * 43}deg`,
}));
function GiftWelcome({
  amount,
  count,
  onClose,
}: {
  amount: number;
  count: number;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Dein Geschenk wartet auf dich"
      close={onClose}
      className="gift-welcome-modal"
    >
      <div className="gift-welcome">
        <div className="gift-confetti" aria-hidden="true">
          {particles.map((p, i) => (
            <i
              key={i}
              style={
                {
                  left: p.left,
                  background: p.color,
                  "--confetti-delay": p.delay,
                  "--confetti-drift": p.drift,
                  "--confetti-rotate": p.rotate,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
        <div className="gift-welcome-art">
          <img
            src="/gifts/card-front.png"
            width={1190}
            height={744}
            alt="Deine ProAcademy Geschenkkarte"
          />
        </div>
        <span className="gift-account-kicker">
          EIN GESCHENK. DEINE MÖGLICHKEITEN.
        </span>
        <h2>
          Du hast <span>{giftMoney(amount)}</span> Guthaben!
        </h2>
        <p>Nutze sie jetzt im Shop für Abos, Camps uvm.</p>
        {count > 1 && (
          <small>
            Aus {count} verfügbaren Geschenkkarten. Wähle den passenden Code für
            deinen Kauf.
          </small>
        )}
        <div className="gift-welcome-actions">
          <button type="button" className="primary-button" onClick={onClose}>
            Jetzt im Shop entdecken
            <ArrowUpRight size={15} />
          </button>
          <Link
            href="/profil/geschenkkarten"
            className="secondary-button"
            onClick={onClose}
          >
            Meine Geschenkkarten
          </Link>
        </div>
        <button type="button" className="gift-welcome-later" onClick={onClose}>
          Später nutzen
        </button>
      </div>
    </Modal>
  );
}
export function GiftAccountMenu({
  welcomeAllowed = true,
}: {
  welcomeAllowed?: boolean;
}) {
  const { data, accept } = useGiftAccount();
  const [open, setOpen] = useState(false),
    [add, setAdd] = useState(false),
    [welcome, setWelcome] = useState(false);
  const host = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!data || add || !welcomeAllowed) return;
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {}
    if (claimGiftWelcome(data, storage)) {
      setOpen(false);
      setWelcome(true);
    }
  }, [data, add, welcomeAllowed]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (host.current && !host.current.contains(e.target as Node))
        setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (!data?.has_cards) return null;
  return (
    <>
      <div
        className="gift-account-menu"
        ref={host}
        onMouseEnter={() => {
          if (window.matchMedia("(hover: hover)").matches) setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setOpen(false);
        }}
      >
        <button
          ref={button}
          className={`gift-account-trigger ${data.available > 0 ? "has-balance" : ""}`}
          type="button"
          aria-expanded={open}
          aria-controls="gift-account-dropdown"
          onClick={() =>
            setOpen((v) =>
              window.matchMedia("(hover: hover)").matches ? true : !v,
            )
          }
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          <Gift size={17} />
          <span>
            {data.available > 0
              ? `Guthaben · ${giftMoney(data.available)}`
              : "Meine Geschenkkarten"}
          </span>
          <ChevronDown size={13} />
        </button>
        {open && (
          <div
            id="gift-account-dropdown"
            className="gift-account-dropdown"
            role="navigation"
            aria-label="Geschenkkarten"
          >
            <div className="gift-dropdown-summary">
              <small>
                {data.available > 0
                  ? "Verfügbares Geschenkguthaben"
                  : "Deine Geschenkkarten"}
              </small>
              <strong>
                {data.available > 0
                  ? giftMoney(data.available)
                  : `${data.cards.length} ${data.cards.length === 1 ? "Karte" : "Karten"}`}
              </strong>
            </div>
            <Link href="/profil/geschenkkarten" onClick={() => setOpen(false)}>
              <Gift size={16} />
              <span>Meine Geschenkkarten</span>
              <ArrowUpRight size={13} />
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setAdd(true);
              }}
            >
              <Plus size={16} />
              <span>Geschenkkarte hinzufügen</span>
            </button>
          </div>
        )}
      </div>
      {add && (
        <GiftLinkDialog onClose={() => setAdd(false)} onLinked={accept} />
      )}{" "}
      {welcome && (
        <GiftWelcome
          amount={data.available}
          count={data.cards.filter((c) => c.available > 0).length}
          onClose={() => setWelcome(false)}
        />
      )}
    </>
  );
}
function CardTile({ card }: { card: AccountCard }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [card.code]);
  const received = card.roles.includes("recipient");
  const state =
    card.gift_status === "spent"
      ? "Vollständig eingelöst"
      : card.gift_status === "expired"
        ? "Abgelaufen"
        : card.gift_status === "refunded"
          ? "Erstattet"
          : card.gift_status === "review"
            ? "In Prüfung"
            : card.reserved && received
              ? "Kauf offen"
              : received
                ? "Einlösbar"
                : "Kauf bestätigt";
  return (
    <article className="gift-account-card">
      <div className="gift-account-card-top">
        <span className="gift-account-card-icon">
          <Gift size={20} />
        </span>
        <span
          className={`gift-account-state ${card.available > 0 ? "active" : ""}`}
        >
          {state}
        </span>
      </div>
      <span className="gift-account-kicker">
        {card.roles.length > 1
          ? "ERHALTEN & VERSCHENKT"
          : received
            ? "ERHALTEN"
            : "VERSCHENKT"}
      </span>
      <h3>
        {received ? `Von ${card.buyer_name}` : `Für ${card.recipient_name}`}
      </h3>
      <div className="gift-account-value">
        <strong>
          {giftMoney(received ? (card.remaining ?? 0) : card.initial_amount)}
        </strong>
        <span>{received ? "Restguthaben" : "Geschenkwert"}</span>
      </div>
      {card.code && (
        <div className="gift-account-current-code">
          <small>Aktueller Code</small>
          <div>
            <code>{card.code}</code>
            <button
              type="button"
              aria-label="Aktuellen Code kopieren"
              onClick={() =>
                void navigator.clipboard
                  .writeText(card.code!)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
          {copied && <small role="status">Code kopiert.</small>}
        </div>
      )}
      <p className="gift-account-expiry">
        Gültig bis {giftExpiry(card.expires_at)}
        {received && !!card.reserved && (
          <span> · {giftMoney(card.reserved)} reserviert</span>
        )}
      </p>
      <Link
        className="gift-account-detail"
        href={`/profil/geschenkkarten/${card.id}`}
      >
        {received ? "Status & Guthaben-Historie" : "Kaufstatus ansehen"}
        <ArrowUpRight size={15} />
      </Link>
    </article>
  );
}
export function GiftAccountOverview({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { data, loading, error, enabled, refresh, accept } = useGiftAccount();
  const [add, setAdd] = useState(false),
    [filter, setFilter] = useState("all");
  if (!enabled) return null;
  const cards = (data?.cards ?? []).filter(
    (c) =>
      filter === "all" || c.roles.includes(filter as "buyer" | "recipient"),
  );
  return (
    <section
      className={`gift-account-overview ${compact ? "compact panel" : ""}`}
      id="geschenkkarten"
    >
      <header className="gift-account-heading">
        <div>
          <span className="gift-account-kicker">DEIN GESCHENKBEREICH</span>
          <h2>Meine Geschenkkarten</h2>
          <p>
            {data?.available
              ? `${giftMoney(data.available)} verfügbar · Dein aktueller Code bleibt hier immer abrufbar.`
              : "Deine Karten, aktuellen Codes und bisherigen Einlösungen an einem Ort."}
          </p>
        </div>
        <div className="gift-account-heading-actions">
          {compact && (
            <Link href="/profil/geschenkkarten" className="secondary-button">
              Alle ansehen
              <ArrowUpRight size={14} />
            </Link>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={() => setAdd(true)}
          >
            <Plus size={16} />
            Geschenkkarte hinzufügen
          </button>
          {!compact && (
            <button
              type="button"
              className="secondary-button"
              aria-label="Geschenkkarten aktualisieren"
              onClick={() => void refresh()}
            >
              <RefreshCw size={15} />
            </button>
          )}
        </div>
      </header>
      {loading && !data ? (
        <p className="gift-account-muted">
          Deine Geschenkkarten werden geladen …
        </p>
      ) : error ? (
        <p role="alert" className="error-message">
          {error}
        </p>
      ) : !data?.cards.length ? (
        <div className="gift-account-empty">
          <Gift size={30} />
          <h3>Dein nächstes Erlebnis wartet.</h3>
          <p>
            Verknüpfe eine Geschenkkarte. Guthaben und aktueller Code werden
            dauerhaft deinem Profil zugeordnet.
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={() => setAdd(true)}
          >
            <Plus size={16} />
            Erste Geschenkkarte hinzufügen
          </button>
        </div>
      ) : (
        <>
          {!compact && (
            <div
              className="gift-account-filters"
              role="group"
              aria-label="Geschenkkarten filtern"
            >
              {[
                ["all", "Alle"],
                ["recipient", "Erhalten"],
                ["buyer", "Verschenkt"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="gift-account-grid">
            {(compact ? cards.slice(0, 2) : cards).map((c) => (
              <CardTile key={c.id} card={c} />
            ))}
          </div>
          {cards.length === 0 && (
            <p className="gift-account-muted">
              In diesem Bereich sind noch keine Karten vorhanden.
            </p>
          )}
          <p className="gift-account-footnote">
            Nach einer Einlösung zeigt dieser Bereich den neuen Restcode. Die
            ursprüngliche Gültigkeit bleibt bestehen. Pro Kauf verwendest du
            einen Geschenkcode.
          </p>
        </>
      )}
      {add && (
        <GiftLinkDialog onClose={() => setAdd(false)} onLinked={accept} />
      )}
    </section>
  );
}
export function GiftAccountPage({ id }: { id?: string }) {
  const [loaded, setLoaded] = useState<{ id: string; value: any } | null>(null),
    [error, setError] = useState("");
  const version = useRef(0);
  const order = loaded && loaded.id === id ? loaded.value : null;
  const load = useCallback(async () => {
    if (!id) return;
    const current = ++version.current;
    try {
      const value = await productRequest(`/api/products/gifts/mine/${id}`);
      if (current === version.current) {
        setLoaded({ id, value });
        setError("");
      }
    } catch (e) {
      if (current === version.current) setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    setError("");
    void load();
    const focus = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", focus);
    return () => {
      version.current++;
      window.removeEventListener("focus", focus);
    };
  }, [load]);
  return (
    <main className="gift-account-page">
      <nav>
        <Link href={id ? "/profil/geschenkkarten" : "/profil"}>
          <ArrowLeft size={15} />
          {id ? "Meine Geschenkkarten" : "Mein Profil"}
        </Link>
        <Link href="/produkte">
          Zum Shop
          <ArrowUpRight size={15} />
        </Link>
      </nav>
      {id ? (
        order ? (
          <GiftStatusView order={order} onRefresh={() => void load()} />
        ) : (
          <p role="status">{error || "Deine Geschenkkarte wird geladen …"}</p>
        )
      ) : (
        <GiftAccountOverview />
      )}
    </main>
  );
}
