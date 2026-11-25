"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShowcaseSettings } from "./products/showcase-settings";
import "./products/showcase-embed.css";
export type Feature = { key: string; enabled: boolean; updated_at: string };

/** Lädt die globalen Funktionen und schaltet sie um (nur Super-Admins). */
export function useFeatures({ quiet = false }: { quiet?: boolean } = {}) {
  const router = useRouter();
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/platform/features", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 401 || r.status === 403) return;
          throw Error("Funktionen konnten nicht geladen werden.");
        }
        const data = await r.json();
        if (live) setFeatures(data.features);
      })
      .catch((e) => {
        if (live && !quiet) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [quiet]);
  async function toggle(feature: Feature) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/platform/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: feature.key,
          enabled: !feature.enabled,
          expected: feature.enabled,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setFeatures(data.features);
      router.refresh();
      window.dispatchEvent(new Event("platform-features-changed"));
      try {
        localStorage.setItem("platform-features-changed", String(Date.now()));
      } catch {}
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const paiActive =
    features?.some((f) => f.key === "pai" && f.enabled) === true;
  return { features, error, busy, toggle, paiActive };
}

export function featureName(key: string) {
  return key === "pai"
    ? "PAiLTON"
    : key === "pai_mascot"
      ? "PAiLTON-Maskottchen"
      : key === "trial_training"
        ? "Probetraining"
        : key === "product_shop"
          ? "Produkt-Shop"
          : key === "parent_auto_mail"
            ? "Automatische Mails an aktive Eltern"
            : key;
}

/** Erklärung zu einer Funktion (gleich in alter und neuer Darstellung). */
export function FeatureNote({
  feature,
  paiActive,
}: {
  feature: Feature;
  paiActive: boolean;
}) {
  return (
    <>
      {feature.key === "product_shop" && (
        <p className="muted">
          Steuert den Zugriff auf /produkte und neue Käufe. Bereits bezahlte
          Buchungen und die Synchronisierung bestehender Abos laufen weiter. Nur
          Super-Admins können diesen Schalter ändern.
        </p>
      )}
      {feature.key === "parent_auto_mail" && (
        <p className="muted">
          {feature.enabled
            ? "An: Trainingsplanung, Erinnerung, Teilnahme, Berichte und Stempelkarten gehen automatisch an alle aktiven Eltern (Konto, E-Mail bestätigt)."
            : "Aus: Diese Mails gehen nur an eingetragene Test-Adressen."}{" "}
          Einladungen bleiben unverändert aus. Persönliche Abmeldungen und
          „Eltern benachrichtigen“ am Termin gelten weiter. Bereits
          zurückgehaltene Mails werden nicht nachgeschickt. Nur Super-Admins
          können diesen Schalter ändern.
        </p>
      )}
      {feature.key === "trial_training" && (
        <p className="muted">
          Steuert Anfragen, Probetraining-Bereiche und zugehörige Mails. Beim
          Deaktivieren bleiben Daten und bestehende Campzugänge erhalten.
        </p>
      )}
      {feature.key === "pai_mascot" && (
        <p className="muted">
          {paiActive
            ? "Nur die Figuren. Chatleiste und Sprechblasen bleiben sichtbar."
            : "Zuerst PAiLTON aktivieren."}
        </p>
      )}
    </>
  );
}

export function PlatformFeatures({
  linkOnly = false,
  optional = false,
  only,
}: {
  linkOnly?: boolean;
  optional?: boolean;
  only?: string;
}) {
  const { features, error, busy, toggle, paiActive } = useFeatures({
    quiet: linkOnly,
  });
  if (optional && !features) return null;
  if (only && features && !features.some((f) => f.key === only)) return null;
  if (linkOnly)
    return features ? (
      <section className="panel account-panel">
        <h2>Funktionen</h2>
        <Link href="/admin/funktionen">Globale Funktionen verwalten</Link>
      </section>
    ) : null;
  return (
    <section className="panel account-panel settings-panel">
      <h2>
        {only === "product_shop"
          ? "Produkt-Shop"
          : only === "parent_auto_mail"
            ? "Mailversand an Eltern"
            : "Globale Funktionen"}
      </h2>
      {optional && (
        <Link href="/admin/funktionen">Zur Funktionsverwaltung</Link>
      )}
      <p>
        Änderungen gelten sofort für alle Benutzer. Gespeicherte Einstellungen
        bleiben erhalten.
      </p>
      {error && <p role="alert">{error}</p>}
      {!features && !error && <p>Wird geladen …</p>}
      {features
        ?.filter((feature) => !only || feature.key === only)
        .map((feature) => (
          <div
            className="account-row"
            key={feature.key}
            data-feature={feature.key}
          >
            <div>
              <strong>{featureName(feature.key)}</strong>
              <p>{feature.enabled ? "Aktiviert" : "Deaktiviert"}</p>
              <FeatureNote feature={feature} paiActive={paiActive} />
              <small>
                Zuletzt geändert:{" "}
                {new Date(feature.updated_at).toLocaleString("de-DE", {
                  timeZone: "Europe/Berlin",
                })}{" "}
                (Berlin)
              </small>
            </div>
            <button
              type="button"
              className={
                feature.enabled ? "secondary-button" : "primary-button"
              }
              disabled={busy || (feature.key === "pai_mascot" && !paiActive)}
              aria-pressed={feature.enabled}
              onClick={() => void toggle(feature)}
            >
              {feature.enabled ? "Deaktivieren" : "Aktivieren"}
            </button>
          </div>
        ))}
      {features?.some((f) => f.key === "product_shop") &&
        (!only || only === "product_shop") && <ShowcaseSettings />}
      {!only && features?.some((f) => f.key === "pai" && f.enabled) && (
        <p>
          <Link href="/pai">PAiLTON öffnen</Link> ·{" "}
          <Link href="/admin/pai">PAiLTON verwalten</Link>
        </p>
      )}
    </section>
  );
}
