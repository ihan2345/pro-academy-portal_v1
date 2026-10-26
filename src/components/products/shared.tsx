"use client";
import { useState, useId } from "react";
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
  return (
    <span className="product-hint">
      <button
        type="button"
        aria-label="Information anzeigen"
        aria-describedby={id}
      >
        <Info size={15} />
      </button>
      <span id={id} role="tooltip">
        {children}
      </span>
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
            height={400}
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
