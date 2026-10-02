"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BackfillForm } from "./backfill-form";
import { Download, Mail, RefreshCw } from "lucide-react";
import type { PortalData } from "@/lib/types";
import type { ReportSnapshot } from "@/lib/pdf";
import {
  attendanceStats,
  disciplineStats,
  durationLabel,
  formatDate,
  formatTime,
  periodLabel,
  STATUS_LABELS,
} from "@/lib/domain";
import { BackfillNotes, ExcusedNotes } from "./attendance-notes";
import { Stamps, StampLegend } from "./portal";

type Card = {
  snapshot: ReportSnapshot;
  recipients: { id: string; name: string; email: string }[];
  testRecipient: string | null;
  privateNotes?: Record<string, string>;
  backfillsAvailable?: boolean;
};
export function StampCards({
  data,
  notify,
}: {
  data: PortalData;
  notify: (message: string) => void;
}) {
  const router = useRouter();
  const [backfill, setBackfill] = useState<{
    period: (typeof data.periods)[number];
    discipline: "football" | "athletics";
  } | null>(null);
  const [search, setSearch] = useState("");
  const [playerId, setPlayerId] = useState(data.players[0]?.id ?? "");
  const [periodId, setPeriodId] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [recipient, setRecipient] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const request = useRef<{ key: string; id: string } | null>(null);
  const players = data.players.filter((p) =>
    `${p.first_name} ${p.last_name} ${p.team}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const player = players.find((p) => p.id === playerId) ?? players[0];
  const periods = data.periods
    .filter((p) => p.player_id === player?.id)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const now = new Date().toISOString();
  const period =
    periods.find((p) => p.id === periodId) ??
    periods.find((p) => p.starts_at <= now && p.ends_at > now) ??
    periods[0];
  const activeId = period?.id;
  useEffect(() => {
    let cancelled = false;
    setCard(null);
    setRecipient("");
    setEmail("");
    setError("");
    request.current = null;
    if (!activeId || !player || !period) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/api/team/stamp-card?period_id=${encodeURIComponent(activeId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        return result as Card;
      })
      .then((result) => {
        if (!cancelled) {
          setCard(result);
          setRecipient(result.recipients[0]?.id ?? "");
          setEmail(result.recipients[0]?.email ?? "");
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error
              ? e.message
              : "Stempelkarte konnte nicht geladen werden.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Selection is identified by the period. Refresh explicitly reloads its live data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, data, refresh]);
  async function download() {
    if (!activeId || !card) return;
    setBusy(true);
    try {
      let blob: Blob;

      const response = await fetch(
        `/api/team/stamp-card?period_id=${encodeURIComponent(activeId)}&download=pdf`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error((await response.json()).error);
      blob = await response.blob();

      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `ProAcademy-Stempelkarte-${formatDate(card.snapshot.starts_at)}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Export fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!email.trim() || !activeId) return;
    const target = card?.testRecipient ?? email.trim();
    if (
      !window.confirm(
        `Stempelkarte für ${card!.snapshot.player_name} per E-Mail an ${target} senden?`,
      )
    )
      return;
    setBusy(true);
    const key = `${activeId}:${email.trim()}`;
    if (request.current?.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    try {
      const response = await fetch("/api/team/stamp-card-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period_id: activeId,
          email: email.trim(),
          request_id: request.current.id,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      notify(result.message);
      request.current = null;
    } catch (e) {
      notify(e instanceof Error ? e.message : "Versand fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  const stats = card ? attendanceStats(card.snapshot.events) : null;
  return (
    <>
      {backfill && (
        <BackfillForm
          period={backfill.period}
          discipline={backfill.discipline}
          data={data}
          close={() => setBackfill(null)}
          saved={() => {
            setBackfill(null);
            setRefresh((n) => n + 1);
            router.refresh();
            notify(
              "Eine Einheit wurde nachgetragen. Die Stempelkarte wird aktualisiert.",
            );
          }}
        />
      )}
      <div className="page-heading">
        <div>
          <div className="eyebrow">TRAININGSFORTSCHRITT</div>
          <h1>
            Stempelkarten<span className="greeting-dot">.</span>
          </h1>
          <p>
            Einheiten aller Kinder prüfen, als PDF exportieren oder an eine
            E-Mail-Adresse senden.
          </p>
        </div>
      </div>
      <section className="panel stamp-card-filters">
        <label>
          Kind suchen
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPeriodId("");
            }}
            placeholder="Name oder Mannschaft"
          />
        </label>
        <div className="form-grid">
          <label>
            Kind auswählen
            <select
              value={player?.id ?? ""}
              disabled={!players.length || busy}
              onChange={(e) => {
                setPlayerId(e.target.value);
                setPeriodId("");
              }}
            >
              {!players.length && (
                <option value="">Keine Kinder gefunden</option>
              )}
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.first_name} {p.last_name}
                  {p.team ? ` · ${p.team}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Leistungszeitraum auswählen
            <select
              value={activeId ?? ""}
              disabled={!periods.length || busy}
              onChange={(e) => setPeriodId(e.target.value)}
            >
              {!periods.length && (
                <option value="">Kein Leistungszeitraum vorhanden</option>
              )}
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodLabel(p.starts_at, p.ends_at)} · {p.product_name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      {loading && <p role="status">Stempelkarte wird geladen …</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !period && (
        <section className="panel">
          <p>
            {player
              ? "Für dieses Kind ist noch kein Leistungszeitraum zugeordnet."
              : "Keine passenden Kinder gefunden."}
          </p>
        </section>
      )}
      {card && stats && period && (
        <>
          <section className="panel large-stamp staff-stamp-card">
            <div className="panel-heading">
              <div>
                <h2>{card.snapshot.player_name}</h2>
                <p>
                  {card.snapshot.product_name} ·{" "}
                  {periodLabel(card.snapshot.starts_at, card.snapshot.ends_at)}
                </p>
              </div>
              <button
                className="text-button"
                onClick={() => setRefresh((n) => n + 1)}
                disabled={busy}
              >
                <RefreshCw size={16} /> Aktualisieren
              </button>
            </div>
            <Stamps
              period={period}
              completed={stats.completed}
              charged={stats.charged}
              retrospective={stats.retrospective}
              onOpenStamp={
                !busy &&
                card.backfillsAvailable !== false &&
                period.status !== "void" &&
                period.starts_at <= now
                  ? (discipline) => setBackfill({ period, discipline })
                  : undefined
              }
              planned={stats.planned}
              splitStats={disciplineStats(card.snapshot.events)}
            />
            <StampLegend />
            {card.backfillsAvailable === false && (
              <p role="status" className="muted">
                Nachträge sind für diese Datenbank noch nicht freigeschaltet.
                Bestehende Stempelkarten und PDF-Exporte bleiben verfügbar.
              </p>
            )}
            <ExcusedNotes events={card.snapshot.events} />
            <BackfillNotes events={card.snapshot.events} />
            <p>
              {stats.completed} von {card.snapshot.included_units} Einheiten
              angerechnet · {durationLabel(stats.minutes)}
            </p>
            {stats.completed > card.snapshot.included_units && (
              <p>
                Zusätzlich angerechnet:{" "}
                {stats.completed - card.snapshot.included_units} Einheiten
              </p>
            )}
            <p className="muted">
              Datenstand: {formatDate(card.snapshot.created_at)},{" "}
              {formatTime(card.snapshot.created_at)} Uhr · Bestehende
              Berichtsversionen bleiben erhalten; Nachträge abgeschlossener
              Zeiträume erzeugen eine neue Version.
            </p>
            <button
              className="secondary-button"
              onClick={download}
              disabled={busy}
            >
              <Download size={18} /> PDF exportieren
            </button>
          </section>
          <section className="panel stamp-card-mail">
            <h2>Stempelkarte per E-Mail</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label>
                Empfänger auswählen
                <select
                  value={recipient}
                  disabled={busy}
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    setEmail(
                      card.recipients.find((p) => p.id === e.target.value)
                        ?.email ?? "",
                    );
                  }}
                >
                  <option value="">Andere E-Mail-Adresse</option>
                  {card.recipients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.email}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                E-Mail-Adresse
                <input
                  type="email"
                  required
                  value={email}
                  disabled={busy}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setRecipient("");
                  }}
                />
              </label>
              {card.testRecipient !== null && (
                <p>
                  Testbetrieb: Der Versand ist auf{" "}
                  {card.testRecipient ||
                    "einen noch einzurichtenden Testempfänger"}{" "}
                  begrenzt.
                </p>
              )}
              <p>
                Die Stempelkarte wird direkt als PDF-Anhang versendet. Eine
                Anmeldung im Elternportal ist dafür nicht erforderlich.
              </p>
              <button
                className="primary-button"
                type="submit"
                disabled={busy || !email.trim()}
              >
                <Mail size={18} />{" "}
                {busy ? "Wird versendet …" : "Per E-Mail senden"}
              </button>
            </form>
          </section>
          <section className="panel schedule-panel">
            <div className="panel-heading">
              <h2>Trainingsübersicht</h2>
            </div>
            <div className="table-wrap">
              <table className="stamp-card-table">
                <thead>
                  <tr>
                    <th>Training</th>
                    <th>Datum</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {card.snapshot.events.map((event) => (
                    <tr key={event.id}>
                      <td>
                        {event.title}
                        <br />
                        <small>{event.event_type}</small>
                        {event.retrospective &&
                          card.privateNotes?.[event.id] && (
                            <details className="internal-backfill-note">
                              <summary>Interne Notiz</summary>
                              <p className="preserve-lines">
                                {card.privateNotes[event.id]}
                              </p>
                            </details>
                          )}
                      </td>
                      <td>
                        {event.retrospective ? (
                          <>
                            {event.occurred_on
                              ? formatDate(`${event.occurred_on}T12:00:00Z`)
                              : "Datum nicht angegeben"}
                            <br />
                            {event.duration_minutes} Minuten
                          </>
                        ) : (
                          <>
                            {formatDate(event.starts_at)}
                            <br />
                            {formatTime(event.starts_at)}–
                            {formatTime(event.ends_at)}
                          </>
                        )}
                      </td>
                      <td>
                        {event.event_cancelled
                          ? "Teamabsage · ohne Anrechnung"
                          : event.retrospective
                            ? "Nachgetragen"
                            : event.status === "planned" &&
                                event.ends_at <= card.snapshot.created_at
                              ? "Prüfung ausstehend"
                              : STATUS_LABELS[event.status]}
                      </td>
                    </tr>
                  ))}
                  {!card.snapshot.events.length && (
                    <tr>
                      <td colSpan={3}>
                        Noch keine Trainings in diesem Leistungszeitraum.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
