"use client";
import { useState } from "react";
import { ChevronDown, Copy, RefreshCw } from "lucide-react";

export function TrainingApiShare({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  async function copy(rotate: boolean) {
    if (busy) return;
    setBusy(true);
    setFallback(null);
    try {
      const response = await fetch("/api/admin/training-api-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotate }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Freigabelink nicht verfügbar.");
      try {
        await navigator.clipboard.writeText(result.url);
        notify(
          rotate
            ? "Neuer Freigabelink kopiert. Der bisherige Link ist jetzt ungültig."
            : "Trainings-API kopiert. Der Link liefert bei jedem Abruf die aktuellen Daten.",
        );
      } catch {
        setFallback(result.url);
        notify(
          rotate
            ? "Freigabelink erneuert; der bisherige Link ist ungültig. Bitte den neuen Link im Feld kopieren."
            : "Bitte den Freigabelink im Feld markieren und kopieren.",
        );
      }
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Freigabelink konnte nicht geladen werden.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="training-api-share">
      <div className="training-api-buttons">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void copy(false)}
        >
          <Copy size={16} />{" "}
          {busy ? "Link wird geladen …" : "Trainings-API kopieren"}
        </button>
        <details className="training-api-menu">
          <summary
            aria-label="Trainings-API Optionen"
            title="Trainings-API Optionen"
          >
            <ChevronDown size={16} />
          </summary>
          <div className="training-api-dropdown">
            <button
              type="button"
              className="text-button"
              disabled={busy}
              title="Erzeugt einen neuen Link und macht den bisherigen ungültig."
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                void copy(true);
              }}
            >
              <RefreshCw size={16} /> Freigabelink erneuern
            </button>
          </div>
        </details>
      </div>
      {fallback && (
        <label className="training-api-fallback">
          Freigabelink zum Kopieren
          <input
            readOnly
            value={fallback}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </div>
  );
}
