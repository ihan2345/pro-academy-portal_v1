"use client";
import { ChevronRight } from "lucide-react";
import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import { CountUp, Sheet } from "@/design-2026/ui";

/**
 * Design 2026 (Admin-Zentrale): Steht ein Aufklapp-Bereich in diesem Kontext,
 * erscheint er oben als Kachel (Chip) mit Zähler und Hover-Info. Antippen
 * öffnet denselben Inhalt als Sheet. Außerhalb bleibt er ein Aufklapp-Menü.
 */
export const DisclosureAsChip = createContext(false);

export function DashboardDisclosure({
  title,
  count,
  loading,
  error,
  description,
  icon,
  tip,
  children,
}: {
  title: string;
  count: number;
  loading?: boolean;
  error?: boolean;
  description: string;
  /** Symbol der Kachel in der Chip-Ansicht. */
  icon?: ReactNode;
  /** Kurze Hover-Info der Kachel in der Chip-Ansicht. */
  tip?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const body = useId();
  const asChip = useContext(DisclosureAsChip);
  const countLabel = error
    ? "Prüfung nicht verfügbar"
    : loading
      ? "Offene Aktionen werden geprüft"
      : `${count} ${count === 1 ? "offene Aktion" : "offene Aktionen"}`;
  if (asChip)
    return (
      <>
        <button
          type="button"
          className={`d26-card d26-kpi d26-inbox-chip is-tappable ${!loading && (error || count) ? "is-alert" : ""}`}
          data-tip={tip ?? description}
          aria-label={`${title}: ${countLabel}`}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          {icon}
          <b aria-live="polite">
            {loading ? "…" : error ? "!" : <CountUp value={count} />}
          </b>
          <span>
            {title} <ChevronRight size={13} />
          </span>
        </button>
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          eyebrow={`Posteingang · ${countLabel}`}
          title={title}
          wide
        >
          <div className="d26-inbox-sheet">
            <p className="profile-muted">{description}</p>
            {children}
          </div>
        </Sheet>
      </>
    );
  return (
    <section className="panel dashboard-disclosure" aria-label={title}>
      <h2>
        <button
          type="button"
          className="dashboard-disclosure-toggle"
          aria-expanded={open}
          aria-controls={body}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronRight
            className={open ? "expanded" : ""}
            size={18}
            aria-hidden="true"
          />
          <span>{title}</span>
          <span
            className={`dashboard-action-count ${error ? "error" : count ? "pending" : "clear"}`}
            aria-live="polite"
            aria-label={countLabel}
          >
            {loading ? "…" : error ? "!" : count}
          </span>
          <span className="dashboard-disclosure-hint">
            {open ? "Zuklappen" : "Öffnen"}
          </span>
        </button>
      </h2>
      <div id={body} hidden={!open} className="dashboard-disclosure-body">
        <p className="profile-muted">{description}</p>
        {children}
      </div>
    </section>
  );
}
