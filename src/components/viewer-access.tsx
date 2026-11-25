"use client";
import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { api } from "./team";
import { formatDate } from "@/lib/domain";

type ViewerRow = {
  id: string;
  email: string;
  display_name: string;
  clear_names: boolean;
  active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
};

/**
 * Lese-Rolle „Einsicht“ (Release 061) unter /admin/mitarbeiter:
 * Mitarbeiter und Außenberater, die alles sehen, aber nichts ändern.
 */
export function ViewerAccessPanel({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [rows, setRows] = useState<ViewerRow[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [clearNames, setClearNames] = useState(false);
  async function load() {
    try {
      const result = await api("admin/viewers", undefined, "GET");
      setRows(result.rows);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(input: {
    email: string;
    name: string;
    clear_names: boolean;
    active: boolean;
  }) {
    setBusy(true);
    try {
      await api("admin/viewers", input);
      notify("Lesezugriff gespeichert.");
      await load();
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel viewer-access" id="lesezugriff">
      <h2>
        <Eye size={18} aria-hidden /> Lesezugriff (Mitarbeiter &amp; Berater)
      </h2>
      <p className="muted">
        Sieht fast alles wie ein Admin, kann aber nichts ändern. Einstellungen,
        PAiLTON, Stripe-Zuordnung und Einladungen sind ausgeblendet. Kinder und
        Eltern erscheinen als Initialen, Jahrgang und Kennung (z. B. „M. K. ·
        2015 · #4F2“). Kontaktdaten, Zahlungs-IDs, Gründe und Notizen werden
        ausgeblendet. Mit „Klarnamen sehen“ zeigt das Portal dieser Person alles
        im Klartext, bearbeiten kann sie trotzdem nichts.
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <table className="viewer-access-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>E-Mail</th>
              <th>Klarnamen sehen</th>
              <th>Zugang</th>
              <th>Zuletzt angemeldet</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.display_name || "—"}</td>
                <td>{r.email}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Klarnamen sehen für ${r.email}`}
                    checked={r.clear_names}
                    disabled={busy}
                    onChange={(e) =>
                      void save({
                        email: r.email,
                        name: r.display_name,
                        clear_names: e.target.checked,
                        active: r.active,
                      })
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void save({
                        email: r.email,
                        name: r.display_name,
                        clear_names: r.clear_names,
                        active: !r.active,
                      })
                    }
                  >
                    {r.active ? "Aktiv · sperren" : "Gesperrt · freigeben"}
                  </button>
                </td>
                <td>
                  {r.last_sign_in_at
                    ? formatDate(r.last_sign_in_at)
                    : "Noch nie"}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5}>Noch kein Lesezugriff vergeben.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <form
        className="viewer-access-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save({
              email,
              name,
              clear_names: clearNames,
              active: true,
            })
          ) {
            setEmail("");
            setName("");
            setClearNames(false);
          }
        }}
      >
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Steuerberater Müller"
            maxLength={120}
          />
        </label>
        <label>
          E-Mail (Anmeldung per Code)
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={clearNames}
            onChange={(e) => setClearNames(e.target.checked)}
          />
          Klarnamen sehen (nur für eigene Mitarbeiter)
        </label>
        <button className="primary-button" disabled={busy || !email}>
          Lesezugriff vergeben
        </button>
      </form>
    </section>
  );
}
