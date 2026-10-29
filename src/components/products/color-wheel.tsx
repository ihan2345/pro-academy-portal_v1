"use client";

import { useId, useState, type PointerEvent } from "react";

function toHsv(hex: string) {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const h = !d
    ? 0
    : max === r
      ? ((g - b) / d) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function toHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`.toUpperCase();
}

export function EffectColorWheel({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const id = useId();
  const current = toHsv(value);
  // Keep the chosen hue when moving to white/black, where HEX has no hue.
  const [lastHue, setLastHue] = useState(current.h);
  const h = current.s && current.v ? current.h : lastHue;
  const [hex, setHex] = useState<string | null>(null);
  function update(hue: number, saturation = current.s, brightness = current.v) {
    setLastHue(hue);
    setHex(null);
    onChange(toHex(hue, saturation, brightness));
  }
  function point(event: PointerEvent<HTMLDivElement>, wheel: boolean) {
    if (
      event.type === "pointermove" &&
      !event.currentTarget.hasPointerCapture(event.pointerId)
    )
      return;
    if (event.type === "pointerdown")
      event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (wheel)
      update(((Math.atan2(y - 0.5, x - 0.5) * 180) / Math.PI + 450) % 360);
    else
      update(h, Math.max(0, Math.min(1, x)), 1 - Math.max(0, Math.min(1, y)));
  }
  return (
    <fieldset className="product-color-picker">
      <legend>Effektfarbe</legend>
      <div className="product-color-picker-body">
        <div
          className="product-color-wheel"
          onPointerDown={(e) => point(e, true)}
          onPointerMove={(e) => point(e, true)}
        >
          <div className="product-color-wheel-hole" />
          <span
            className="product-color-hue-marker"
            style={{
              transform: `rotate(${h}deg) translateY(-91px)`,
              background: `hsl(${h} 100% 50%)`,
            }}
          />
          <div
            className="product-color-square"
            style={{ backgroundColor: `hsl(${h} 100% 50%)` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              point(e, false);
            }}
            onPointerMove={(e) => {
              e.stopPropagation();
              point(e, false);
            }}
          >
            <span
              style={{
                left: `${current.s * 100}%`,
                top: `${(1 - current.v) * 100}%`,
                background: value,
              }}
            />
          </div>
        </div>
        <div className="product-color-values">
          <label htmlFor={`${id}-hex`}>HEX-Farbwert</label>
          <div className="product-color-hex">
            <span style={{ background: value }} aria-hidden="true" />
            <input
              id={`${id}-hex`}
              value={hex ?? value.toUpperCase()}
              maxLength={7}
              spellCheck={false}
              onChange={(e) => {
                const next = e.target.value;
                setHex(next);
                if (/^#[0-9a-f]{6}$/i.test(next)) {
                  onChange(next.toUpperCase());
                  setLastHue(toHsv(next).h);
                }
              }}
              onBlur={() => setHex(null)}
            />
          </div>
          <label>
            Farbton
            <input
              type="range"
              min="0"
              max="359"
              value={Math.round(h)}
              onChange={(e) => update(Number(e.target.value))}
            />
          </label>
          <label>
            Sättigung
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(current.s * 100)}
              onChange={(e) => update(h, Number(e.target.value) / 100)}
            />
          </label>
          <label>
            Helligkeit
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(current.v * 100)}
              onChange={(e) =>
                update(h, current.s, Number(e.target.value) / 100)
              }
            />
          </label>
        </div>
      </div>
      <p>
        Färbt die Produktbühne im Shop. Wird mit „Entwurf speichern“ am Produkt
        gespeichert.
      </p>
    </fieldset>
  );
}
