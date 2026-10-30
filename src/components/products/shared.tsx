"use client";
import { useState, useId, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import {
  Info,
  Check,
  ImageIcon,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  BadgePercent,
} from "lucide-react";
import {
  priceLabel,
  trainingContentLabel,
  kindLabels,
  type Product,
  type ProductPrice,
} from "@/lib/products/domain";
import type { Decision } from "@/lib/products/policy";
import type { CampPricing } from "@/lib/products/camp-pricing";
export async function productRequest<T = any>(
  url: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers:
      data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Anfrage fehlgeschlagen.");
  return result;
}
export function Hint({ children }: { children: React.ReactNode }) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!anchor.current || !tooltip.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const hint = tooltip.current.getBoundingClientRect();
      const gap = 8,
        edge = 12;
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setPosition(null);
        return;
      }
      const left = Math.max(
        edge,
        Math.min(
          rect.left + rect.width / 2 - hint.width / 2,
          window.innerWidth - hint.width - edge,
        ),
      );
      const above = rect.top - hint.height - gap;
      const top = Math.max(
        edge,
        Math.min(
          above >= edge ? above : rect.bottom + gap,
          window.innerHeight - hint.height - edge,
        ),
      );
      setPosition({ left, top });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  function close() {
    setOpen(false);
    setPosition(null);
  }
  return (
    <span
      className="product-hint"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!anchor.current?.matches(":focus-visible")) close();
      }}
    >
      <button
        ref={anchor}
        type="button"
        aria-label="Information anzeigen"
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        <Info size={15} />
      </button>
      {open &&
        createPortal(
          <span
            ref={tooltip}
            id={id}
            role="tooltip"
            className="product-tooltip"
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              visibility: position ? "visible" : "hidden",
            }}
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="product-toggle-row">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`product-switch ${checked ? "on" : ""}`}
      >
        <span />
      </button>
    </label>
  );
}
export function SearchSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  const [search, setSearch] = useState("");
  const selectId = useId();
  const visible = options.filter(
    (o) =>
      o.label.toLowerCase().includes(search.toLowerCase()) || o.value === value,
  );
  return (
    <div className="product-search-select">
      <label htmlFor={selectId}>{label}</label>
      <input
        aria-label={`${label} durchsuchen`}
        type="search"
        placeholder="Auswahl durchsuchen …"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        id={selectId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Bitte auswählen</option>
        {visible.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
export type ProductDisplay = Pick<
  Product,
  | "name"
  | "kind"
  | "short_description"
  | "description"
  | "category"
  | "price"
  | "featured"
  | "asset_ids"
  | "training_content"
> &
  Partial<Pick<Product, "effect_color" | "sale_enabled" | "sale_audiences">> & {
    camp_pricing?: CampPricing;
  };

export function CampPriceNote({ product }: { product: ProductDisplay }) {
  const info = product.camp_pricing;
  if (
    product.kind !== "camp" ||
    !info ||
    (!info.early_until && !info.benefit_available)
  )
    return null;
  const personal = info.personal_amount != null;
  return (
    <div className="product-camp-price-note">
      <div className="product-camp-price-badges">
        {info.early_until && (
          <span className="product-early-badge">
            <Sparkles size={13} aria-hidden="true" /> Frühbucher
          </span>
        )}
        {info.benefit_available && (
          <span className="product-benefit-badge">
            <BadgePercent size={14} aria-hidden="true" />
            {personal ? `${info.percent} % Abo-Vorteil` : "Abo-Vorteil möglich"}
          </span>
        )}
      </div>
      {info.benefit_available && (
        <div className="product-personal-price">
          <span className="product-personal-price-heading">
            {personal ? "Dein persönlicher Preis" : "Dein Abo-Vorteil"}
            <Hint>
              {personal
                ? `${info.percent} % Abo-Vorteil für ${info.child_name} auf den ${info.early_until ? "bereits reduzierten Frühbucherpreis" : "Camppreis"}. Der Vorteil wird beim Buchen automatisch berücksichtigt.`
                : "Mit einem berechtigten aktiven Abo erhält dein Kind einen zusätzlichen Camp-Vorteil – auch auf den Frühbucherpreis. Melde dich an und wähle dein Kind aus, um deinen persönlichen Preis zu sehen."}
            </Hint>
          </span>
          {personal ? (
            <>
              <strong>
                {new Intl.NumberFormat("de-DE", {
                  style: "currency",
                  currency: product.price?.currency ?? "eur",
                }).format(info.personal_amount! / 100)}
              </strong>
              <small>
                Für {info.child_name} ·{" "}
                {info.early_until
                  ? "Frühbucher + Abo-Vorteil"
                  : "Abo-Vorteil inklusive"}
              </small>
            </>
          ) : (
            <small>
              {info.child_name
                ? "Für dieses Kind ist aktuell kein zusätzlicher Vorteil hinterlegt."
                : "Anmelden & Kind auswählen"}
            </small>
          )}
        </div>
      )}
      {info.early_until && (
        <small className="product-early-deadline">
          Bis{" "}
          {new Intl.DateTimeFormat("de-DE", {
            timeZone: "Europe/Berlin",
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(info.early_until))}{" "}
          Uhr
        </small>
      )}
    </div>
  );
}
function saleApplies(
  product: ProductDisplay,
  decision?: Decision,
  preview = false,
) {
  return (
    product.sale_enabled &&
    (preview ||
      product.sale_audiences?.some(
        (a) => a === "all" || decision?.audiences.includes(a),
      ))
  );
}

export function ProductShowcase({
  products,
  onAction,
}: {
  products: (ProductDisplay & { id: string; decision: Decision })[];
  onAction: (
    product: ProductDisplay & { id: string; decision: Decision },
  ) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [outgoing, setOutgoing] = useState<{
    product: (typeof products)[number];
    key: number;
  } | null>(null);
  const [direction, setDirection] = useState(1);
  const transitionKey = useRef(0);
  const index = Math.max(
    0,
    products.findIndex((p) => p.id === selected),
  );
  const product = products[index];
  if (!product) return null;
  function select(id: string, flightDirection: number) {
    if (id === product.id) return;
    setDirection(flightDirection);
    setOutgoing(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? null
        : { product, key: ++transitionKey.current },
    );
    setSelected(id);
  }
  const move = (step: number) =>
    select(
      products[(index + step + products.length) % products.length].id,
      step,
    );
  return (
    <section
      className="product-showcase"
      aria-label="Angebote entdecken"
      aria-roledescription="Karussell"
      style={
        {
          "--product-effect": product.effect_color ?? "#8B53FE",
          "--product-flight-direction": direction,
        } as React.CSSProperties
      }
    >
      <div className="product-showcase-topline">
        <span>
          PROACADEMY <span> / DEIN NÄCHSTES LEVEL</span>
        </span>
        <span>
          {String(index + 1).padStart(2, "0")} /{" "}
          {String(products.length).padStart(2, "0")}
        </span>
      </div>
      <div className="product-showcase-controls">
        <button
          type="button"
          aria-label="Vorheriges Produkt"
          disabled={products.length < 2}
          onClick={() => move(-1)}
        >
          <ArrowLeft size={18} />
        </button>
        <button
          type="button"
          aria-label="Nächstes Produkt"
          disabled={products.length < 2}
          onClick={() => move(1)}
        >
          <ArrowRight size={18} />
        </button>
      </div>
      <div className="product-showcase-stage" data-transition={!!outgoing}>
        {outgoing && (
          <div
            key={`out-${outgoing.key}`}
            className="product-showcase-slide is-leaving"
            aria-hidden="true"
            inert
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return;
              setOutgoing((current) =>
                current?.key === outgoing.key ? null : current,
              );
            }}
          >
            <ProductCard product={outgoing.product} stage preview />
          </div>
        )}
        <div
          key={product.id}
          className="product-showcase-slide is-current"
          aria-live="polite"
        >
          <ProductCard
            product={product}
            decision={
              product.decision.mode === "select_child"
                ? { ...product.decision, purchasable: true }
                : product.decision
            }
            onAction={() => onAction(product)}
            stage
          />
        </div>
      </div>
      <div className="product-showcase-footer">
        <span>Dein Spiel. Dein Weg.</span>
        <div
          className="product-showcase-thumbnails"
          aria-label="Produkt auswählen"
        >
          {products.map((p, i) => (
            <button
              type="button"
              key={p.id}
              aria-label={p.name}
              aria-pressed={p.id === product.id}
              title={p.name}
              onClick={() => select(p.id, i > index ? 1 : -1)}
              style={
                {
                  "--thumbnail-effect": p.effect_color ?? "#8B53FE",
                } as React.CSSProperties
              }
            >
              {p.asset_ids[0] ? (
                <img
                  src={`/api/products/image/${p.asset_ids[0]}`}
                  alt=""
                  width={48}
                  height={48}
                  loading="lazy"
                />
              ) : (
                <ShoppingBagIcon kind={p.kind} />
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ShoppingBagIcon({ kind }: { kind: Product["kind"] }) {
  return (
    <span className="product-art-monogram" aria-hidden="true">
      {kind === "camp" ? "C" : kind === "subscription" ? "P" : "+"}
    </span>
  );
}

export function ProductCard({
  product,
  decision,
  onAction,
  preview = false,
  stage = false,
}: {
  product: ProductDisplay;
  decision?: Decision;
  onAction?: () => void;
  preview?: boolean;
  stage?: boolean;
}) {
  const action = (
    <button
      type="button"
      className="primary-button"
      disabled={
        preview || (!decision?.purchasable && decision?.mode !== "register")
      }
      onClick={onAction}
    >
      {decision?.label ?? "Vorschau"}
      <ArrowUpRight size={16} />
    </button>
  );
  if (stage)
    return (
      <article
        className="product-stage"
        style={
          {
            "--product-effect": product.effect_color ?? "#8B53FE",
          } as React.CSSProperties
        }
      >
        <div className="product-stage-copy">
          <span className="product-kicker">
            {product.category || kindLabels[product.kind]}
          </span>
          <h2>{product.name}</h2>
          <p>
            {product.short_description ||
              product.description ||
              "Training, das dich weiterbringt."}
          </p>
          {trainingContentLabel(product) && (
            <p className="product-stage-training">
              {trainingContentLabel(product)}
            </p>
          )}
          {action}
          {decision?.reasons[0] && <small>{decision.reasons[0]}</small>}
        </div>
        <div className="product-stage-art">
          {product.asset_ids[0] ? (
            <div className="product-art-card">
              <img
                src={`/api/products/image/${product.asset_ids[0]}`}
                alt={product.name}
                width={640}
                height={640}
              />
            </div>
          ) : (
            <div className="product-stage-emblem">
              <span>PROACADEMY</span>
              <ShoppingBagIcon kind={product.kind} />
              <span>{kindLabels[product.kind]}</span>
            </div>
          )}
        </div>
        <div className="product-stage-price">
          {product.featured && (
            <span className="product-stage-recommendation">
              Unsere Empfehlung
            </span>
          )}
          {saleApplies(product, decision, preview) && (
            <span className="product-sale-label">Aktionspreis</span>
          )}
          <strong>
            {product.price
              ? new Intl.NumberFormat("de-DE", {
                  style: "currency",
                  currency: product.price.currency,
                }).format(product.price.amount / 100)
              : "Preis folgt"}
          </strong>
          <span>
            {product.price?.interval === "month"
              ? "pro Monat"
              : product.price?.interval === "year"
                ? "pro Jahr"
                : "einmalig"}
          </span>
          <CampPriceNote product={product} />
        </div>
      </article>
    );
  return (
    <article
      className={`product-card ${product.featured ? "featured" : ""} ${product.effect_color ? "has-effect" : ""}`}
      style={
        { "--product-effect": product.effect_color } as React.CSSProperties
      }
    >
      <div className="product-card-visual">
        {product.asset_ids[0] ? (
          <div className="product-card-image-stage">
            <div className="product-art-card">
              <img
                src={`/api/products/image/${product.asset_ids[0]}`}
                alt={product.name}
                loading="lazy"
                width={640}
                height={640}
              />
            </div>
          </div>
        ) : (
          <div className={`product-visual-placeholder ${product.kind}`}>
            <span>PROACADEMY</span>
            <ImageIcon size={38} />
            <strong>{kindLabels[product.kind]}</strong>
          </div>
        )}
        {product.featured && (
          <span className="product-feature-tag">Unsere Empfehlung</span>
        )}
      </div>
      <div className="product-card-content">
        <span className="product-kicker">
          {product.category || kindLabels[product.kind]}
        </span>
        <h3>{product.name}</h3>
        <p>{product.short_description || "Training, das dich weiterbringt."}</p>
        {trainingContentLabel(product) && (
          <p className="product-training-content">
            {trainingContentLabel(product)}
          </p>
        )}
        <div className="product-card-price">
          {saleApplies(product, decision, preview) && (
            <span className="product-sale-label">Aktionspreis</span>
          )}
          {priceLabel(product.price)}
        </div>
        <CampPriceNote product={product} />
        {action}
        {decision?.reasons.length ? <small>{decision.reasons[0]}</small> : null}
      </div>
    </article>
  );
}
