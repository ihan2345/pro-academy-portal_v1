"use client";
// Zweiter Elternteil: einladen (mit Vorschau), erneut senden, entfernen.
import { useState } from "react";
import { api } from "./elternkabine";

type Co = {
  current: null | {
    id: string;
    email: string;
    first_name: string;
    status: string;
    invite_sent_at: string | null;
    wait_hours: number;
    banned?: boolean;
    locked_until?: string | null;
  };
  changes_left: number;
};

export function CoParentPanel({ co, reload }: { co: Co; reload: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<{
    mode?: "link";
    to: string;
    subject: string;
    text: string;
  } | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const c = co.current;
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }
  const lockedDate = c?.locked_until
    ? new Date(c.locked_until).toLocaleDateString("de-DE")
    : null;
  const status = !c
    ? null
    : c.banned
      ? "Gesperrt"
      : c.status === "active"
        ? "Verbunden"
        : c.invite_sent_at
          ? "Einladung verschickt"
          : "Noch nicht eingeladen";
  return (
    <section className="ek-co">
      <h3>Zweiter Elternteil</h3>
      <p className="ek-hint">
        Der zweite Elternteil sieht dieselben Kinder, Termine, Abo und
        Elternkabine. Ändern, buchen oder kündigen kann nur dein Konto.
        Geschenkgutscheine kaufen geht.
      </p>
      {c ? (
        <div className="ek-co-card">
          <div>
            <b>{c.first_name || c.email}</b>
            <small>{c.email}</small>
          </div>
          <span
            className={`ek-tag ${c.banned ? "is-red" : c.status === "active" ? "is-solved" : ""}`}
          >
            {status}
          </span>
          {lockedDate ? (
            <p className="ek-hint ek-co-locked">
              Dieses Zweitkonto wurde von unserem Team gesperrt. Bis{" "}
              {lockedDate} kannst du es nicht ändern oder entfernen. Danach
              kannst du es entfernen und einen zweiten Elternteil mit einer
              neuen E-Mail-Adresse einladen.
            </p>
          ) : c.banned ? (
            <p className="ek-hint ek-co-locked">
              Dieses Zweitkonto ist gesperrt. Du kannst es jetzt entfernen und
              danach einen zweiten Elternteil mit einer neuen E-Mail-Adresse
              einladen.
            </p>
          ) : null}
          {!lockedDate && (
            <div className="ek-co-actions">
              {c.status !== "active" && (
                <button
                  type="button"
                  disabled={busy || c.wait_hours > 0}
                  title={
                    c.wait_hours
                      ? `Nächster Versand in ${c.wait_hours} Std.`
                      : ""
                  }
                  onClick={() =>
                    run(async () => {
                      await api("co/invite", {
                        email: c.email,
                        first_name: c.first_name || "Elternteil",
                      });
                      setMsg("Einladung erneut verschickt ✓");
                      reload();
                    })
                  }
                >
                  {c.wait_hours
                    ? `Erneut senden in ${c.wait_hours} Std.`
                    : "Einladung erneut senden"}
                </button>
              )}
              <button
                type="button"
                className="ek-danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const check = await api<{ gift_cards: number }>(
                      "co/remove-check",
                    );
                    const text = check.gift_cards
                      ? `Achtung: Mit diesem Zweitkonto sind ${check.gift_cards} Geschenkkarte(n) verbunden. Nach dem Entfernen sieht ${c.first_name || "der zweite Elternteil"} sie nicht mehr in eurer Familie. Trotzdem entfernen?`
                      : `${c.first_name || "Den zweiten Elternteil"} wirklich entfernen? Er oder sie bekommt dazu eine E-Mail.`;
                    if (!window.confirm(text)) return;
                    await api("co/remove", {
                      confirm_gifts: check.gift_cards > 0,
                    });
                    reload();
                  })
                }
              >
                Entfernen
              </button>
            </div>
          )}
        </div>
      ) : preview ? (
        <div className="ek-mail-preview">
          <small>
            {preview.mode === "link"
              ? `Eigenes Elternkonto gefunden: ${preview.to}`
              : `Vorschau der Einladung an ${preview.to}`}
          </small>
          <b>{preview.subject}</b>
          <p>{preview.text}</p>
          <div className="ek-co-actions">
            <button type="button" onClick={() => setPreview(null)}>
              Zurück
            </button>
            <button
              type="button"
              className="ek-primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (preview.mode === "link") {
                    await api("link/request", { email });
                    setMsg("Anfrage gesendet ✓");
                  } else await api("co/invite", { email, first_name: name });
                  setPreview(null);
                  setEmail("");
                  setName("");
                  reload();
                })
              }
            >
              {preview.mode === "link"
                ? "Verbindung anfragen"
                : "Einladung senden"}
            </button>
          </div>
        </div>
      ) : co.changes_left <= 0 ? (
        <p className="ek-hint">
          Das Zweitkonto kann höchstens zweimal pro Monat geändert werden. Ab
          dem nächsten Monat geht es wieder.
        </p>
      ) : (
        <div className="ek-co-form">
          <input
            placeholder="Vorname"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            placeholder="E-Mail-Adresse"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            type="button"
            className="ek-primary"
            disabled={busy || !email || !name}
            onClick={() =>
              run(async () =>
                setPreview(
                  await api("co/preview", { email, first_name: name }),
                ),
              )
            }
          >
            Einladung ansehen
          </button>
          <small className="ek-hint">
            Noch {co.changes_left} Änderung{co.changes_left === 1 ? "" : "en"}{" "}
            in diesem Monat möglich.
          </small>
        </div>
      )}
      {msg && <p className="ek-hint">{msg}</p>}
    </section>
  );
}

