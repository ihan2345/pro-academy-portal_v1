"use client";
// Design 2026: Kopf der Familienseite (Eltern und Verwaltung). Ersetzt nur die
// Darstellung von Profilkopf und Familienstatus. Bearbeiten öffnet weiterhin
// den bestehenden Dialog, Daten kommen unverändert aus dem Elternprofil.
import { useEffect, useState } from "react";
import {
  CalendarDays,
  Crown,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Timer,
  Users,
} from "lucide-react";
import type { ParentProfile } from "@/lib/parent-profile";
import { durationLabel, formatDate } from "@/lib/domain";
import { CountUp } from "./ui";

const tiers = [
  { key: "starter", label: "Start", at: 0 },
  { key: "bronze", label: "Bronze", at: 3 },
  { key: "silver", label: "Silber", at: 6 },
  { key: "gold", label: "Gold", at: 10 },
  { key: "ultimate", label: "Ultimativ", at: 16 },
];

const sections: [string, string][] = [
  [".profile-children", "Kinder"],
  [".profile-calendar-layout", "Kalender & Einheiten"],
  [".profile-finances", "Finanzen"],
  [".profile-stamp-picker", "Stempelkarte"],
  ["#geschenkkarten", "Geschenkkarten"],
];

function jump(selector: string) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
    block: "start",
  });
  el.classList.remove("d26-flash");
  void (el as HTMLElement).offsetWidth;
  el.classList.add("d26-flash");
}

export function FamilyHero({
  data,
  status,
  childCount,
  canEdit,
  locked,
  onEdit,
  access,
}: {
  data: ParentProfile;
  status: { tier: string; label: string; target: number; progress: number };
  childCount: number;
  canEdit: boolean;
  locked: boolean;
  onEdit: () => void;
  access?: React.ReactNode;
}) {
  const [present, setPresent] = useState<[string, string][]>([]);
  useEffect(() => {
    const t = setTimeout(
      () => setPresent(sections.filter(([s]) => document.querySelector(s))),
      400,
    );
    return () => clearTimeout(t);
  }, [data.id]);
  const active = data.children.filter((c) => !c.archived);
  const sum = (k: "month" | "all", f: "count" | "minutes") =>
    active.reduce((s, c) => s + c.stats[k][f], 0);
  const days = Object.values(data.calendar);
  const attended = days.reduce((s, d) => s + d.attended, 0);
  const planned = days.reduce((s, d) => s + d.planned, 0);
  const monthName = /^\d{4}-\d{2}/.test(data.month ?? "")
    ? formatDate(`${data.month.slice(0, 7)}-15T12:00:00Z`, { month: "long" })
    : "Monat";
  const tiles = [
    {
      icon: Users,
      value: childCount,
      label: childCount === 1 ? "Kind" : "Kinder",
      tip: active.map((c) => c.first_name).join(", ") || "Noch keine Kinder",
      target: ".profile-children",
    },
    {
      icon: CalendarDays,
      value: attended,
      label: `Einheiten im ${monthName}`,
      tip: `${attended} teilgenommen · ${planned} geplant`,
      target: ".profile-calendar-layout",
    },
    {
      icon: Timer,
      text: durationLabel(sum("month", "minutes")),
      label: "Trainingszeit im Monat",
      tip: `Gesamt ${durationLabel(sum("all", "minutes"))} in ${sum("all", "count")} Einheiten`,
      target: ".profile-calendar-layout",
    },
    {
      icon: Crown,
      value: data.months,
      label: "Statusmonate",
      tip:
        data.earned_months !== undefined
          ? `${data.earned_months} aktive Abo-Monate${data.deducted_months ? ` − ${data.deducted_months} Abzug` : ""}`
          : data.history_note,
      target: "",
    },
  ];
  const showStatus = data.has_subscription_history !== false;
  const max = tiers[tiers.length - 1].at;
  return (
    <div className="d26-family">
      <section className={`d26-card d26-family-hero tier-${status.tier}`}>
        <div className="d26-family-id">
          <span className="d26-family-avatar">
            {data.name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w.charAt(0).toUpperCase())
              .join("")}
          </span>
          <div>
            <span className="d26-eyebrow">
              {data.role === "parent"
                ? "Deine Academy-Familie"
                : "Elternprofil"}
            </span>
            <h1>{data.name}</h1>
            {access}
          </div>
          {canEdit && (
            <button
              type="button"
              className="d26-btn is-ghost"
              disabled={locked}
              onClick={onEdit}
              data-tip={
                locked && data.next_edit_at
                  ? `Erneut bearbeitbar ab ${formatDate(data.next_edit_at, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
                  : "Telefon und Ort ändern"
              }
            >
              <Pencil size={15} /> Bearbeiten
            </button>
          )}
        </div>
        <div className="d26-family-contacts">
          <a href={`mailto:${data.email}`}>
            <Mail size={14} /> {data.email}
          </a>
          {data.phone ? (
            <a href={`tel:${data.phone}`}>
              <Phone size={14} /> {data.phone}
            </a>
          ) : (
            <span>
              <Phone size={14} /> Telefon fehlt
            </span>
          )}
          <span>
            <MapPin size={14} /> {data.city || "Ort fehlt"}
          </span>
          <span>
            <Users size={14} /> {childCount}{" "}
            {childCount === 1 ? "Kind" : "Kinder"}
          </span>
        </div>
        {showStatus && (
          <div className="d26-tier">
            <div className="d26-tier-head">
              <b>{status.label}</b>
              <small>
                {status.tier === "ultimate"
                  ? `${data.months} Statusmonate, höchste Stufe erreicht`
                  : `${data.months} von ${status.target} Monaten bis zur nächsten Stufe`}
              </small>
            </div>
            <div className="d26-tier-track">
              <i
                style={{
                  width: `${Math.min(100, (data.months / max) * 100)}%`,
                }}
              />
              {tiers.map((t) => (
                <span
                  key={t.key}
                  className={data.months >= t.at ? "is-reached" : ""}
                  style={{ left: `${(t.at / max) * 100}%` }}
                  data-tip={`${t.label} ab ${t.at} Monaten`}
                >
                  <em>{t.label}</em>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
      <div className="d26-kpis">
        {tiles.map((t) => (
          <button
            key={t.label}
            type="button"
            data-tip={t.tip}
            className="d26-card d26-kpi is-tappable"
            onClick={() => t.target && jump(t.target)}
          >
            <t.icon size={18} />
            <b className={t.text ? "is-text" : ""}>
              {t.text ?? <CountUp value={t.value ?? 0} />}
            </b>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {present.length > 1 && (
        <nav className="d26-chips d26-jumpbar" aria-label="Bereiche">
          {present.map(([s, label]) => (
            <button
              key={s}
              type="button"
              className="d26-chip"
              onClick={() => jump(s)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
