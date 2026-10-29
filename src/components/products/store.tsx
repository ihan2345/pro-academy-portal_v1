"use client";
import { ProductOperations } from "./operations";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { portalHome, type PortalRole } from "@/lib/portal-access";
import {
  ArrowRight,
  Check,
  LoaderCircle,
  Search,
  ShoppingBag,
  UserRound,
} from "lucide-react";
import type { ProductContext } from "@/lib/products/domain";
import {
  ProductCard,
  ProductShowcase,
  productRequest,
  type ProductDisplay,
} from "./shared";
import { Modal } from "../portal";
const money = (n: number, currency: string) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(
    n / 100,
  );
export function ProductStore({
  embedded = false,
  portalRole = null,
}: {
  embedded?: boolean;
  portalRole?: PortalRole | null;
}) {
  const [rows, setRows] = useState<
      (ProductDisplay & { id: string; decision: any })[]
    >([]),
    [ctx, setCtx] = useState<ProductContext | null>(null),
    [player, setPlayer] = useState(""),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [channel, setChannel] = useState("catalog");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible") setRefresh((n) => n + 1);
    };
    window.addEventListener("focus", update);
    const timer = setInterval(update, 30000);
    return () => {
      window.removeEventListener("focus", update);
      clearInterval(timer);
    };
  }, []);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [payments, setPayments] = useState(false),
    [chosen, setChosen] = useState<any>(null),
    [preview, setPreview] = useState<any>(null),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [discountCode, setDiscountCode] = useState("");
  const [newChild, setNewChild] = useState(false),
    [child, setChild] = useState({
      first_name: "",
      last_name: "",
      birth_date: "",
    }),
    [accounts, setAccounts] = useState<string[]>([]),
    [customer, setCustomer] = useState(""),
    [purchase, setPurchase] = useState<any>(null);
  const reconciledPurchase = useRef<string | null>(null);
  const loadedCatalogQuery = useRef<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const c = q.get("channel");
    if (c && ["catalog", "trials", "parents", "homepage"].includes(c))
      setChannel(c);
    const id = q.get("purchase");
    if (id) {
      void (async () => {
        if (reconciledPurchase.current !== id) {
          reconciledPurchase.current = id;
          await productRequest(
            `/api/products/purchases/${id}/reconcile`,
            "POST",
            {},
          );
        }
        setPurchase(await productRequest(`/api/products/purchases/${id}`));
      })().catch((e) => setError(e.message));
    }
    if (q.get("account") === "confirmed")
      setNotice(
        "Deine E-Mail ist bestätigt. Noch offene Familienzuordnungen werden durch die Verwaltung geprüft.",
      );
  }, [refresh]);
  useEffect(() => {
    let cancel = false;
    const t = setTimeout(() => {
      const q = new URLSearchParams({ q: search, channel });
      if (player) q.set("player", player);
      if (newChild) q.set("new_child", "true");
      if (cursor) q.set("cursor", cursor);
      const query = q.toString();
      // Keep the catalogue mounted during polling/focus refreshes of the same view.
      if (loadedCatalogQuery.current !== query) setLoading(true);
      void productRequest(`/api/products?${query}`)
        .then((r) => {
          if (!cancel) {
            loadedCatalogQuery.current = query;
            setRows(r.rows);
            setCtx(r.context);
            setNext(r.next);
            setPayments(r.payments_enabled);
          }
        })
        .catch((e) => {
          if (!cancel) setError(e.message);
        })
        .finally(() => {
          if (!cancel) setLoading(false);
        });
    }, 200);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [player, search, cursor, channel, newChild, refresh]);
  useEffect(() => {
    if (!ctx?.auth_id) return;
    void productRequest("/api/products/accounts")
      .then((r) =>
        setAccounts(r.accounts.map((a: any) => a.stripe_customer_id)),
      )
      .catch(() => {});
  }, [ctx?.auth_id]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const [campDetails, setCampDetails] = useState({
    birth_date: "",
    gender: "keine Angabe",
    clothing_size: "",
  });
  const requestId = useRef(crypto.randomUUID());
  async function act(p: any) {
    requestId.current = crypto.randomUUID();
    setDiscountCode("");
    if (!ctx?.children.length) setNewChild(true);
    setCampDetails({
      birth_date:
        ctx?.children.find((c) => c.id === (player || ctx.children[0]?.id))
          ?.birth_date ?? "",
      gender: "keine Angabe",
      clothing_size: "",
    });
    setChosen(p);
    setPreview(null);
    setError("");
    if (!ctx?.auth_id) {
      setNotice("");
      return;
    }
    if (!player && ctx.children.length === 1) setPlayer(ctx.children[0].id);
  }
  async function start() {
    if (!chosen) return;
    await run(async () => {
      const selected = player || ctx?.children[0]?.id;
      if (
        chosen.kind === "subscription" &&
        ctx?.children
          .find((c) => c.id === selected)
          ?.memberships.some((m) => m.current) &&
        !newChild
      ) {
        const r = await productRequest(
          `/api/products/${chosen.id}/change-preview`,
          "POST",
          { player_id: selected, channel },
        );
        setPreview(r);
        return;
      }
      const id = requestId.current;
      const r = await productRequest(
        `/api/products/${chosen.id}/checkout`,
        "POST",
        {
          request_id: id,
          ...(!ctx?.auth_id
            ? { guest_parent: { full_name: name, email, phone } }
            : {}),
          ...(discountCode.trim()
            ? { discount_code: discountCode.trim() }
            : {}),
          ...(newChild || !ctx?.children.length
            ? { new_child: child }
            : { player_id: selected }),
          ...(chosen.kind === "camp"
            ? {
                camp_details: {
                  ...campDetails,
                  birth_date: newChild
                    ? child.birth_date
                    : campDetails.birth_date,
                },
              }
            : {}),
          ...(customer ? { customer_id: customer } : {}),
          channel,
        },
      ).catch((error) => {
        requestId.current = crypto.randomUUID();
        throw error;
      });
      if (r.url) {
        const target = new URL(r.url);
        if (
          target.protocol !== "https:" ||
          target.hostname !== "checkout.stripe.com"
        )
          throw Error("Ungültiges Checkout-Ziel");
        window.location.assign(r.url);
      } else {
        setNotice(
          r.status === "review"
            ? "Dein Kauf wird geprüft. Bitte nicht erneut kaufen."
            : "Kauf wurde bereits abgeschlossen.",
        );
        setPurchase(await productRequest(`/api/products/purchases/${r.id}`));
        setChosen(null);
      }
    });
  }
  const Content = embedded ? "div" : "main";
  const role = portalRole ?? ctx?.role ?? null;
  const overviewHref = role ? portalHome(role) : "/";
  return (
    <div className={`product-store${embedded ? " in-portal" : ""}`}>
      {!embedded && (
        <header className="product-store-nav">
          <Link href="/produkte" className="product-store-brand">
            PRO<span>ACADEMY</span>
            <small>BY AYHAN & KARAMAN</small>
          </Link>
          <nav>
            {role === "parent" && (
              <Link href="/profil" className="product-store-profile">
                <UserRound size={17} /> Mein Profil
              </Link>
            )}
            {role ? (
              <Link href={overviewHref}>
                Überblick <ArrowRight size={16} />
              </Link>
            ) : ctx?.auth_id ? (
              <a href="#familienkonto">
                Konto ergänzen <ArrowRight size={16} />
              </a>
            ) : (
              <Link href="/login">
                Anmelden <ArrowRight size={16} />
              </Link>
            )}
          </nav>
        </header>
      )}
      <Content className="product-store-content">
        {embedded ? (
          <section className="page-heading product-store-portal-heading">
            <div>
              <div className="eyebrow">TRAINING & CAMPS</div>
              <h1>
                Produkte<span className="greeting-dot">.</span>
              </h1>
              <p>Entdecke passende Trainingsangebote und Camps.</p>
            </div>
            <Link className="secondary-button" href={overviewHref}>
              Überblick <ArrowRight size={16} />
            </Link>
          </section>
        ) : (
          <section className="product-store-hero">
            <span className="product-kicker">DEIN NÄCHSTER SCHRITT</span>
            <h1>
              Mehr Spiel.
              <br />
              <span>Mehr Möglichkeiten.</span>
            </h1>
            <p>
              Finde das passende Training, entdecke unsere Camps und entwickle
              dein Spiel weiter.
            </p>
          </section>
        )}
        {error && !chosen && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="product-success" role="status">
            {notice}
          </p>
        )}
        {purchase && (
          <section className="panel product-purchase-status">
            <div>
              <h2>{purchase.name ?? "Deine Buchung"}</h2>
              <p>
                {purchase.status === "fulfilled"
                  ? "Deine Zahlung wurde bestätigt und die Buchung zugeordnet."
                  : purchase.status === "review"
                    ? "Deine Zahlung oder Zuordnung wird geprüft. Bitte nicht erneut kaufen."
                    : purchase.status === "refunded"
                      ? "Dein Kauf wurde erstattet."
                      : purchase.status === "failed"
                        ? "Die Zahlung ist fehlgeschlagen. Es wurde keine Mitgliedschaft aktiviert."
                        : purchase.status === "expired"
                          ? "Dieser Checkout ist abgelaufen."
                          : "Die Bestätigung wird verarbeitet."}
              </p>
              {purchase.reason && <small>{purchase.reason}</small>}
            </div>
            {purchase.guest &&
              purchase.account_pending &&
              purchase.payment_confirmed &&
              ["fulfilled", "review"].includes(purchase.status) && (
                <div>
                  <p>
                    Dein Kauf bleibt auch ohne Portalzugang bestehen. Bestätige
                    deine E-Mail über den zugesendeten Link, um dein Konto zu
                    aktivieren.
                  </p>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await productRequest(
                          `/api/products/purchases/${purchase.id}/access`,
                          "POST",
                          {},
                        );
                        setNotice(r.message);
                      })
                    }
                  >
                    Zugangslink erneut anfordern
                  </button>
                </div>
              )}
            {purchase.guest &&
              ["reserved", "checkout", "failed"].includes(purchase.status) && (
                <div>
                  {[
                    { action: "resume", label: "Bestellung fortsetzen" },
                    {
                      action: "cancel",
                      label: "Unbezahlte Bestellung beenden",
                    },
                  ].map((item) => (
                    <button
                      key={item.action}
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const r = await productRequest(
                            `/api/products/purchases/${purchase.id}/${item.action}`,
                            "POST",
                            {},
                          );
                          if (r.url) {
                            if (
                              new URL(r.url).origin !==
                              "https://checkout.stripe.com"
                            )
                              throw Error("Ungültiges Checkout-Ziel");
                            window.location.assign(r.url);
                          } else
                            setPurchase(
                              await productRequest(
                                `/api/products/purchases/${purchase.id}`,
                              ),
                            );
                        })
                      }
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            {!["fulfilled", "review", "failed", "expired", "refunded"].includes(
              purchase.status,
            ) && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await productRequest(
                      `/api/products/purchases/${purchase.id}/reconcile`,
                      "POST",
                      {},
                    );
                    setPurchase(
                      await productRequest(
                        `/api/products/purchases/${purchase.id}`,
                      ),
                    );
                    setCursor(null);
                  })
                }
              >
                Status aktualisieren
              </button>
            )}
          </section>
        )}
        {ctx?.auth_id &&
          !ctx.parent_id &&
          ctx.role !== "admin" &&
          ctx.role !== "staff" && (
            <section
              id="familienkonto"
              className="panel product-register-panel"
            >
              <h2>Dein Familienkonto vorbereiten</h2>
              <p>
                Deine Anmeldung ist bestätigt. Ergänze deinen vollständigen
                Namen.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await productRequest("/api/products/prepare", "POST", {
                      full_name: name,
                    });
                    window.location.reload();
                  });
                }}
              >
                <label>
                  Vollständiger Elternname
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button disabled={busy} className="primary-button">
                  Familienkonto vorbereiten
                </button>
              </form>
            </section>
          )}
        {ctx?.role === "parent" && <ProductOperations />}
        <div className="product-store-controls">
          <label className="product-search">
            <Search size={18} />
            <input
              type="search"
              value={search}
              aria-label="Angebote suchen"
              placeholder="Angebote suchen …"
              onChange={(e) => {
                setSearch(e.target.value);
                setCursor(null);
              }}
            />
          </label>
          {ctx?.role === "parent" && (
            <label>
              Für welches Kind?
              <select
                aria-label="Für welches Kind?"
                value={newChild ? "new" : player}
                onChange={(e) => {
                  setNewChild(e.target.value === "new");
                  setPlayer(e.target.value === "new" ? "" : e.target.value);
                  setCursor(null);
                }}
              >
                <option value="">Kind auswählen</option>
                {ctx?.children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="new">Weiteres Kind hinzufügen</option>
              </select>
            </label>
          )}
        </div>
        {loading ? (
          <div className="product-empty" role="status">
            <LoaderCircle className="product-spin" /> Angebote werden geladen …
          </div>
        ) : rows.length ? (
          <>
            <ProductShowcase products={rows} onAction={(p) => void act(p)} />
            <div className="product-catalog-heading">
              <h2>Alle Angebote</h2>
              <span>{rows.length} Angebote auf dieser Seite</span>
            </div>
            <div className="product-store-grid">
              {rows.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  decision={
                    p.decision.mode === "select_child"
                      ? { ...p.decision, purchasable: true }
                      : p.decision
                  }
                  onAction={() => void act(p)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="product-empty">
            <ShoppingBag size={38} />
            <h2>Gerade kein passendes Angebot</h2>
            <p>Wähle ein Kind oder passe deine Suche an.</p>
          </div>
        )}
        {next && (
          <div className="product-load-more">
            <button
              className="secondary-button"
              onClick={() => setCursor(next)}
            >
              Weitere Angebote <ArrowRight size={16} />
            </button>
          </div>
        )}
        {cursor && (
          <button className="text-button" onClick={() => setCursor(null)}>
            Zur ersten Seite
          </button>
        )}
        {!embedded && (
          <footer className="product-store-footer">
            <strong>Gemeinsam besser werden.</strong>
            <p>Persönliches Training. Klare nächste Schritte. ProAcademy.</p>
            <Link href="/produkte?channel=trials">
              Angebote für Probetraining-Familien
            </Link>
          </footer>
        )}
      </Content>
      {chosen && (
        <Modal
          title={preview ? "Tarifwechsel prüfen" : chosen.name}
          className="product-checkout-modal"
          close={() => {
            setChosen(null);
            setPreview(null);
          }}
        >
          <div className="product-checkout-body">
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            {preview ? (
              <>
                <div className="product-change-label">
                  {preview.direction === "upgrade" ? "Upgrade" : "Downgrade"}{" "}
                  für {preview.player_name}
                </div>
                <div className="product-change-comparison">
                  <div>
                    <small>Aktuell</small>
                    <h3>{preview.current_name}</h3>
                    <p>
                      {preview.current_units} Einheiten, davon{" "}
                      {preview.current_athletics} Athletik
                    </p>
                  </div>
                  <ArrowRight size={22} />
                  <div>
                    <small>Danach</small>
                    <h3>{preview.target_name}</h3>
                    <p>
                      {preview.target_units} Einheiten, davon{" "}
                      {preview.target_athletics} Athletik
                    </p>
                  </div>
                </div>
                <dl className="product-change-facts">
                  <div>
                    <dt>Jetzt fällig</dt>
                    <dd>{money(preview.amount_due, preview.currency)}</dd>
                  </div>
                  <div>
                    <dt>Neuer regulärer Preis</dt>
                    <dd>
                      {money(preview.recurring_amount, preview.currency)} /{" "}
                      {preview.interval === "year" ? "Jahr" : "Monat"}
                    </dd>
                  </div>
                  <div>
                    <dt>Wirksam ab</dt>
                    <dd>
                      {new Date(preview.effective_at * 1000).toLocaleString(
                        "de-DE",
                        { timeZone: "Europe/Berlin" },
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Bereits angerechnet</dt>
                    <dd>
                      {preview.used_football} Fußball · {preview.used_athletics}{" "}
                      Athletik
                    </dd>
                  </div>
                </dl>
                <p>{preview.note}</p>
                {preview.planned > 0 && (
                  <p>
                    {preview.planned} geplante Trainingsteilnahmen bleiben
                    erhalten.
                  </p>
                )}
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await productRequest(
                        `/api/products/changes/${preview.id}/confirm`,
                        "POST",
                        {},
                      );
                      setNotice(
                        r.status === "scheduled"
                          ? "Dein Downgrade ist zum Abrechnungsende vorgemerkt."
                          : r.status === "completed"
                            ? "Tarifwechsel bestätigt."
                            : "Der Wechsel wartet auf die Zahlungsbestätigung. Dein bisheriger Anspruch bleibt bis dahin bestehen.",
                      );
                      if (r.invoice_url) {
                        const target = new URL(r.invoice_url);
                        if (
                          target.protocol === "https:" &&
                          target.hostname === "invoice.stripe.com"
                        )
                          window.location.assign(target.href);
                      }
                      setChosen(null);
                      setPreview(null);
                    })
                  }
                >
                  Wechsel verbindlich bestätigen
                </button>
              </>
            ) : (
              <>
                {chosen.asset_ids?.length > 0 && (
                  <div className="product-checkout-gallery">
                    {chosen.asset_ids.map((id: string, i: number) => (
                      <img
                        key={id}
                        src={`/api/products/image/${id}`}
                        width={240}
                        height={150}
                        loading="lazy"
                        alt={`${chosen.name} – Bild ${i + 1}`}
                      />
                    ))}
                  </div>
                )}
                <p style={{ whiteSpace: "pre-line" }}>
                  {chosen.description || chosen.short_description}
                </p>
                {ctx?.auth_id && ctx.role !== "parent" ? (
                  <p>
                    Bitte verwende für einen Kauf ein bestätigtes Elternkonto.
                  </p>
                ) : (
                  <form
                    className="product-purchase-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void start();
                    }}
                  >
                    {!ctx?.auth_id && (
                      <>
                        <p>
                          Buche direkt ohne vorherige Anmeldung. Deinen
                          Portalzugang bestätigst du nach dem Kauf per E-Mail.{" "}
                          <Link href="/login">Bereits ein Konto? Anmelden</Link>
                        </p>
                        <div className="product-new-child">
                          <label>
                            Dein vollständiger Name
                            <input
                              autoComplete="name"
                              required
                              minLength={2}
                              maxLength={160}
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                            />
                          </label>
                          <label>
                            Deine E-Mail
                            <input
                              autoComplete="email"
                              type="email"
                              required
                              maxLength={254}
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                            />
                          </label>
                          <label>
                            Telefon (optional)
                            <input
                              autoComplete="tel"
                              type="tel"
                              maxLength={40}
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                            />
                          </label>
                        </div>
                      </>
                    )}
                    {ctx?.auth_id && (
                      <label>
                        Kind auswählen
                        <select
                          value={
                            newChild
                              ? "new"
                              : player || ctx.children[0]?.id || "new"
                          }
                          onChange={(e) => {
                            setNewChild(e.target.value === "new");
                            setPlayer(
                              e.target.value === "new" ? "" : e.target.value,
                            );
                          }}
                        >
                          {ctx.children.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                          <option value="new">Neues Kind</option>
                        </select>
                      </label>
                    )}
                    {(newChild || !ctx?.children.length) && (
                      <div className="product-new-child">
                        <label>
                          Vorname
                          <input
                            required
                            value={child.first_name}
                            onChange={(e) =>
                              setChild((c) => ({
                                ...c,
                                first_name: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          Nachname
                          <input
                            required
                            value={child.last_name}
                            onChange={(e) =>
                              setChild((c) => ({
                                ...c,
                                last_name: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          Geburtsdatum
                          <input
                            type="date"
                            required
                            value={child.birth_date}
                            onChange={(e) =>
                              setChild((c) => ({
                                ...c,
                                birth_date: e.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                    )}
                    {chosen.kind === "camp" && (
                      <div className="product-new-child">
                        <label>
                          Geburtsdatum für das Camp
                          <input
                            type="date"
                            required
                            readOnly={newChild}
                            value={
                              newChild
                                ? child.birth_date
                                : campDetails.birth_date
                            }
                            onChange={(e) =>
                              setCampDetails((c) => ({
                                ...c,
                                birth_date: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          Geschlecht
                          <select
                            value={campDetails.gender}
                            onChange={(e) =>
                              setCampDetails((c) => ({
                                ...c,
                                gender: e.target.value,
                              }))
                            }
                          >
                            <option>keine Angabe</option>
                            <option>weiblich</option>
                            <option>männlich</option>
                            <option>divers</option>
                          </select>
                        </label>
                        <label>
                          Kleidergröße
                          <input
                            required
                            value={campDetails.clothing_size}
                            onChange={(e) =>
                              setCampDetails((c) => ({
                                ...c,
                                clothing_size: e.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                    )}
                    {accounts.length > 1 && (
                      <label>
                        Zahlkonto
                        <select
                          required
                          value={customer}
                          onChange={(e) => setCustomer(e.target.value)}
                        >
                          <option value="">Bitte auswählen</option>
                          {accounts.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {chosen.decision.mode !== "change" && (
                      <label>
                        Rabattcode (optional)
                        <input
                          autoComplete="off"
                          maxLength={80}
                          placeholder="Code eingeben"
                          value={discountCode}
                          onChange={(e) => setDiscountCode(e.target.value)}
                        />
                        <small>
                          Der Code wird vor der Weiterleitung geprüft. Der
                          endgültige Betrag und die Rabattdauer werden bei
                          Stripe angezeigt. Camp-Mitgliederrabatte werden
                          automatisch berücksichtigt; Rabatte werden nicht
                          kombiniert, der höhere Rabatt gilt.
                        </small>
                      </label>
                    )}
                    {!ctx?.auth_id && (
                      <p className="product-checkout-note">
                        Nach erfolgreicher Zahlung speichern wir deine Buchung
                        und ordnen Eltern und Kind zu. Du erhältst danach einen
                        Link zur Bestätigung deines Portalzugangs.{" "}
                        {chosen.kind === "subscription" &&
                          "Dein Abo beginnt mit dem bei Stripe angezeigten Vertragsbeginn und läuft auch ohne bestätigten Portalzugang."}
                      </p>
                    )}
                    <p className="product-checkout-note">
                      Du prüfst deine Zahlungsangaben im nächsten Schritt bei
                      Stripe. Eine neue Mitgliedschaft wird erst nach
                      bestätigter Zahlung aktiviert.
                    </p>
                    {!payments && (
                      <p role="status">
                        Der Zahlungsabschluss ist in dieser Vorschau noch nicht
                        freigeschaltet.
                      </p>
                    )}
                    <button
                      className="primary-button"
                      disabled={busy || !payments}
                      type="submit"
                    >
                      {busy ? (
                        <LoaderCircle className="product-spin" size={17} />
                      ) : (
                        <ArrowRight size={17} />
                      )}{" "}
                      {chosen.decision.mode === "change"
                        ? "Wechselübersicht anzeigen"
                        : "Weiter zur Buchung"}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
