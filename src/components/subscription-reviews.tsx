"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./portal";
import { formatDate } from "@/lib/domain";
import type {
  SubscriptionReview,
  SubscriptionReviewPage,
} from "@/lib/subscription-reviews";

export function SubscriptionReviews() {
  const router = useRouter();
  const [data, setData] = useState<SubscriptionReviewPage | null>(null),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/admin/subscription-reviews?offset=${offset}`, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error ?? "Prüfungen nicht verfügbar.");
        return d;
      })
      .then(setData)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [offset, revision]);
  const refresh = () => setRevision((n) => n + 1);
  return (
    <section className="panel subscription-review-preview">
      <div>
        <h2>Abo-Zuordnungen prüfen</h2>
        <p>
          {loading
            ? "Prüfungen werden geladen …"
            : error
              ? "Prüfung derzeit nicht verfügbar"
              : data?.total
                ? `${data.total} Paketwechsel benötigen eine eindeutige Kinderzuordnung.`
                : "Keine offenen Zuordnungen."}
        </p>
        {!!data?.total && (
          <p className="profile-muted">
            {[
              ...new Set(
                data.rows.flatMap((r) => r.suggestions.map((s) => s.name)),
              ),
            ]
              .slice(0, 4)
              .join(" · ") || "Neue Abo-Positionen ohne eindeutige Zuordnung"}
          </p>
        )}
      </div>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button className="secondary-button" onClick={refresh}>
            Erneut prüfen
          </button>
        </div>
      ) : (
        !!data?.total && (
          <button className="primary-button" onClick={() => setOpen(true)}>
            Kinder und Vorschläge prüfen →
          </button>
        )
      )}
      {open && (
        <Modal title="Paketwechsel prüfen" close={() => setOpen(false)}>
          <div className="subscription-review-body">
            <p>
              Das bisher zugeordnete Kind ist nur ein Vorschlag. Bestätige für
              jede neue Abo-Position die passende Zuordnung.
            </p>
            {error && <p role="alert">{error}</p>}
            {loading ? (
              <p role="status">Wird geladen …</p>
            ) : (
              data?.rows.map((r) => (
                <ReviewCard
                  key={`${r.id}:${r.signature}`}
                  review={r}
                  saved={() => {
                    if (data.rows.length === 1 && offset > 0)
                      setOffset(Math.max(0, offset - 25));
                    refresh();
                    router.refresh();
                  }}
                />
              ))
            )}
            {!loading && !data?.total && <p>Alle Zuordnungen sind geprüft.</p>}
            {!!data && data.total > 25 && (
              <div className="form-actions">
                <button
                  className="secondary-button"
                  disabled={loading || offset === 0}
                  onClick={() => setOffset((n) => Math.max(0, n - 25))}
                >
                  Zurück
                </button>
                <span>
                  {offset + 1}–{Math.min(offset + 25, data.total)} von{" "}
                  {data.total}
                </span>
                <button
                  className="secondary-button"
                  disabled={loading || offset + 25 >= data.total}
                  onClick={() => setOffset((n) => n + 25)}
                >
                  Weiter
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
function ReviewCard({
  review: r,
  saved,
}: {
  review: SubscriptionReview;
  saved: () => void;
}) {
  const first = r.suggestions.length === 1 ? r.suggestions[0] : null;
  const [previous, setPrevious] = useState(first?.previousItemId ?? ""),
    [player, setPlayer] = useState(
      r.candidates.some((c) => c.id === first?.playerId) ? first!.playerId : "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sameChild =
    r.suggestions.find((s) => s.previousItemId === previous)?.playerId ===
    player;
  return (
    <form
      className="subscription-review-card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/api/admin/subscription-reviews", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              review_id: r.id,
              signature: r.signature,
              player_id: player,
              previous_item_id: previous || null,
            }),
          });
          const data = await response.json();
          if (!response.ok)
            throw Error(data.error ?? "Zuordnung fehlgeschlagen.");
          saved();
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Zuordnung fehlgeschlagen.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>
        {r.product} · {r.units ?? "–"} Einheiten
      </h3>
      <p className="profile-muted">
        {formatDate(r.startsAt)} – {formatDate(r.endsAt)}
      </p>
      {!!r.suggestions.length && (
        <label>
          Bisherige Zuordnung ersetzen
          <select
            required
            value={previous}
            disabled={busy}
            onChange={(e) => {
              setPrevious(e.target.value);
              const suggested = r.suggestions.find(
                (s) => s.previousItemId === e.target.value,
              )?.playerId;
              setPlayer(
                r.candidates.some((c) => c.id === suggested) ? suggested! : "",
              );
            }}
          >
            <option value="">Zuordnung auswählen</option>
            {r.suggestions.map((s) => (
              <option key={s.previousItemId} value={s.previousItemId}>
                {s.name} · bisher zugeordnet
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Kind für das neue Paket
        <select
          required
          value={player}
          disabled={busy}
          onChange={(e) => setPlayer(e.target.value)}
        >
          <option value="">Kind auswählen</option>
          {r.candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {r.suggestions.some((s) => s.playerId === c.id)
                ? " · Vorschlag"
                : ""}
            </option>
          ))}
        </select>
      </label>
      <p>
        {sameChild
          ? "Das Kontingent wird sofort angepasst. Einheiten des laufenden Zeitraums bleiben auf der Stempelkarte; überschüssige Einheiten werden markiert."
          : "Teilnahmen werden niemals auf ein anderes Kind übertragen. Bei einer regulären Verlängerung beginnt ein neuer Zeitraum."}
      </p>
      {r.quantity !== 1 && (
        <p role="alert">
          Diese Abo-Position enthält mehrere Plätze und muss zuerst getrennt
          werden.
        </p>
      )}
      {r.units === null && (
        <p role="alert">Bitte zuerst den unbekannten Tarif zuordnen.</p>
      )}
      {error && (
        <p role="alert" className="profile-error">
          {error}
        </p>
      )}
      <button
        className="primary-button"
        disabled={
          busy ||
          !player ||
          r.units === null ||
          r.quantity !== 1 ||
          (!previous && r.suggestions.length > 0)
        }
      >
        {busy ? "Wird gespeichert …" : "Zuordnung bestätigen"}
      </button>
    </form>
  );
}
