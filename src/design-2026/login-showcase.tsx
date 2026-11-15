// Design 2026: Bühne neben dem Anmeldeformular. Reine Darstellung.
import { CalendarDays, FileText, Stamp } from "lucide-react";

const features = [
  {
    icon: CalendarDays,
    title: "Nächstes Training im Blick",
    text: "Mit Live-Countdown, Route und Kalender-Export.",
  },
  {
    icon: Stamp,
    title: "Stempelkarte & Fortschritt",
    text: "Jede Einheit, jede Woche, jeder Zeitraum.",
  },
  {
    icon: FileText,
    title: "Berichte als PDF",
    text: "Nach jedem Leistungszeitraum automatisch.",
  },
];

export function LoginShowcase() {
  return (
    <aside className="d26-login-stage" aria-hidden="true">
      <svg viewBox="0 0 220 220" className="d26-login-rings">
        {[
          ["#8eff01", 96, 0.78],
          ["#8b53fe", 74, 0.62],
          ["#22c3ff", 52, 0.45],
        ].map(([color, r, share]) => {
          const c = 2 * Math.PI * Number(r);
          return (
            <g key={String(color)}>
              <circle
                cx="110"
                cy="110"
                r={Number(r)}
                fill="none"
                stroke={String(color)}
                strokeOpacity="0.16"
                strokeWidth="16"
              />
              <circle
                className="d26-ring-arc"
                cx="110"
                cy="110"
                r={Number(r)}
                fill="none"
                stroke={String(color)}
                strokeWidth="16"
                strokeLinecap="round"
                strokeDasharray={`${c * Number(share)} ${c}`}
                transform="rotate(-90 110 110)"
              />
            </g>
          );
        })}
      </svg>
      <h2>
        Dein Spiel.
        <br />
        <span>Deine Entwicklung.</span>
      </h2>
      <ul>
        {features.map((f) => (
          <li key={f.title}>
            <i>
              <f.icon size={18} />
            </i>
            <div>
              <b>{f.title}</b>
              <small>{f.text}</small>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
