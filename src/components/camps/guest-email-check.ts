"use client";
import { useRef, useState } from "react";
import { campApi } from "./api-client";

export function useGuestEmailCheck(
  email: string,
  enabled: boolean,
  loginHref: string,
) {
  const current = useRef(email.trim().toLowerCase());
  current.current = email.trim().toLowerCase();
  const currentDestination = useRef(enabled ? loginHref : null);
  currentDestination.current = enabled ? loginHref : null;
  const available = useRef<string | null>(null);
  const pending = useRef<{ email: string; promise: Promise<boolean> } | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  async function verify() {
    if (!enabled) return true;
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return false;
    const requestKey = `${normalized}|${loginHref}`;
    if (available.current === normalized) return true;
    if (pending.current?.email === requestKey) return pending.current.promise;
    setChecking(true);
    setMessage("");
    const promise = (async () => {
      try {
        const result = await campApi("email-check", { email: normalized });
        if (
          current.current !== normalized ||
          currentDestination.current !== loginHref
        )
          return false;
        if (typeof result.requires_login !== "boolean")
          throw new Error(
            "Die E-Mail konnte nicht geprüft werden. Bitte erneut versuchen.",
          );
        if (result.requires_login) {
          setMessage(
            "Diese E-Mail ist bereits zugeordnet. Weiter zur Anmeldung / Aktivierung …",
          );
          try {
            sessionStorage.setItem("pa_login_email", normalized);
          } catch {}
          window.location.assign(loginHref);
          return false;
        }
        available.current = normalized;
        return true;
      } catch (error) {
        if (current.current === normalized)
          setMessage(
            error instanceof Error
              ? error.message
              : "Die E-Mail konnte nicht geprüft werden.",
          );
        return false;
      } finally {
        if (pending.current?.email === requestKey) {
          pending.current = null;
          setChecking(false);
        }
      }
    })();
    pending.current = { email: requestKey, promise };
    return promise;
  }
  return { verify, checking, message };
}
