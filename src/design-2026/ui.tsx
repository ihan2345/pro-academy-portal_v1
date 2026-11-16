"use client";
// Design 2026: kleine Interaktions-Bausteine (Detail-Sheet, Zähl-Animation,
// Live-Uhr, Lichteffekt). Reine Darstellung, keine Daten oder Aktionen.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/** iOS-Sheet: unten auf dem Handy, rechts als Panel auf dem Desktop. */
export function Sheet({
  open,
  onClose,
  eyebrow,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => {
    if (prefersReducedMotion()) return onClose();
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 260);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className={`d26-sheet-layer ${closing ? "is-closing" : ""}`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={panel}
        className="d26-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <span className="d26-sheet-grabber" aria-hidden="true" />
        <header>
          <div>
            {eyebrow && <small>{eyebrow}</small>}
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="d26-sheet-close"
            aria-label="Schließen"
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <div className="d26-sheet-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Zahl zählt beim Erscheinen hoch. */
export function CountUp({
  value,
  duration = 900,
}: {
  value: number;
  duration?: number;
}) {
  const [shown, setShown] = useState(prefersReducedMotion() ? value : 0);
  useEffect(() => {
    if (prefersReducedMotion()) return setShown(value);
    let frame = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(value * eased));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <>{shown}</>;
}

/** Aktuelle Zeit, die sich im Takt aktualisiert. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Countdown "2 T 04:12:09" bis zu einem Zeitpunkt. */
export function Countdown({ to }: { to: string }) {
  const now = useNow(1000);
  const ms = Date.parse(to) - now;
  if (ms <= 0) return <span className="d26-countdown is-now">Jetzt</span>;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const parts = [
    Math.floor((s % 86400) / 3600),
    Math.floor((s % 3600) / 60),
    s % 60,
  ].map((n) => String(n).padStart(2, "0"));
  return (
    <span className="d26-countdown" aria-label="Zeit bis zum Training">
      {d > 0 && (
        <span>
          <b>{d}</b>
          <small>{d === 1 ? "Tag" : "Tage"}</small>
        </span>
      )}
      <span>
        <b>{parts[0]}</b>
        <small>Std</small>
      </span>
      <span>
        <b>{parts[1]}</b>
        <small>Min</small>
      </span>
      <span>
        <b>{parts[2]}</b>
        <small>Sek</small>
      </span>
    </span>
  );
}

/** Lichtschein folgt dem Mauszeiger auf Karten (setzt nur CSS-Variablen). */
const GLOW = ".d26-card, .d26-hero, .team-event";
export function glowFollow(e: {
  pointerType: string;
  target: EventTarget | null;
  clientX: number;
  clientY: number;
}) {
  if (e.pointerType !== "mouse") return;
  const card = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(GLOW);
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${e.clientX - r.left}px`);
  card.style.setProperty("--my", `${e.clientY - r.top}px`);
}

/** Lichtschein für alle Karten im Portal, ein Listener für die ganze Seite. */
export function GlowLayer() {
  useEffect(() => {
    const move = (e: PointerEvent) => glowFollow(e);
    document.addEventListener("pointermove", move, { passive: true });
    return () => document.removeEventListener("pointermove", move);
  }, []);
  return null;
}

/** Einfache horizontale Balkenliste für Aufschlüsselungen in Sheets. */
export function BreakdownBars({
  rows,
  unit = "",
}: {
  rows: { label: string; value: number; tone?: string; hint?: string }[];
  unit?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="d26-breakdown">
      {rows.map((r) => (
        <li key={r.label} data-tip={r.hint}>
          <span>{r.label}</span>
          <i>
            <em
              className={r.tone ? `tone-${r.tone}` : ""}
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </i>
          <b>
            {r.value}
            {unit}
          </b>
        </li>
      ))}
    </ul>
  );
}
