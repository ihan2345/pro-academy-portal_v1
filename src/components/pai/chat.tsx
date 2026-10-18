"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Modal } from "../portal";
import { disabledMessage, type PaiStatus } from "@/lib/pai/domain";
export async function paiApi(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`/api/pai/${path}`, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "pAi nicht verfügbar.");
  return data;
}
export function PaiPreference() {
  const [value, setValue] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    paiApi("preference")
      .then((d) => setValue(d.enabled))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel account-panel">
      <h2>Dein Assistent pAi</h2>
      <p>Hilfe zu Trainings, Stempelkarten, Abos und deinem Abzeichen.</p>
      <button
        type="button"
        role="switch"
        aria-checked={value === true}
        disabled={value === null || busy}
        className={value ? "primary-button" : "secondary-button"}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const d = await paiApi("preference", "POST", { enabled: !value });
            setValue(d.enabled);
            window.dispatchEvent(new Event("pai-preference"));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        pAi aktivieren:{" "}
        {value === null ? "Wird geladen …" : value ? "Aktiv" : "Inaktiv"}
      </button>
      <p className="muted">
        Wird sofort gespeichert. Unabhängig vom E-Mail-Empfang. Deaktivieren
        löscht deinen Verlauf nicht.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function PaiUsage({ status }: { status: PaiStatus }) {
  return (
    <div className="pai-usage">
      <strong>
        {status.used} von {status.limit} Fragen verwendet · {status.remaining}{" "}
        verbleibend
      </strong>
      {status.reserved > 0 && <p>{status.reserved} Anfrage(n) laufen.</p>}
      <p>{status.explanation}</p>
      {status.override && (
        <p>
          Individuelle Ausnahme: {status.limit} Fragen pro{" "}
          {status.kind === "day" ? "Tag" : "Monat"}; Standard: {status.standard}
          .
        </p>
      )}
      <small>
        Reset:{" "}
        {new Date(status.reset).toLocaleString("de-DE", {
          timeZone: "Europe/Berlin",
        })}{" "}
        (Europe/Berlin)
      </small>
    </div>
  );
}
function AnswerText({ text }: { text: string }) {
  return (
    <div className="pai-answer-text">
      {text.split(/\n\s*\n/).map((paragraph, i) => (
        <p key={i}>
          {paragraph
            .split(/(\*\*[^*]+\*\*)/g)
            .map((part, j) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <strong key={j}>{part.slice(2, -2)}</strong>
              ) : (
                part
              ),
            )}
        </p>
      ))}
    </div>
  );
}
export function PaiChat({ role }: { role: string }) {
  const [status, setStatus] = useState<PaiStatus | null>(null),
    [messages, setMessages] = useState<
      { id: string; prompt: string; answer: string }[]
    >([]),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const questionId = useId();
  const transcript = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState("");
  const retry = useRef<{ id: string; message: string } | null>(null);
  async function refresh() {
    setStatus(await paiApi("status"));
  }
  useEffect(() => {
    let live = true;
    Promise.all([paiApi("status"), paiApi("history")])
      .then(([s, h]) => {
        if (live) {
          setStatus(s);
          setMessages(h.messages);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const sync = () => {
      paiApi("history")
        .then((h) => setMessages(h.messages))
        .catch((e) => setError(e.message));
      refresh().catch((e) => setError(e.message));
    };
    window.addEventListener("pai-history", sync);
    window.addEventListener("pai-preference", sync);
    return () => {
      window.removeEventListener("pai-history", sync);
      window.removeEventListener("pai-preference", sync);
    };
  }, []);
  useEffect(() => {
    if (transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages, busy]);
  async function send(value = text) {
    if (!value.trim() || busy) return;
    setBusy(true);
    setPending(value);
    setError("");
    const input =
      retry.current?.message === value
        ? retry.current
        : { id: crypto.randomUUID(), message: value };
    retry.current = input;
    try {
      const r = await paiApi("chat", "POST", input);
      setMessages((m) =>
        m.some((x) => x.id === input.id)
          ? m
          : [...m, { id: input.id, prompt: value, answer: r.answer }],
      );
      setText("");
      retry.current = null;
      window.dispatchEvent(new Event("pai-history"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      refresh().catch((e) => setError(e.message));
    }
  }
  const suggestions =
    role === "parent"
      ? [
          "Wie viele Trainingseinheiten habe ich noch?",
          "Warum habe ich dieses Abzeichen?",
          "Wie oft haben meine Kinder diesen Monat trainiert?",
        ]
      : role === "admin"
        ? [
            "Wie viele Spieler haben ein aktives Abo?",
            "Welcher Standort hatte diesen Monat die meisten Trainingsstunden?",
            "Welche Rechnungen sind noch offen?",
          ]
        : [
            "Welche Spieler haben diesen Monat häufig gefehlt?",
            "Wie viele Trainingsstunden hatte jeder Trainer diesen Monat?",
            "Wie viele Spieler haben ein aktives Abo?",
          ];
  return (
    <section className="pai-chat">
      <div className="pai-welcome">
        <span className="pai-avatar" aria-hidden="true">
          pAi
        </span>
        <div>
          <strong>Deine Academy. Ein Gespräch.</strong>
          <p>
            {role === "parent"
              ? "Trainings, Einheiten und Abzeichen für deine Familie."
              : "Überblick und Antworten aus deiner Academy."}
          </p>
        </div>
      </div>
      {status?.enabled === false ? (
        <div className="pai-disabled">
          <p>{disabledMessage}</p>
          <Link className="primary-button" href="/pai">
            Zu den Einstellungen
          </Link>
        </div>
      ) : (
        <>
          {status && (
            <details className="pai-quota">
              <summary>
                {status.remaining} von {status.limit} Fragen verfügbar{" "}
                <span>Kontingent ansehen</span>
              </summary>
              <PaiUsage status={status} />
            </details>
          )}
          <div
            className="pai-messages"
            ref={transcript}
            role="log"
            aria-label="Chatverlauf"
            aria-live="polite"
          >
            {!messages.length && !busy && (
              <div className="pai-empty">
                <h3>Wie kann ich dir helfen?</h3>
                <p>
                  {role === "parent"
                    ? "Frag einfach los. Deine zugeordneten Kinder berücksichtige ich automatisch."
                    : "Frag nach der Academy oder einem bestimmten Spieler."}
                </p>
              </div>
            )}
            {messages.map((m) => (
              <article className="pai-turn" key={m.id}>
                <div className="pai-question">
                  <span className="pai-message-author">Du</span>
                  <p>{m.prompt}</p>
                </div>
                <div className="pai-answer">
                  <span className="pai-message-author">
                    pAi <span>Academy-Assistent</span>
                  </span>
                  <AnswerText text={m.answer} />
                </div>
              </article>
            ))}
            {busy && (
              <article className="pai-turn">
                <div className="pai-question">
                  <span className="pai-message-author">Du</span>
                  <p>{pending}</p>
                </div>
                <div className="pai-answer" role="status">
                  pAi prüft deine Portaldaten …
                </div>
              </article>
            )}
          </div>
          <div className="pai-suggestions" hidden={messages.length > 0}>
            {suggestions.map((q) => (
              <button
                className="secondary-button"
                key={q}
                disabled={busy || !status?.available}
                onClick={() => setText(q)}
              >
                {q}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor={questionId}>Deine Frage</label>
            <textarea
              id={questionId}
              rows={2}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (status?.available && status.remaining > 0) void send();
                }
              }}
              maxLength={4000}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                retry.current = null;
              }}
              disabled={busy}
              placeholder="Frag mich zu deinem Portal …"
            />
            <button
              className="primary-button"
              disabled={
                busy ||
                !status?.available ||
                status.remaining === 0 ||
                !text.trim()
              }
            >
              {busy ? "pAi schaut nach …" : "Frage senden"}
            </button>
          </form>
          {status && !status.available && (
            <p>
              pAi wartet auf die Freischaltung der Testumgebung oder wurde von
              der Verwaltung pausiert.
            </p>
          )}
          <small className="pai-footnote">
            Folgefragen zählen als neue Frage. Daten werden mit deinen aktuellen
            Rechten erneut abgefragt. Verlauf: {status?.retentionDays ?? "…"}{" "}
            Tage.
          </small>
        </>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            className="secondary-button"
            onClick={() => {
              retry.current = null;
              refresh()
                .then(() => setError(""))
                .catch((e) => setError(e.message));
            }}
          >
            Neu laden
          </button>
        </p>
      )}
      {messages.length > 0 && (
        <button
          className="text-button"
          disabled={busy}
          onClick={async () => {
            try {
              await paiApi("history", "DELETE");
              setMessages([]);
              window.dispatchEvent(new Event("pai-history"));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Meinen Chatverlauf löschen
        </button>
      )}
    </section>
  );
}
export function PaiLauncher({ role }: { role: string }) {
  const [open, setOpen] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision((n) => n + 1);
    window.addEventListener("pai-preference", update);
    return () => window.removeEventListener("pai-preference", update);
  }, []);
  return (
    <>
      <button
        className="pai-launcher"
        onClick={() => setOpen(true)}
        aria-label="pAi-Assistent öffnen"
      >
        <svg viewBox="0 0 64 72" aria-hidden="true">
          <circle cx="32" cy="12" r="9" fill="#ffd4ae" />
          <path
            d="M20 24L9 40M44 24l11 16M25 48l-7 19M39 48l7 19"
            stroke="#8eff01"
            strokeWidth="9"
            strokeLinecap="round"
          />
          <path d="M20 22h24l-3 29H23z" fill="#8b53fe" />
          <text
            x="32"
            y="42"
            textAnchor="middle"
            fill="white"
            fontSize="13"
            fontWeight="bold"
          >
            PA
          </text>
          <circle cx="53" cy="61" r="9" fill="white" />
          <path d="m53 55 5 4-2 6h-6l-2-6z" fill="#0b0f1a" />
        </svg>
        <span>pAi</span>
      </button>
      {open && (
        <Modal
          title="pAi · Dein Academy-Assistent"
          close={() => setOpen(false)}
        >
          <PaiChat key={revision} role={role} />
        </Modal>
      )}
    </>
  );
}
