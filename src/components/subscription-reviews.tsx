"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { reviewExplanation } from "@/lib/subscription-reviews";
import { StripeParentInputs } from "./stripe-parent-inputs";
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
                ? `${data.total} Abo-Positionen benötigen eine eindeutige Kinderzuordnung.`
                : "Keine offenen Zuordnungen."}
        </p>
        {!!data?.total && (
          <p className="profile-muted">
            {[
              ...new Set(
                data.rows.flatMap((r) => [
                  r.context.customerName ?? r.context.customerId,
                  ...r.suggestions.map((s) => s.name),
                ]),
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
        <Modal title="Abo-Zuordnungen prüfen" close={() => setOpen(false)}>
          <div className="subscription-review-body">
            <p>
              Hier erscheinen neue Abos und unklare Paketwechsel. Prüfe zuerst
              den Kunden und die Familie, dann die passende Kinderzuordnung.
              Vorschläge werden niemals automatisch bestätigt.
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={loading}
              onClick={refresh}
            >
              Zuordnungen neu laden
            </button>
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
      r.candidates.some((c) => c.id === first?.playerId)
        ? first!.playerId
        : r.candidates.length === 1 && !r.suggestions.length
          ? r.candidates[0].id
          : "",
    ),
    [manualReason, setManualReason] = useState(""),
    [legacyConfirmed, setLegacyConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const manualTrial = !!r.manualTrialCandidates?.some((c) => c.id === player);
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
              confirm_legacy_tariff: legacyConfirmed,
              ...(manualTrial ? { manual_trial_reason: manualReason } : {}),
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
      <div className="profile-muted" style={{ overflowWrap: "anywhere" }}>
        <p>
          <strong>Kunde:</strong>{" "}
          {r.context.customerName ?? "Name nicht verfügbar"}
          {r.context.customerEmail
            ? ` · ${r.context.customerEmail}`
            : " · E-Mail nicht verfügbar"}
        </p>
        <p>
          <strong>Familie im Portal:</strong>{" "}
          {r.context.parents.map((p) => p.name).join(" · ") ||
            "Noch nicht verknüpft"}
        </p>
        <p>
          <strong>Abo-Status:</strong>{" "}
          {(
            {
              active: "Aktiv",
              trialing: "Testphase",
              past_due: "Zahlung überfällig",
              canceled: "Gekündigt",
              unpaid: "Unbezahlt",
              paused: "Pausiert",
              incomplete: "Unvollständig",
              incomplete_expired: "Abgelaufen",
            } as Record<string, string>
          )[r.context.status] ?? "Unbekannt"}{" "}
          · {r.quantity} {r.quantity === 1 ? "Platz" : "Plätze"}
        </p>
        <p>
          Zur Prüfung seit {formatDate(r.context.createdAt)} · Letzter Abgleich:{" "}
          {r.context.syncedAt
            ? formatDate(r.context.syncedAt)
            : "Nicht bekannt"}
        </p>
      </div>
      <StripeParentInputs
        customer={r.context.customerId}
        subscription={r.context.subscriptionId}
      />
      <p>
        <strong>Warum ist eine Prüfung nötig?</strong>
        <br />
        {reviewExplanation(r)}
      </p>
      {r.context.customerDetailsUnavailable && (
        <p>
          Kundendetails sind derzeit nicht vollständig verfügbar. Die
          Stripe-Referenzen stehen unten zur Kontrolle bereit.
        </p>
      )}
      {!r.candidates.length && (
        <div role="status">
          <p>
            <strong>Nächster Schritt:</strong>{" "}
            {r.context.parents.length
              ? "Prüfe unter Spieler & Eltern die Kinder der genannten Familie. Lege ein fehlendes Kind an oder prüfe dessen Archivierung. Lade danach diese Prüfung neu."
              : "Öffne die Stripe-Zuordnung für diesen Kunden. Prüfe die Kundendaten und verknüpfe ihn mit der passenden Familie und dem Kind. Lade danach diese Prüfung neu."}
          </p>
          <Link
            className="secondary-button"
            href={
              r.context.parents.length
                ? "/admin/spieler"
                : `/admin/stripe?customer=${encodeURIComponent(r.context.customerId)}`
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            {r.context.parents.length
              ? "Spieler & Eltern öffnen"
              : "Diesen Kunden zuordnen"}{" "}
            ↗
          </Link>
        </div>
      )}
      <details style={{ overflowWrap: "anywhere" }}>
        <summary>Referenzen zur Kontrolle</summary>
        <p>
          Stripe-Kunde: {r.context.customerId}
          <br />
          Abo: {r.context.subscriptionId}
          <br />
          Abo-Position: {r.context.itemId}
          <br />
          Tarif: {r.context.priceId}
        </p>
      </details>
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
          disabled={
            busy || (!r.candidates.length && !r.manualTrialCandidates?.length)
          }
          onChange={(e) => setPlayer(e.target.value)}
        >
          <option value="">
            {r.candidates.length
              ? "Kind auswählen"
              : "Keine zugeordneten aktiven Kinder verfügbar"}
          </option>
          {r.candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {r.suggestions.some((s) => s.playerId === c.id) ||
              (r.candidates.length === 1 && !r.suggestions.length)
                ? " · Vorschlag"
                : ""}
            </option>
          ))}
          {!!r.manualTrialCandidates?.length && (
            <optgroup label="Andere Probefamilie · nur nach persönlicher Prüfung">
              {r.manualTrialCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {manualTrial && (
        <label>
          Abweichenden Zahlungskontakt geprüft · Begründung
          <textarea
            required
            minLength={10}
            maxLength={500}
            value={manualReason}
            onChange={(e) => setManualReason(e.target.value)}
            placeholder="Zum Beispiel: Vater bezahlt, Familienzugehörigkeit telefonisch bestätigt."
          />
        </label>
      )}
      <p>
        {sameChild
          ? "Das Kontingent wird sofort angepasst. Einheiten des laufenden Zeitraums bleiben auf der Stempelkarte; überschüssige Einheiten werden markiert."
          : "Teilnahmen werden niemals auf ein anderes Kind übertragen. Bei einer regulären Verlängerung beginnt ein neuer Zeitraum."}
      </p>
      {r.requiresLegacyConfirmation && (
        <section
          style={{
            padding: 16,
            border: "1px solid #d49b35",
            borderRadius: 10,
            background: "#fff8e8",
          }}
        >
          <strong>Bestandstarif für einen neuen Abschluss</strong>
          <p>
            Dieses Abo wurde nach der Tarifumstellung über einen alten Link
            abgeschlossen. Der günstigere Bestandstarif ist für ausgewählte
            Kunden möglich und benötigt deine ausdrückliche Freigabe.
          </p>
          <label>
            <input
              type="checkbox"
              checked={legacyConfirmed}
              disabled={busy}
              onChange={(e) => setLegacyConfirmed(e.target.checked)}
            />
            Ich bestätige, dass dieses Abo den günstigeren Bestandstarif
            erhalten darf.
          </label>
          <p>
            Die Freigabe gilt für dieses Abo und diesen Tarif, auch bei späteren
            Verlängerungen. Sie ändert keine Preise in Stripe.
          </p>
        </section>
      )}
      {r.quantity !== 1 && (
        <p role="alert">
          Diese Abo-Position enthält mehrere Plätze und muss zuerst getrennt
          werden.
        </p>
      )}
      {r.units === null && (
        <p role="alert">
          Bitte zuerst unter Verwaltung → Produkte & Berichte → Produkte den
          Stripe-Tarif zuordnen. Die Tarif-ID steht unter „Referenzen zur
          Kontrolle“.
        </p>
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
          (r.requiresLegacyConfirmation && !legacyConfirmed) ||
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
