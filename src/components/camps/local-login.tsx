"use client";
import { useState } from "react";
import { CampFrame, CampError, campApi } from "./shared";
export function LocalCampLogin({ emails }: { emails: string[] }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <CampFrame>
      <h1>
        Kundenzugang<span>.</span>
      </h1>
      <p>Wähle dein Konto, um deine Camps und Buchungen zu öffnen.</p>
      <div className="camp-panel">
        <CampError message={error} />
        {emails.map((email) => (
          <button
            key={email}
            className="secondary-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await campApi("local-login", { email });
                const next = sessionStorage.getItem("camp_return");
                sessionStorage.removeItem("camp_return");
                location.assign(
                  next?.startsWith("/camp/buchung/") ? next : "/camps",
                );
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? "Anmeldung …" : email}
          </button>
        ))}
        {!emails.length && <p>Es ist noch kein Konto verfügbar.</p>}
      </div>
    </CampFrame>
  );
}
