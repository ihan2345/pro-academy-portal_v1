"use client";
import { useState } from "react";
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
    [message, setMessage] = useState(initialError),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false);
  return (
    <main className="auth-page">
      <section className="auth-card">
        <Brand />
        <h1>Willkommen im Team.</h1>
        <p>Melde dich sicher und ohne Passwort in deinem Elternportal an.</p>
        {sent ? (
          <div className="auth-success">
            <Mail size={24} />
            <h2>Schau in dein Postfach.</h2>
            <p>
              Wenn dein Konto freigeschaltet ist, erhältst du einen persönlichen
              Anmeldelink.
            </p>
            <button className="text-button" onClick={() => setSent(false)}>
              Andere E-Mail verwenden
            </button>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMessage("");
              try {
                const response = await fetch("/api/auth/login", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email,
                    ...(playerId ? { player_id: playerId } : {}),
                  }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                setSent(true);
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
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
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {message && (
              <p role="alert" className="error-message">
                {message}
              </p>
            )}
            <button className="primary-button" disabled={busy}>
              {busy ? "Wird angefordert …" : "Anmeldelink anfordern"}
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
          Dein Link ist persönlich und nur einmal gültig.
        </p>
      </section>
    </main>
  );
}
