"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

let flushCurrent: (() => Promise<void>) | undefined;
/** Logout must save before invalidating the session. */
export async function flushEmailPreference() {
  await flushCurrent?.();
}

export function EmailPreference({
  email,
  notify,
}: {
  email: string;
  notify: (message: string) => void;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const state = useRef({ loaded: false, saved: true, draft: true });
  const pending = useRef<Promise<void> | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const key = `pa-email-preference:${email}`;

  useEffect(() => {
    let mounted = true;
    const remember = () => {
      try {
        if (state.current.draft === state.current.saved)
          sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, JSON.stringify(state.current.draft));
      } catch {
        /* Browser storage may be unavailable. */
      }
    };
    async function flush(): Promise<void> {
      if (pending.current) {
        await pending.current;
        return flush();
      }
      const s = state.current;
      if (!s.loaded || s.draft === s.saved) return;
      const value = s.draft;
      const request = (async () => {
        const response = await fetch("/api/account/email-preference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: value }),
          keepalive: true,
        });
        if (!response.ok)
          throw new Error(
            "E-Mail-Einstellung nicht gespeichert. Bitte auf Mein Konto erneut versuchen.",
          );
        s.saved = value;
        remember();
        if (mounted) {
          setDirty(s.draft !== s.saved);
          setError("");
        }
      })();
      pending.current = request;
      try {
        await request;
      } finally {
        pending.current = null;
      }
      if (s.draft !== s.saved) await flush();
    }
    const report = (e: unknown) => {
      const message =
        e instanceof Error
          ? e.message
          : "E-Mail-Einstellung nicht gespeichert.";
      if (mounted) setError(message);
      notifyRef.current(message);
    };
    flushCurrent = flush;
    fetch("/api/account/email-preference", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok)
          throw new Error("E-Mail-Einstellung konnte nicht geladen werden.");
        const body = await r.json();
        if (typeof body.enabled !== "boolean")
          throw new Error("Ungültige E-Mail-Einstellung.");
        if (!mounted) return;
        let draft = body.enabled;
        try {
          const cached = sessionStorage.getItem(key);
          if (cached === "true" || cached === "false")
            draft = cached === "true";
        } catch {
          /* No local recovery available. */
        }
        state.current = { loaded: true, saved: body.enabled, draft };
        setEnabled(draft);
        setDirty(draft !== body.enabled);
        setReady(true);
      })
      .catch(report);
    const leave = () => {
      void flush().catch(report);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") leave();
    };
    const click = (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      if (!state.current.loaded || state.current.saved === state.current.draft)
        return;
      const target = new URL(anchor.href);
      if (
        !["http:", "https:"].includes(target.protocol) ||
        target.href === location.href
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      void flush()
        .then(() => {
          if (target.origin === location.origin)
            router.push(target.pathname + target.search + target.hash);
          else window.location.assign(target.href);
        })
        .catch(report);
    };
    document.addEventListener("click", click, true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    return () => {
      mounted = false;
      document.removeEventListener("click", click, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      if (flushCurrent === flush) flushCurrent = undefined;
      leave();
    };
  }, [key, router]);

  return (
    <section className="panel account-panel">
      <h2>E-Mails von ProAcademy</h2>
      <p id="email-preference-description">
        Ich stimme dem Empfang von E-Mails von ProAcademy zu. Diese können
        Trainingsplanung, Ankündigungen, Monatsberichte und individuelle
        Nachrichten enthalten.
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-describedby="email-preference-description"
        disabled={!ready}
        className={enabled ? "primary-button" : "secondary-button"}
        onClick={() => {
          const value = !state.current.draft;
          state.current.draft = value;
          setEnabled(value);
          setDirty(value !== state.current.saved);
          try {
            if (value === state.current.saved) sessionStorage.removeItem(key);
            else sessionStorage.setItem(key, JSON.stringify(value));
          } catch {
            /* Save on navigation remains available. */
          }
        }}
      >
        E-Mail-Empfang:{" "}
        {ready ? (enabled ? "Aktiv" : "Inaktiv") : "Wird geladen …"}
      </button>
      <p className="muted" aria-live="polite">
        {dirty
          ? "Änderung vorgemerkt. Deine letzte Auswahl wird beim Verlassen der Seite gespeichert."
          : "Änderungen werden beim Verlassen der Seite gespeichert."}
      </p>
      <p className="muted">
        Bei inaktivem Empfang erhältst du keine Portal-E-Mails, auch keine
        manuell versendeten Nachrichten. Anmelde- und Einladungsmails sowie
        Stripe-Rechnungen bleiben davon unabhängig. Beim erneuten Aktivieren
        werden alte Nachrichten nicht nachgesendet.
      </p>
      {error && (
        <p role="alert">
          {error}{" "}
          {ready && (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                void flushEmailPreference().catch((e: Error) =>
                  setError(e.message),
                )
              }
            >
              Erneut speichern
            </button>
          )}
        </p>
      )}
    </section>
  );
}
