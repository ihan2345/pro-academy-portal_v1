"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, TriangleAlert, Circle } from "lucide-react";
import { formatDate, formatTime } from "@/lib/domain";
import { DashboardDisclosure } from "./dashboard-disclosure";
import {
  recentStripeNotice,
  openStripeNotice,
  STRIPE_NOTICE_PAGE_SIZE,
  type StripeNotice,
  type StripeNoticePage,
  type StripeNoticeState,
} from "@/lib/stripe-notices";

export function StripeNoticeOverview({
  section,
  onReview,
  revision = 0,
}: {
  section: "conflicts" | "activities";
  onReview?: (id: string) => void;
  revision?: number;
}) {
  const conflicts = section === "conflicts";
  const [window, setWindow] = useState<"month" | "all" | "open">("month"),
    [page, setPage] = useState(1),
    [data, setData] = useState<StripeNoticePage | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [saving, setSaving] = useState(""),
    [saveError, setSaveError] = useState("");
  const requestWindow = conflicts || window === "open" ? "all" : window,
    requestState = !conflicts && window === "open" ? "open" : "all",
    requestPage = conflicts ? 1 : page;
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      section,
      window: requestWindow,
      state: requestState,
      page: String(requestPage),
    });
    fetch(`/api/admin/stripe-overview?${query}`, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok)
          throw Error(
            result.error ?? "Stripe-Meldungen konnten nicht geladen werden.",
          );
        if (!abort.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [section, requestWindow, requestState, requestPage, retry, revision]);
  useEffect(() => {
    const refresh = () => {
      if (!saving) setRetry((n) => n + 1);
    };
    globalThis.addEventListener("focus", refresh);
    return () => globalThis.removeEventListener("focus", refresh);
  }, [saving]);
  const now = data ? Date.parse(data.checkedAt) : Date.now();
  const filtered = (data?.rows ?? []).filter((r) =>
    window === "open"
      ? openStripeNotice(r)
      : !conflicts || window === "all" || recentStripeNotice(r.at, now),
  );
  const total = conflicts ? filtered.length : (data?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / STRIPE_NOTICE_PAGE_SIZE));
  useEffect(() => {
    if (!loading && !error && page > pages) setPage(pages);
  }, [page, pages, loading, error]);
  const visible = conflicts
    ? filtered.slice(
        (page - 1) * STRIPE_NOTICE_PAGE_SIZE,
        page * STRIPE_NOTICE_PAGE_SIZE,
      )
    : filtered;
  const first = Math.max(1, Math.min(page - 2, pages - 4));
  async function decide(row: StripeNotice, state: StripeNoticeState) {
    setSaving(row.kind + row.id);
    setSaveError("");
    try {
      const response = await fetch("/api/admin/stripe-notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: row.token, state }),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(
          result.error ?? "Bearbeitungsstand konnte nicht gespeichert werden.",
        );
      setData((old) => {
        if (!old) return old;
        const previous = old.rows.find(
          (r) => r.id === row.id && r.kind === row.kind,
        );
        if (!previous) return old;
        const counted =
          previous.actionRequired &&
          recentStripeNotice(previous.at, Date.parse(old.checkedAt));
        const delta = counted
          ? Number(state === "open") - Number(previous.state === "open")
          : 0;
        return {
          ...old,
          openCount: Math.max(0, old.openCount + delta),
          total:
            !conflicts &&
            window === "open" &&
            openStripeNotice(previous) &&
            state !== "open"
              ? Math.max(0, old.total - 1)
              : old.total,
          rows: old.rows.map((r) =>
            r.id === row.id && r.kind === row.kind ? { ...r, state } : r,
          ),
        };
      });
      // Refill the server-paged open list after a successful acknowledgement.
      if (!conflicts && window === "open") setRetry((n) => n + 1);
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : "Speichern fehlgeschlagen.",
      );
    } finally {
      setSaving("");
    }
  }
  return (
    <DashboardDisclosure
      title={conflicts ? "Stripe/Abo-Konflikte" : "Stripe-Aktivitäten"}
      count={data?.openCount ?? 0}
      loading={loading}
      error={!!error || !!data?.warning}
      description="Der Badge zählt offene Aktionen der letzten 30 Tage – unabhängig vom gewählten Filter und der Seite. Erledigte und ignorierte Meldungen bleiben im Verlauf sichtbar."
    >
      <div className="stripe-conflict-toolbar">
        <div
          className="stripe-notice-filter"
          role="group"
          aria-label={conflicts ? "Konflikte filtern" : "Aktivitäten filtern"}
        >
          {(["month", "all", "open"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={window === value}
              title={
                value === "open"
                  ? "Alle Meldungen mit offenen Aktionen, einschließlich älterer Einträge"
                  : undefined
              }
              disabled={!!saving}
              onClick={() => {
                setWindow(value);
                setPage(1);
                setSaveError("");
              }}
            >
              {value === "month"
                ? "Letzte 30 Tage"
                : value === "all"
                  ? "Gesamt"
                  : "Offen"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={loading || !!saving}
          onClick={() => setRetry((n) => n + 1)}
        >
          Aktualisieren
        </button>
      </div>
      {window === "open" && (
        <p className="profile-muted stripe-notice-explanation">
          Alle Meldungen mit offenen Aktionen, einschließlich älterer Einträge.
        </p>
      )}
      {conflicts && (
        <p className="profile-muted stripe-notice-explanation">
          Die Markierung dokumentiert die Bearbeitung für alle Admins.
          Zahlungen, Abo-Sperren und Kinderzuordnungen werden dadurch nicht
          verändert.
        </p>
      )}
      {loading && <p role="status">Meldungen werden geladen …</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            className="secondary-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Erneut versuchen
          </button>
        </p>
      )}
      {saveError && (
        <p role="alert" className="profile-error">
          {saveError}
        </p>
      )}
      {data?.warning && !loading && !error && (
        <p role="alert">{data.warning}</p>
      )}
      {!loading && !error && (
        <>
          {!visible.length && (
            <p>
              {window === "open"
                ? "Keine Meldungen mit offenen Aktionen"
                : `${conflicts ? "Keine Konflikte" : "Keine Stripe-Aktivitäten"}${window === "month" ? " in den letzten 30 Tagen" : ""}`}{" "}
              vorhanden.
            </p>
          )}
          <div className="stripe-notice-list">
            {visible.map((row) => (
              <article
                key={row.kind + row.id}
                className={`stripe-billing-conflict stripe-notice-card ${row.state !== "open" ? "acknowledged" : ""}`}
              >
                <div className="stripe-billing-head">
                  <h3>{row.customer}</h3>
                  <span className={`stripe-notice-state ${row.state}`}>
                    {row.state === "done"
                      ? "Erledigt"
                      : row.state === "ignored"
                        ? "Ignoriert"
                        : row.actionRequired
                          ? "Offen"
                          : "Information"}
                  </span>
                </div>
                <div className="stripe-notice-title">
                  {row.actionRequired && row.state === "open" ? (
                    <TriangleAlert size={17} aria-hidden="true" />
                  ) : row.state === "done" ? (
                    <CheckCircle2 size={17} aria-hidden="true" />
                  ) : (
                    <Circle size={17} aria-hidden="true" />
                  )}
                  <strong>{row.title}</strong>
                </div>
                <small className="profile-muted">
                  <time dateTime={row.at}>
                    {formatDate(row.at)} · {formatTime(row.at)}
                  </time>{" "}
                  · {row.kind === "review" ? "Abo-Zuordnung" : "Stripe"}
                </small>
                {row.billing && (
                  <>
                    {!!row.billing.children.length && (
                      <p>
                        {row.billing.children.map((c, i) => (
                          <span key={c.id}>
                            {i > 0 && " · "}
                            <Link href={`/admin/spieler/${c.id}`}>
                              {c.name}
                            </Link>
                          </span>
                        ))}
                      </p>
                    )}
                    {row.billing.blocked && (
                      <p>
                        Abo derzeit eingeschränkt. Zahlungs- und Abo-Status
                        müssen geklärt werden.
                      </p>
                    )}
                    {row.billing.invoices.map((invoice) => (
                      <div className="stripe-billing-invoice" key={invoice.id}>
                        <span>
                          Offen:{" "}
                          <strong>
                            {new Intl.NumberFormat("de-DE", {
                              style: "currency",
                              currency: invoice.currency,
                            }).format(invoice.remaining / 100)}
                          </strong>
                          {invoice.number && ` · ${invoice.number}`}
                        </span>
                        <a href={invoice.href} target="_blank" rel="noreferrer">
                          Rechnung in Stripe prüfen ↗
                        </a>
                      </div>
                    ))}
                    <a
                      className="secondary-button"
                      href={row.billing.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abo in Stripe prüfen ↗
                    </a>
                  </>
                )}
                {row.reviewId && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onReview?.(row.reviewId!)}
                  >
                    Kinder und Vorschläge prüfen →
                  </button>
                )}
                {row.activity && (
                  <>
                    <p>
                      {
                        {
                          assigned: "Bereits zugeordnet",
                          unassigned: "Noch nicht zugeordnet",
                          partial: "Teilweise zugeordnet",
                          not_applicable: "Keine Abo-Zuordnung erforderlich",
                        }[row.activity.assignment]
                      }
                      {!!row.activity.children.length &&
                        ` · ${row.activity.children.join(" · ")}`}
                    </p>
                    {!!row.activity.trialCandidates?.length && (
                      <p className="stripe-notice-trial">
                        Mögliche Übernahme aus Probetraining:{" "}
                        {row.activity.trialCandidates.join(" · ")}. Vorhandene
                        Angaben können bei der Abo-Zuordnung übernommen werden.
                      </p>
                    )}
                    {row.activity.actionRequired && row.activity.href && (
                      <Link
                        className="secondary-button"
                        href={row.activity.href}
                      >
                        {row.activity.actionLabel} →
                      </Link>
                    )}
                  </>
                )}
                {row.actionRequired && (
                  <div
                    className="stripe-notice-actions"
                    aria-label={`Bearbeitungsstand für ${row.customer}`}
                  >
                    {row.state === "open" ? (
                      <>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!!saving || loading}
                          onClick={() => decide(row, "done")}
                        >
                          Erledigt
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!!saving || loading}
                          onClick={() => decide(row, "ignored")}
                        >
                          Ignorieren
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!!saving || loading}
                        onClick={() => decide(row, "open")}
                      >
                        Wieder öffnen
                      </button>
                    )}
                    {saving === row.kind + row.id && (
                      <span role="status">Wird gespeichert …</span>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          {!!total && (
            <nav
              className="stripe-notice-pagination"
              aria-label={conflicts ? "Konfliktseiten" : "Aktivitätsseiten"}
            >
              <span>
                {(page - 1) * STRIPE_NOTICE_PAGE_SIZE + 1}–
                {Math.min(page * STRIPE_NOTICE_PAGE_SIZE, total)} von {total}
              </span>
              <div>
                <button
                  className="secondary-button"
                  disabled={page === 1 || !!saving}
                  onClick={() => setPage((n) => n - 1)}
                >
                  Zurück
                </button>
                {first > 1 && (
                  <>
                    <button
                      className="secondary-button"
                      disabled={!!saving}
                      onClick={() => setPage(1)}
                    >
                      1
                    </button>
                    {first > 2 && <span>…</span>}
                  </>
                )}
                {Array.from(
                  { length: Math.min(5, pages) },
                  (_, i) => first + i,
                ).map((n) => (
                  <button
                    key={n}
                    className="secondary-button"
                    aria-label={`Seite ${n}`}
                    aria-current={page === n ? "page" : undefined}
                    disabled={!!saving}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </button>
                ))}
                {first + 4 < pages && (
                  <>
                    {first + 5 < pages && <span>…</span>}
                    <button
                      className="secondary-button"
                      disabled={!!saving}
                      onClick={() => setPage(pages)}
                    >
                      {pages}
                    </button>
                  </>
                )}
                <button
                  className="secondary-button"
                  disabled={page === pages || !!saving}
                  onClick={() => setPage((n) => n + 1)}
                >
                  Weiter
                </button>
              </div>
            </nav>
          )}
          {data && (
            <small className="profile-muted">
              Geprüft: {formatDate(data.checkedAt)} ·{" "}
              {formatTime(data.checkedAt)}
            </small>
          )}
        </>
      )}
    </DashboardDisclosure>
  );
}