type Link = null | {
  status: "none" | "requested" | "active";
  incoming?: boolean;
  partner_name?: string;
  partner_email?: string | null;
  since?: string;
};
/** Zwei eigene Elternkonten in der Elternkabine verbinden (nur Kanäle, kein Portal-Zugriff). */
export function FamilyLinkPanel({
  link,
  main,
  reload,
}: {
  link: Link;
  main: boolean;
  reload: () => void;
}) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!link || link.status === "none") return null;
  async function run(path: string, body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMsg("");
    try {
      await api(path, body ?? {});
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }
  const name = link.partner_name ?? "Elternteil";
  return (
    <section className="ek-co ek-link-panel">
      <h3>Verbundene Familie</h3>
      {link.status === "active" ? (
        <p className="ek-hint">
          Verbunden mit <b>{name}</b>. Ihr seht in der Elternkabine die Kanäle
          aller Kinder. Jeder behält sein eigenes Konto und Abo und ändert nur
          seine eigenen Kinder.
        </p>
      ) : link.incoming ? (
        <p className="ek-hint">
          <b>{name}</b> möchte eure Familien in der Elternkabine verbinden. Ihr
          seht dann die Kanäle aller Kinder. Konten, Abos und Kinder bleiben
          getrennt, jeder ändert nur seine eigenen.
        </p>
      ) : (
        <p className="ek-hint">
          Anfrage an <b>{name}</b>
          {link.partner_email ? ` (${link.partner_email})` : ""} gesendet. Sie
          oder er muss sie in der Elternkabine annehmen.
        </p>
      )}
      {main && (
        <div className="ek-co-actions">
          {link.incoming ? (
            <>
              <button
                type="button"
                className="ek-primary"
                disabled={busy}
                onClick={() => run("link/respond", { accept: true })}
              >
                Annehmen
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run("link/respond", { accept: false })}
              >
                Ablehnen
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ek-danger"
              disabled={busy}
              onClick={() =>
                run(
                  "link/end",
                  undefined,
                  link.status === "active"
                    ? `Verbindung mit ${name} trennen? Ihr seht danach nur noch die Kanäle eurer eigenen Kinder.`
                    : "Anfrage zurückziehen?",
                )
              }
            >
              {link.status === "active"
                ? "Verbindung trennen"
                : "Anfrage zurückziehen"}
            </button>
          )}
        </div>
      )}
      {msg && <p className="ek-hint">{msg}</p>}
    </section>
  );
}
