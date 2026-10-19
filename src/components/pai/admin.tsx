"use client";
import { PlatformFeatures } from "@/components/platform-features";
import { useEffect, useState } from "react";
import {
  defaultConfig,
  type PaiConfig,
  type PaiStatus,
} from "@/lib/pai/domain";
import { paiApi, PaiUsage } from "./chat";
const labels: Record<string, string> = {
  starter: "Kein Abzeichen",
  bronze: "Bronze",
  silver: "Silber",
  gold: "Gold",
  ultimate: "Ultimativ",
  firsttouch: "FirstTouch",
  gamechanger: "Gamechanger",
  pro: "Pro",
  nextlevel: "NextLevel",
  parent: "Eltern",
  staff: "Coaches",
  admin: "Admins",
  day: "Tag",
  month: "Monat",
};
export function PaiAdmin() {
  const [data, setData] = useState<any>(null),
    [config, setConfig] = useState<PaiConfig>(defaultConfig),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [status, setStatus] = useState<PaiStatus | null>(null),
    [limit, setLimit] = useState(10),
    [kind, setKind] = useState("day"),
    [reason, setReason] = useState(""),
    [expiry, setExpiry] = useState("");
  async function load() {
    const d = await paiApi(
      `admin?search=${encodeURIComponent(search)}&offset=${offset}`,
    );
    setData(d);
    setConfig(d.config);
    if (selected)
      setSelected(d.users.find((u: any) => u.id === selected.id) ?? selected);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [offset]);
  async function mutate(path: string, body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await paiApi(path, "POST", body);
      await load();
      if (selected) {
        try {
          setStatus(await paiApi(`admin/user?id=${selected.id}`));
        } catch {
          setStatus(null);
        }
      }
      setNotice("Gespeichert und protokolliert.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function number(
    label: string,
    value: number,
    onChange: (v: number) => void,
    step = 1,
    max = 1000,
  ) {
    return (
      <label className="pai-field" key={label}>
        {label}
        <input
          type="number"
          required
          min="0"
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
    );
  }
  return (
    <div className="pai-admin">
      <h1>pAi verwalten</h1>
      <p>
        Fragen, Limits und geschätzte API-Kosten. Chat-Inhalte sind hier nicht
        sichtbar.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {data && (
        <>
          <div className="pai-metrics">
            {[
              ["Fragen heute", data.today],
              ["Fragen im Monat", data.month],
              ["Aktive Nutzer", data.activeUsers],
              ["Tokens", data.tokens],
              ["Fehler", data.errors],
              ["Kosten (USD, geschätzt)", data.spent.toFixed(4)],
              ["Reserviert (USD)", data.reserved.toFixed(4)],
              ["Restbudget (USD)", data.remaining.toFixed(2)],
            ].map(([label, value]) => (
              <section className="panel" key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </section>
            ))}
          </div>
          <p>
            {data.roles
              .map((r: any) => `${labels[r.role]}: ${r.questions} Fragen`)
              .join(" · ")}
          </p>
          {data.warning >= 50 && (
            <p role="status" className="pai-budget-warning">
              Budgetwarnung:{" "}
              {data.warning >= 100
                ? "Budget ausgeschöpft"
                : data.warning >= 90
                  ? "90-%-Schwelle erreicht"
                  : data.warning >= 75
                    ? "75-%-Schwelle erreicht"
                    : "50-%-Schwelle erreicht"}
              . Laufende und unklare Reservierungen sind enthalten.
            </p>
          )}
          <PlatformFeatures optional />
          <form
            className="panel"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate("admin/config", { config, version: data.version });
            }}
          >
            <h2>Standards und Budget</h2>
            <div className="pai-fields">
              {Object.entries(config.bases).map(([key, v]) =>
                number(`Basis ${labels[key]}`, v, (n) =>
                  setConfig({
                    ...config,
                    bases: { ...config.bases, [key]: n },
                  }),
                ),
              )}
              {Object.entries(config.factors).map(([key, v]) =>
                number(`Faktor ${labels[key]} (%)`, v, (n) =>
                  setConfig({
                    ...config,
                    factors: { ...config.factors, [key]: n },
                  }),
                ),
              )}
              {number("Coach / Tag", config.coach, (n) =>
                setConfig({ ...config, coach: n }),
              )}
              {number("Admin / Tag", config.admin, (n) =>
                setConfig({ ...config, admin: n }),
              )}
              {number(
                "Ohne Abo / unbekannter Tarif: pro Monat",
                config.monthlyFallback,
                (n) => setConfig({ ...config, monthlyFallback: n }),
              )}
              {number(
                "Monatsbudget (USD)",
                config.budgetUsd,
                (n) => setConfig({ ...config, budgetUsd: n }),
                0.01,
                10000,
              )}
              {number(
                "Chat-Aufbewahrung (Tage)",
                config.retentionDays,
                (n) => setConfig({ ...config, retentionDays: n }),
                1,
                365,
              )}
              <label className="pai-field">
                Modell
                <select
                  value={config.model}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      model: e.target.value as PaiConfig["model"],
                    })
                  }
                >
                  <option>gpt-5.4-mini</option>
                  <option>gpt-5.4-mini-2026-03-17</option>
                </select>
              </label>
            </div>
            <p className="muted">
              Faktoren: 50 % = ×0,5. Aufbewahrung 0 = kein dauerhafter Verlauf.
              Verkürzen löscht abgelaufene Chattexte; Nutzung und Kosten bleiben
              erhalten. Modellpreise: Stand 17.10.2026.
            </p>
            <button className="primary-button" disabled={busy}>
              Einstellungen speichern
            </button>
          </form>
          <section className="panel">
            <h2>Nutzer und Ausnahmen</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (offset) setOffset(0);
                else load().catch((e) => setError(e.message));
              }}
            >
              <label htmlFor="pai-search">Name suchen</label>
              <input
                id="pai-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="secondary-button">Suchen</button>
            </form>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nutzer</th>
                    <th>Rolle</th>
                    <th>Heute / 30 Tage</th>
                    <th>Kosten USD</th>
                    <th>Letzte Aktivität</th>
                    <th>Ausnahme</th>
                    <th>Berechnung</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u: any) => (
                    <tr key={u.id}>
                      <td>{u.full_name}</td>
                      <td>{labels[u.role]}</td>
                      <td>
                        {u.today} / {u.last30}
                      </td>
                      <td>{u.cost.toFixed(4)}</td>
                      <td>
                        {u.last
                          ? new Date(u.last).toLocaleDateString("de-DE")
                          : "–"}
                      </td>
                      <td>
                        {u.override?.active &&
                        (!u.override.expires_at ||
                          Date.parse(u.override.expires_at) > Date.now())
                          ? `${u.override.limit_value} / ${labels[u.override.period_kind]}`
                          : "Standard"}
                      </td>
                      <td>
                        <button
                          className="secondary-button"
                          onClick={async () => {
                            setSelected(u);
                            setStatus(null);
                            setLimit(u.override?.limit_value ?? 10);
                            setKind(u.override?.period_kind ?? "day");
                            setReason(u.override?.reason ?? "");
                            setExpiry(
                              u.override?.expires_at?.slice(0, 10) ?? "",
                            );
                            try {
                              setStatus(await paiApi(`admin/user?id=${u.id}`));
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          Details / Bearbeiten
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 25))}
            >
              Zurück
            </button>
            <button
              disabled={!data.more}
              onClick={() => setOffset(offset + 25)}
            >
              Weiter
            </button>
          </section>
          {selected && (
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                void mutate("admin/override", {
                  userId: selected.id,
                  limit,
                  kind,
                  reason,
                  expiresAt: expiry
                    ? new Date(`${expiry}T23:59:59Z`).toISOString()
                    : null,
                  active: true,
                });
              }}
            >
              <h2>Ausnahme: {selected.full_name}</h2>
              {status && <PaiUsage status={status} />}
              <p>
                Abzeichen: {status?.badge ?? "–"} · Abo-Faktorgruppe:{" "}
                {status?.plan ?? "–"} · Faktor: {status?.factor ?? "–"}
              </p>
              {selected.override && (
                <p>
                  Zuletzt gespeichert am{" "}
                  {new Date(selected.override.updated_at).toLocaleString(
                    "de-DE",
                  )}{" "}
                  · Erstellt von {selected.override.created_by} · Zuletzt
                  bearbeitet von{" "}
                  {selected.override.updated_by ?? selected.override.created_by}
                </p>
              )}
              <div className="pai-fields">
                {number("Fragen", limit, setLimit)}
                <label>
                  Zeitraum
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="day">Tag</option>
                    <option value="month">Monat</option>
                  </select>
                </label>
                <label>
                  Ablaufdatum (Ende des Tages UTC, optional)
                  <input
                    type="date"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                  />
                </label>
                <label>
                  Interne Begründung
                  <input
                    required
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              </div>
              <button className="primary-button" disabled={busy}>
                Ausnahme speichern
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || reason.trim().length < 3}
                onClick={() =>
                  void mutate("admin/override", {
                    userId: selected.id,
                    limit,
                    kind,
                    reason,
                    expiresAt: null,
                    active: false,
                  })
                }
              >
                Ausnahme widerrufen
              </button>
            </form>
          )}
          <p className="pai-release-stop">
            STOPP: Vor Veröffentlichung den neuen offiziellen
            pAi-Produktions-API-Schlüssel hinterlegen und bestätigen!
          </p>
        </>
      )}
    </div>
  );
}
