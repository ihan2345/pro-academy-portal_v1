"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Printer, ArrowUpDown } from "lucide-react";
import { campApi } from "./api-client";
import {
  campCustomerGroups,
  customerColumns,
  customerCell,
  selectCampCustomers,
  campCustomersCsv,
  type CampCustomer,
  type CampCustomerGroup,
  type CustomerSort,
} from "@/lib/camps/customers";

type Data = {
  role: string;
  camp: { id: string; title: string };
  rows: CampCustomer[];
};
export function CampCustomerList({ campId }: { campId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [groups, setGroups] = useState<CampCustomerGroup[]>([
    "subscriber",
    "new",
    "none",
  ]);
  const [sort, setSort] = useState<CustomerSort>("last_name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    setData(null);
    campApi(`customers?camp_id=${campId}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [campId, retry]);
  const columns = (Object.keys(customerColumns) as CustomerSort[]).filter(
    (c) => c !== "paid_amount" || data?.role === "admin",
  );
  const rows = selectCampCustomers(
    data?.rows ?? [],
    groups,
    sort,
    direction,
    search,
  );
  function download() {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob([campCustomersCsv(rows, columns)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `Camp-Kundenliste-${data.camp.title.replace(/[^\p{L}\p{N} -]/gu, "").trim()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="camp-customer-list">
      <Link
        className="camp-back-link camp-customer-controls"
        href={`/camps/${campId}`}
      >
        ← Zur Camp-Übersicht
      </Link>
      <div className="page-heading">
        <div>
          <div className="camp-eyebrow">CAMP-VERWALTUNG</div>
          <h1>
            Kundenliste<span className="greeting-dot">.</span>
          </h1>
          <p>{data?.camp.title ?? "Camp-Kundenliste"}</p>
        </div>
        <div className="camp-actions camp-customer-controls">
          <button
            className="primary-button"
            disabled={!data || !rows.length}
            onClick={download}
          >
            <Download size={17} aria-hidden="true" /> CSV exportieren
          </button>
          <button
            className="secondary-button"
            disabled={!data}
            onClick={() => window.print()}
          >
            <Printer size={17} aria-hidden="true" /> Drucken / PDF
          </button>
        </div>
      </div>
      {error ? (
        <div role="alert" className="camp-panel">
          <p>{error}</p>
          <button
            className="secondary-button"
            onClick={() => setRetry((v) => v + 1)}
          >
            Erneut laden
          </button>
        </div>
      ) : !data ? (
        <p role="status">Kundenliste wird geladen …</p>
      ) : (
        <>
          <div className="camp-panel camp-customer-controls">
            <fieldset className="camp-customer-groups">
              <legend>Kundengruppe · Mehrfachauswahl</legend>
              {(
                Object.entries(campCustomerGroups) as [
                  CampCustomerGroup,
                  string,
                ][]
              ).map(([group, label]) => (
                <label key={group}>
                  <input
                    type="checkbox"
                    checked={groups.includes(group)}
                    onChange={(e) =>
                      setGroups((current) =>
                        e.target.checked
                          ? [...current, group]
                          : current.filter((g) => g !== group),
                      )
                    }
                  />
                  {label}{" "}
                  <span>
                    (
                    {data.rows.filter((r) => r.customer_group === group).length}
                    )
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="camp-customer-filters">
              <label>
                Suche
                <input
                  type="search"
                  placeholder="Name, E-Mail oder Telefon"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label>
                Sortieren nach
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as CustomerSort)}
                >
                  {columns.map((key) => (
                    <option key={key} value={key}>
                      {customerColumns[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reihenfolge
                <select
                  value={direction}
                  onChange={(e) =>
                    setDirection(e.target.value as "asc" | "desc")
                  }
                >
                  <option value="asc">
                    Aufsteigend · A–Z / klein–groß / alt–neu
                  </option>
                  <option value="desc">
                    Absteigend · Z–A / groß–klein / neu–alt
                  </option>
                </select>
              </label>
              <button
                className="secondary-button"
                onClick={() => {
                  setGroups(["subscriber", "new", "none"]);
                  setSearch("");
                  setSort("last_name");
                  setDirection("asc");
                }}
              >
                Zurücksetzen
              </button>
            </div>
          </div>
          <p aria-live="polite">
            <strong>
              {rows.length} von {data.rows.length}
            </strong>{" "}
            bestätigten Teilnehmern · Export und Druck übernehmen diese Auswahl
            und Sortierung.
          </p>
          <p className="camp-muted">
            Aktives Abo: aktueller Abo-Status des Kindes. Neukunde: Familie
            erstmals durch diese Campbuchung angelegt. Ohne Abo: bestehende
            Kunden ohne aktives Abo, einschließlich früherer Campkunden.
          </p>
          {rows.length ? (
            <div
              className="camp-customer-table"
              role="region"
              aria-label="Camp-Kundenliste"
              tabIndex={0}
            >
              <table>
                <caption className="sr-only">
                  {data.camp.title} – bestätigte Camp-Teilnehmer
                </caption>
                <thead>
                  <tr>
                    {columns.map((key) => (
                      <th
                        key={key}
                        scope="col"
                        aria-sort={
                          sort === key
                            ? direction === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          onClick={() => {
                            setSort(key);
                            setDirection(
                              sort === key && direction === "asc"
                                ? "desc"
                                : "asc",
                            );
                          }}
                        >
                          {customerColumns[key]}
                          <ArrowUpDown size={13} aria-hidden="true" />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      {columns.map((key) => (
                        <td key={key}>
                          {key === "customer_group" ? (
                            <span
                              className={`camp-customer-tag ${row.customer_group}`}
                            >
                              {customerCell(row, key)}
                            </span>
                          ) : (
                            customerCell(row, key) || "–"
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="camp-panel">
              <p>
                {data.rows.length
                  ? "Keine Teilnehmer für diese Auswahl. Wähle mindestens eine passende Kundengruppe oder ändere die Suche."
                  : "Für dieses Camp liegen noch keine bestätigten Buchungen vor."}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
