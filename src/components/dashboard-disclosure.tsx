"use client";
import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export function DashboardDisclosure({
  title,
  count,
  loading,
  error,
  description,
  children,
}: {
  title: string;
  count: number;
  loading?: boolean;
  error?: boolean;
  description: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const body = useId();
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
            aria-label={
              error
                ? "Prüfung nicht verfügbar"
                : loading
                  ? "Offene Aktionen werden geprüft"
                  : `${count} ${count === 1 ? "offene Aktion" : "offene Aktionen"}`
            }
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
