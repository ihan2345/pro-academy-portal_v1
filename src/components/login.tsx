"use client";
import { SiteFooter } from "./site-footer";
import { useEffect, useState } from "react";
import { Mail, ArrowRight, ShieldCheck } from "lucide-react";
import { Brand } from "./portal";
export function LoginForm({
  initialError = "",
  playerId,
}: {
  initialError?: string;
  playerId?: string;
}) {
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [message, setMessage] = useState(initialError),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [cooldown, setCooldown] = useState(0),
    [cooldownUntil, setCooldownUntil] = useState(0);
  useEffect(() => {
    if (!cooldownUntil) return;
    const update = () =>
      setCooldown(Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);
  async function requestCode() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          ...(playerId ? { player_id: playerId } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Bitte versuche es erneut.");
      setCode("");
      setSent(true);
      setCooldown(60);
      setCooldownUntil(Date.now() + 60000);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Bitte versuche es erneut.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <Brand />
        <h1>Willkommen im Team.</h1>
        <p>Melde dich sicher und ohne Passwort in deinem Elternportal an.</p>
        {sent ? (
          <>
            <div className="auth-success" role="status">
              <Mail size={24} />
              <h2>Schau in dein Postfach.</h2>
              <p>
                Wenn dein Konto freigeschaltet ist, erhältst du einen
                sechsstelligen Code und einen Anmeldelink an{" "}
                <strong>{email.trim()}</strong>.
              </p>
            </div>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                setBusy(true);
                setMessage("");
                try {
                  const response = await fetch("/api/auth/verify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      email: email.trim().toLowerCase(),
                      code,
                    }),
                  });
                  const result = await response.json();
                  if (!response.ok)
                    throw new Error(
                      result.error || "Bitte versuche es erneut.",
                    );
                  window.location.assign(result.redirect);
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "Bitte versuche es erneut.",
                  );
                  setBusy(false);
                }
              }}
            >
              <label>
                Dein sechsstelliger E-Mail-Code
                <input
                  type="text"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  disabled={busy}
                />
              </label>
              {message && (
                <p role="alert" className="error-message">
                  {message}
                </p>
              )}
              <button
                className="primary-button"
                disabled={busy || code.length !== 6}
              >
                {busy ? "Wird geprüft …" : "Mit Code anmelden"}
                <ArrowRight size={18} />
              </button>
              <p>
                Alternativ kannst du den Anmeldelink in derselben E-Mail öffnen.
                Verwende dafür denselben Browser und dasselbe Gerät wie bei der
                Anforderung.
              </p>
              <button
                type="button"
                className="text-button"
                disabled={busy || cooldown > 0}
                onClick={requestCode}
              >
                {cooldown > 0
                  ? `Neuen Code anfordern in ${cooldown} s`
                  : "Neuen Code anfordern"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setSent(false);
                  setCode("");
                  setMessage("");
                }}
              >
                Andere E-Mail verwenden
              </button>
            </form>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) void requestCode();
            }}
          >
            <label>
              Deine E-Mail-Adresse
              <input
                type="email"
                autoComplete="email"
                required
                placeholder="name@domain.de"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
            </label>
            {message && (
              <p role="alert" className="error-message">
                {message}
              </p>
            )}
            <button className="primary-button" disabled={busy}>
              {busy ? "Wird angefordert …" : "Anmeldecode anfordern"}
              <ArrowRight size={18} />
            </button>
          </form>
        )}
        <p className="auth-note">
          <ShieldCheck
            size={16}
            style={{
              display: "inline",
              verticalAlign: "middle",
              marginRight: 6,
            }}
          />{" "}
          Code und Link sind persönlich, zeitlich begrenzt und nur einmal
          verwendbar. Sobald du eine Methode nutzt, wird auch die andere
          ungültig.
        </p>
      </section>
      <SiteFooter compact />
    </main>
  );
}
