"use client";
import { useEffect, useState } from "react";
import { Copy, RefreshCw, Ban } from "lucide-react";
type Share = { enabled: boolean; url: string | null };
export function PlayerApiShare({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [share, setShare] = useState<Share | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/player-api-link", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        return body;
      })
      .then(setShare)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function change(action: "create" | "rotate" | "disable") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/player-api-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setShare(body);
      notify(
        action === "disable"
          ? "Spieler-API deaktiviert. Weitere Abrufe sind gesperrt."
          : action === "rotate"
            ? "Neuer Link erstellt. Der bisherige Link ist ungültig."
            : "Spieler-API aktiviert.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Änderung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(share!.url!);
      notify("Spieler-API-Link kopiert.");
    } catch {
      notify("Bitte den Link im Feld markieren und kopieren.");
    }
  }
  return (
    <section className="panel account-panel settings-panel">
      <h2>Spieler-API</h2>
      <p>
        Alle Kinder, einschließlich archivierter Kinder und unabhängig vom
        Abo-Status. Jeder Abruf liefert den aktuellen Datenstand als JSON.
      </p>
      <p className="muted">
        Enthalten: Spielername, Elternteile, Geburtsjahr, Geschlecht, Verein,
        Position, starker Fuß, Größe, Entwicklungsziele, aktuelle Abos mit
        Zeitraum, aktive Monate insgesamt und Profil-Link.
      </p>
      <p className="muted">
        Aktive Monate: volle Abo-Monate plus ein Restmonat ab zehn aktiven
        Tagen. Pausen zählen nicht, Überschneidungen nicht doppelt. Profil-Links
        öffnen die Spielerkarte nach Admin-Anmeldung.
      </p>
      <p>
        <strong>
          Status:{" "}
          {share
            ? share.enabled
              ? "Aktiv"
              : "Deaktiviert"
            : error
              ? "Nicht verfügbar"
              : "Wird geladen …"}
        </strong>
      </p>
      {error && <p role="alert">{error}</p>}
      {share?.enabled && share.url && (
        <>
          <label>
            Export-Link
            <input
              readOnly
              value={share.url}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <p className="muted">
            Wer diesen Link besitzt, kann die enthaltenen Spielerdaten abrufen.
            Nur an vorgesehene Empfänger weitergeben.
          </p>
          <div className="player-api-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void copy()}
            >
              <Copy size={16} /> Link kopieren
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void change("rotate")}
            >
              <RefreshCw size={16} /> Link erneuern
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void change("disable")}
            >
              <Ban size={16} /> Deaktivieren
            </button>
          </div>
          <small>
            Erneuern macht den bisherigen Link ungültig. Deaktivieren sperrt
            weitere Abrufe; bereits heruntergeladene Daten bleiben beim
            Empfänger.
          </small>
        </>
      )}
      {share && !share.enabled && (
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() => void change("create")}
        >
          {busy ? "Wird erstellt …" : "Export-Link erstellen"}
        </button>
      )}
    </section>
  );
}
