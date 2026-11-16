"use client";
// Design 2026: einheitlicher Seitenkopf wie in der Zentrale. Großer Titel mit
// Datum, ein Satz zur Lage, Aktionen rechts und Kennzahlen, die ein
// Detail-Sheet öffnen oder einen Filter setzen. Nur Darstellung.
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatDate } from "@/lib/domain";
import { CountUp, Sheet } from "./ui";
import { useMounted } from "./parent-experience";

export type HeadKpi = {
  icon: React.ComponentType<{ size?: number }>;
  value: number | string;
  label: string;
  tip?: string;
  alert?: boolean;
  active?: boolean;
  onClick?: () => void;
  sheet?: {
    title: string;
    eyebrow?: string;
    body: React.ReactNode | ((close: () => void) => React.ReactNode);
  };
};

export function PageHead({
  eyebrow,
  title,
  greeting,
  actions,
  kpis,
}: {
  eyebrow?: string;
  title: string;
  greeting?: React.ReactNode;
  actions?: React.ReactNode;
  kpis?: HeadKpi[];
}) {
  const mounted = useMounted();
  const [open, setOpen] = useState<number | null>(null);
  const sheet = open === null ? undefined : kpis?.[open]?.sheet;
  return (
    <div className="d26-experience d26-page-head" style={{ order: 0 }}>
      <header className="d26-large-title">
        <div>
          <span suppressHydrationWarning>
            {eyebrow ??
              (mounted
                ? formatDate(new Date().toISOString(), {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })
                : " ")}
          </span>
          <h1>{title}</h1>
        </div>
        {actions && <div className="d26-head-actions">{actions}</div>}
      </header>
      {greeting && <p className="d26-greeting">{greeting}</p>}
      {!!kpis?.length && (
        <div className={`d26-kpis is-${Math.min(kpis.length, 5)}`}>
          {kpis.map((k, i) => {
            const tappable = !!(k.onClick || k.sheet);
            const body = (
              <>
                <k.icon size={18} />
                <b className={typeof k.value === "string" ? "is-text" : ""}>
                  {typeof k.value === "number" ? (
                    <CountUp value={k.value} />
                  ) : (
                    k.value
                  )}
                </b>
                <span>
                  {k.label}
                  {tappable && <ChevronRight size={13} />}
                </span>
              </>
            );
            const cls = `d26-card d26-kpi ${tappable ? "is-tappable" : ""} ${k.alert ? "is-alert" : ""} ${k.active ? "is-selected" : ""}`;
            return tappable ? (
              <button
                key={k.label}
                type="button"
                className={cls}
                data-tip={k.tip}
                onClick={() => (k.sheet ? setOpen(i) : k.onClick?.())}
              >
                {body}
              </button>
            ) : (
              <div key={k.label} className={cls} data-tip={k.tip}>
                {body}
              </div>
            );
          })}
        </div>
      )}
      <Sheet
        open={!!sheet}
        onClose={() => setOpen(null)}
        eyebrow={sheet?.eyebrow}
        title={sheet?.title ?? ""}
      >
        {typeof sheet?.body === "function"
          ? sheet.body(() => setOpen(null))
          : sheet?.body}
      </Sheet>
    </div>
  );
}

/** Einfache Zeile für Listen in Sheets. */
export function SheetRow({
  title,
  meta,
  pill,
  href,
  onClick,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  pill?: React.ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span>
        <b>{title}</b>
        {meta && <small>{meta}</small>}
      </span>
      {pill && <span className="d26-pill">{pill}</span>}
      {(href || onClick) && <ChevronRight size={16} className="d26-chevron" />}
    </>
  );
  if (onClick)
    return (
      <button
        type="button"
        className="d26-mini-event d26-sheet-row"
        onClick={onClick}
      >
        {inner}
      </button>
    );
  return href ? (
    <a className="d26-mini-event d26-sheet-row" href={href}>
      {inner}
    </a>
  ) : (
    <div className="d26-mini-event d26-sheet-row">{inner}</div>
  );
}
