"use client";
import { useEffect, useState } from "react";
export function ShowcaseSettings() {
  const [share, setShare] = useState<{
    token: string | null;
    code: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load() {
    const r = await fetch("/api/admin/product-showcase", { cache: "no-store" });
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    return data;
  }
  useEffect(() => {
    let live = true;
    void load()
      .then((data) => {
        if (live) setShare(data);
      })
      .catch((e) => {
        if (live) setMessage(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="showcase-settings">
      <h3>Produktbühne einbetten</h3>
      <p>
        Die Produktbühne als bildschirmfüllende Section auf deiner Website.
        Inhalte werden alle 30 Sekunden aktualisiert; Produktklicks öffnen den
        Portalshop.
      </p>
      <p>
        Eine aktive Einbettung. „Neue Einbettung“ ersetzt den Token und macht
        den bisherigen Code auf allen Websites ungültig.
      </p>
      <div className="showcase-settings-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !share?.code}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(share!.code!);
              setMessage("Einbettung kopiert.");
            } catch {
              setMessage(
                "Kopieren nicht möglich. Bitte den Code über „Code anzeigen“ kopieren.",
              );
            }
          }}
        >
          Einbettung kopieren
        </button>
        {share?.code ? (
          <a
            className="secondary-button"
            href="/api/admin/product-showcase/code"
            target="_blank"
            rel="noopener noreferrer"
          >
            Code anzeigen ↗
          </a>
        ) : (
          <button type="button" className="secondary-button" disabled>
            Code anzeigen ↗
          </button>
        )}
        <button
          type="button"
          className="primary-button"
          disabled={busy || !share}
          onClick={async () => {
            setBusy(true);
            setMessage("");
            try {
              const r = await fetch("/api/admin/product-showcase", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ expected: share!.token }),
              });
              const data = await r.json();
              if (!r.ok) throw Error(data.error);
              setShare(data);
              setMessage(
                "Neue Einbettung erstellt. Bitte den neuen Code auf deiner Website einsetzen.",
              );
            } catch (e) {
              setMessage((e as Error).message);
              try {
                setShare(await load());
              } catch {}
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Wird erstellt …" : "Neue Einbettung"}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
