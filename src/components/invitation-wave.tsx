"use client";
import { useCallback, useEffect, useState } from "react";

export type Family = {
  parent_id: string;
  name: string;
  email: string;
  basis: "abo" | "camp";
  reason?: string;
};
export type Overview = {
  delivery_enabled: boolean;
  invite: Family[];
  skipped: Family[];
  release_holds: Family[];
  old_held_invitations: number;
  wave_jobs: Record<string, number>;
  accepted: number;
};
export const reasons: Record<string, string> = {
  dublette: "Adresse doppelt vergeben",
  mail_ungueltig: "E-Mail ungültig",
  team_konto: "Adresse gehört zu einem Team-Konto",
  einladung_offen: "Einladung bereits offen",
};
export const basisLabel = (b: string) =>
  b === "abo" ? "Abo" : "Aktuelles Camp";

async function call(body?: unknown) {
  const r = await fetch("/api/admin/invitation-wave", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(Error(data.error ?? "Fehler"), { status: r.status });
  return data;
}

function List({
  title,
  rows,
  note,
}: {
  title: string;
  rows: Family[];
  note?: (f: Family) => string;
}) {
  if (!rows.length) return null;
  return (
    <details className="invitation-wave-list">
      <summary>
        {title} ({rows.length})
      </summary>
      <ul>
        {rows.map((f) => (
          <li key={f.parent_id}>
            <strong>{f.name}</strong> · {f.email} ·{" "}
            {note ? note(f) : basisLabel(f.basis)}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Daten und Aktionen der Einladungswelle (Release 062). Testeinladung und
 * Start mit Zahl-Bestätigung bleiben in beiden Darstellungen gleich.
 */
export function useInvitationWave() {
  const [data, setData] = useState<Overview | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  const load = useCallback(async () => {
    try {
      setData((await call()).overview);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) setHidden(true);
      else setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const sent = data
    ? Object.values(data.wave_jobs).reduce((a, b) => a + b, 0)
    : 0;
  const invite = data?.invite.length ?? 0,
    releases = data?.release_holds.length ?? 0;
  const canStart =
    !!data &&
    !busy &&
    data.delivery_enabled &&
    !(invite === 0 && releases === 0) &&
    Number(confirm) === invite &&
    confirm !== "";
  async function test() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await call({ action: "test" });
      setInfo(
        "Testeinladung ist unterwegs (Versand innerhalb von etwa 5 Minuten).",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!canStart) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const r = await call({
        action: "start",
        expected_invitations: invite,
        expected_releases: releases,
        confirm: Number(confirm),
      });
      setData(r.overview);
      setConfirm("");
      setInfo(
        `${r.result.invited} Einladungen erstellt, ${r.result.released} Familien freigegeben. Der Versand läuft in Paketen von 20 alle 5 Minuten.`,
      );
    } catch (e) {
      setError((e as Error).message);
      void load();
    } finally {
      setBusy(false);
    }
  }
  return {
    data,
    hidden,
    error,
    info,
    busy,
    confirm,
    setConfirm: (v: string) => setConfirm(v.replace(/\D/g, "")),
    sent,
    invite,
    releases,
    canStart,
    test,
    start,
  };
}

/** Einladungswelle (Release 062). Nur für Super-Admins sichtbar. */
export function InvitationWave() {
  const {
    data,
    hidden,
    error,
    info,
    busy,
    confirm,
    setConfirm,
    sent,
    invite,
    releases,
    canStart,
    test,
    start,
  } = useInvitationWave();
  if (hidden) return null;
  return (
    <section
      className="panel account-panel settings-panel"
      data-section="invitation-wave"
    >
      <h2>Einladungswelle</h2>
      <p>
        Lädt alle Familien mit laufendem Abo und alle Familien des aktuellen
        Camps ins Elternportal ein, die noch nicht verbunden sind. Die Einladung
        ist 14 Tage gültig. Training-Mails, Selbstaktivierung und alle anderen
        Schalter bleiben unverändert. Zurückgehaltene alte Mails werden nicht
        nachgeschickt.
      </p>
      {error && <p role="alert">{error}</p>}
      {info && <p role="status">{info}</p>}
      {!data && !error && <p>Wird geladen …</p>}
      {data && (
        <>
          {!data.delivery_enabled && (
            <p role="alert">
              Der Hauptschalter für Elternmails ist aus. Die Welle kann nicht
              starten.
            </p>
          )}
          <div className="account-row">
            <span>Bekommen eine Einladung</span>
            <strong>{invite}</strong>
          </div>
          <div className="account-row">
            <span>
              Schon verbunden, werden für Familienmails freigegeben (keine
              Einladungsmail)
            </span>
            <strong>{releases}</strong>
          </div>
          <div className="account-row">
            <span>Ausgeschlossen, bitte von Hand klären</span>
            <strong>{data.skipped.length}</strong>
          </div>
          <div className="account-row">
            <span>
              Alte gesperrte Einladungsmails (werden bei den Empfängern
              verworfen)
            </span>
            <strong>{data.old_held_invitations}</strong>
          </div>
          {sent > 0 && (
            <div className="account-row">
              <span>Bisher in Wellen erstellt · verschickt · angenommen</span>
              <strong>
                {sent} · {data.wave_jobs.sent ?? 0} · {data.accepted}
              </strong>
            </div>
          )}
          <List title="Empfänger anzeigen" rows={data.invite} />
          <List title="Freigaben anzeigen" rows={data.release_holds} />
          <List
            title="Ausgeschlossene anzeigen"
            rows={data.skipped}
            note={(f) => reasons[f.reason ?? ""] ?? f.reason ?? ""}
          />
          <div className="account-row">
            <div>
              <strong>1. Testeinladung</strong>
              <p className="muted">
                Geht nur an deine eigene Adresse. Der Knopf in der Mail führt
                zur Anmeldung.
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !data.delivery_enabled}
              onClick={() => void test()}
            >
              Testeinladung an mich
            </button>
          </div>
          <form
            className="account-row"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <div>
              <strong>2. Welle starten</strong>
              <p className="muted">
                Kann nicht zurückgenommen werden. Zur Bestätigung die Zahl der
                Empfänger ({invite}) eintragen.
              </p>
              <input
                inputMode="numeric"
                aria-label="Anzahl der Empfänger bestätigen"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={String(invite)}
              />
            </div>
            <button className="primary-button" disabled={!canStart}>
              Welle starten
            </button>
          </form>
        </>
      )}
    </section>
  );
}
