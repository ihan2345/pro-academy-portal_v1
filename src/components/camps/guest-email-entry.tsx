"use client";
import "./guest-email-entry.css";
import { useState } from "react";
import { Modal } from "@/components/portal";
import { useGuestEmailCheck } from "./guest-email-check";

export function GuestCampEmailEntry({
  email,
  onEmailChange,
  loginHref,
  onNewCustomer,
  onPromptChange,
}: {
  email: string;
  onEmailChange: (email: string) => void;
  loginHref: string;
  onNewCustomer: (email: string) => void;
  onPromptChange?: (open: boolean) => void;
}) {
  const check = useGuestEmailCheck(email, true, loginHref);
  const [unknownEmail, setUnknownEmail] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(false);
  function closePrompt() {
    setPrompt(false);
    onPromptChange?.(false);
  }
  async function verify() {
    if (!(await check.verify())) return;
    setUnknownEmail(email.trim().toLowerCase());
    setPrompt(true);
    onPromptChange?.(true);
  }
  return (
    <>
      <form
        className="camp-form camp-email-entry"
        onSubmit={(event) => {
          event.preventDefault();
          void verify();
        }}
      >
        <h2>Mit welcher E-Mail möchtest du buchen?</h2>
        <p>Wir prüfen, ob bereits ein Kundenzugang vorhanden ist.</p>
        <label>
          E-Mail
          <input
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            onBlur={() => {
              if (!prompt) void verify();
            }}
          />
        </label>
        {check.checking && <p role="status">E-Mail wird geprüft …</p>}
        {check.message && <p role="status">{check.message}</p>}
        <button
          type="submit"
          className="primary-button"
          disabled={check.checking}
        >
          Weiter
        </button>
      </form>
      {prompt && (
        <Modal
          title="Hast du bereits ein aktives Abo bei uns?"
          close={closePrompt}
          dismissOnBackdropClick={false}
          initialFocus='input[type="email"]'
        >
          <div className="camp-email-prompt">
            <p>
              Für diese E-Mail haben wir keinen bestehenden Kundenzugang
              gefunden. Falls du bereits ein aktives Abo hast, verwende bitte
              dieselbe E-Mail-Adresse wie bei deinem Kauf über Stripe.
            </p>
            <form
              className="camp-form"
              onSubmit={(event) => {
                event.preventDefault();
                void verify();
              }}
            >
              <label>
                E-Mail für erneute Prüfung
                <input
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => onEmailChange(event.target.value)}
                />
              </label>
              <button className="secondary-button" disabled={check.checking}>
                {check.checking ? "Wird geprüft …" : "Andere E-Mail prüfen"}
              </button>
            </form>
            {check.message && <p role="status">{check.message}</p>}
            {email.trim().toLowerCase() !== unknownEmail && (
              <p role="status">
                Bitte prüfe zuerst die geänderte E-Mail-Adresse.
              </p>
            )}
            <button
              type="button"
              className="primary-button"
              disabled={
                check.checking || email.trim().toLowerCase() !== unknownEmail
              }
              onClick={() => {
                if (
                  !unknownEmail ||
                  check.checking ||
                  email.trim().toLowerCase() !== unknownEmail
                )
                  return;
                closePrompt();
                onNewCustomer(unknownEmail);
              }}
            >
              Nein, ich habe kein aktives Abo
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
