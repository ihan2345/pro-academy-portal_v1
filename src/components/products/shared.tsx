"use client";
import { useState, useId, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Info, Check, ImageIcon, ArrowUpRight } from "lucide-react";
import {
  priceLabel,
  trainingContentLabel,
  kindLabels,
  type Product,
  type ProductPrice,
} from "@/lib/products/domain";
import type { Decision } from "@/lib/products/policy";
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
>;
export function ProductCard({
  product,
  decision,
  onAction,
  preview = false,
}: {
  product: ProductDisplay;
  decision?: Decision;
  onAction?: () => void;
  preview?: boolean;
}) {
  return (
    <article className={`product-card ${product.featured ? "featured" : ""}`}>
      <div className="product-card-visual">
        {product.asset_ids[0] ? (
          <img
            src={`/api/products/image/${product.asset_ids[0]}`}
            alt={product.name}
            loading="lazy"
            width={640}
            height={640}
          />
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
        <div className="product-card-price">{priceLabel(product.price)}</div>
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
        {decision?.reasons.length ? <small>{decision.reasons[0]}</small> : null}
      </div>
    </article>
  );
}
