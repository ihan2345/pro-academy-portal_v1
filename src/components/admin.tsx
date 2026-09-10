"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  CalendarDays,
  Mail,
  FileText,
  ArrowUpRight,
  Plus,
  Search,
  Check,
  RefreshCw,
  Settings,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";
import { Badge, Modal } from "./portal";
import { api } from "./team";
import type { PortalData } from "@/lib/types";
type RecordRow = Record<string, unknown>;
const entities: Record<
  string,
  {
    title: string;
    table: string;
    fields: { key: string; label: string; type?: string }[];
  }
> = {
  spieler: {
    title: "Spieler",
    table: "players",
    fields: [
      { key: "first_name", label: "Vorname" },
      { key: "last_name", label: "Nachname" },
      { key: "birth_year", label: "Geburtsjahr", type: "number" },
      { key: "team", label: "Altersklasse" },
    ],
  },
  eltern: {
    title: "Eltern",
    table: "parents",
    fields: [
      { key: "full_name", label: "Vollständiger Name" },
      { key: "contact_email", label: "Kontakt-E-Mail", type: "email" },
      { key: "billing_email", label: "Rechnungs-E-Mail", type: "email" },
    ],
  },
  mitarbeiter: {
    title: "Mitarbeiter",
    table: "staff_profiles",
    fields: [
      { key: "id", label: "Auth-Benutzer-ID" },
      { key: "display_name", label: "Anzeigename" },
    ],
  },
  standorte: {
    title: "Standorte",
    table: "locations",
    fields: [
      { key: "name", label: "Name" },
      { key: "address", label: "Adresse" },
    ],
  },
  produkte: {
    title: "Produkte & Preise",
    table: "plans",
    fields: [
      { key: "name", label: "Produktname" },
      { key: "stripe_price_id", label: "Stripe-Preis-ID" },
      { key: "generation", label: "Tarifgruppe" },
      { key: "billing_interval", label: "Zahlungsintervall" },
      {
        key: "included_units",
        label: "Einheiten pro Monat gesamt",
        type: "number",
      },
      { key: "athletics_units", label: "Davon Athletik", type: "number" },
    ],
  },
};
export function AdminView({
  data,
  section,
  notify,
}: {
  data: PortalData;
  section: string;
  notify: (s: string) => void;
}) {
  const slug = section.split("/")[1] ?? "",
    config = entities[slug];
  const [rows, setRows] = useState<RecordRow[]>([]),
    [search, setSearch] = useState(""),
    [edit, setEdit] = useState<RecordRow | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [reportTime, setReportTime] = useState("08:00");
  async function load() {
    setLoading(true);
    setError("");
    try {
      if (data.demo) {
        const source =
          slug === "spieler"
            ? data.players
            : slug === "standorte"
              ? data.locations
              : slug === "mitarbeiter"
                ? data.trainers.map((t) => ({ id: t.id, display_name: t.name }))
                : slug === "produkte"
                  ? [
                      {
                        id: "first",
                        name: "FirstTouch",
                        included_units: 4,
                        stripe_price_id: "Nicht verknüpft",
                      },
                      {
                        id: "game",
                        name: "GameChanger",
                        included_units: 8,
                        stripe_price_id: "Nicht verknüpft",
                      },
                      {
                        id: "pro",
                        name: "Pro-Player",
                        included_units: 10,
                        stripe_price_id: "Nicht verknüpft",
                      },
                    ]
                  : slug === "eltern"
                    ? [
                        {
                          id: "demo-parent",
                          full_name: "Sarah Beispiel",
                          contact_email: data.email,
                        },
                      ]
                    : [];
        setRows(source as unknown as RecordRow[]);
      } else {
        const result = await api(
          `admin/${config?.table ?? (slug === "einstellungen" ? "system_settings" : slug)}`,
          undefined,
          "GET",
        );
        setRows(result.rows ?? []);
        if (slug === "einstellungen")
          setReportTime(
            String(
              result.rows?.find((r: RecordRow) => r.key === "report_send_time")
                ?.value ?? "08:00",
            ),
          );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (config || slug === "einladungen" || slug === "einstellungen")
      void load();
  }, [slug]); // Each admin screen is separately authorized server-side.
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const record: RecordRow = {};
    for (const f of config.fields)
      record[f.key] =
        f.type === "number" ? Number(form.get(f.key)) : String(form.get(f.key));
    if (edit?.id) record.id = edit.id;
    try {
      if (data.demo) {
        setRows([
          ...rows.filter((r) => r.id !== record.id),
          { ...record, id: record.id ?? crypto.randomUUID() },
        ]);
        notify(
          "Lokale Demonstration: Datensatz in dieser Ansicht gespeichert.",
        );
      } else {
        await api(`admin/${config.table}`, record);
        await load();
        notify("Datensatz gespeichert und protokolliert.");
      }
      setEdit(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PROACADEMY VERWALTUNG</div>
          <h1>
            {config?.title ??
              {
                stripe: "Stripe-Zuordnung",
                einladungen: "Einladungen",
                protokolle: "Protokolle & Berichte",
                einstellungen: "Systemeinstellungen",
              }[slug] ??
              "Alles im Blick"}
            <span className="greeting-dot">.</span>
          </h1>
          <p>
            {slug === "stripe"
              ? "Kunden prüfen, Familien zuordnen und sicher einladen."
              : "Organisation, Training und Entwicklung an einem Ort."}
          </p>
        </div>
        {config && (
          <button className="primary-button" onClick={() => setEdit({})}>
            <Plus size={17} /> Neu anlegen
          </button>
        )}
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {!slug && (
        <>
          <div className="admin-metrics">
            {[
              { n: data.players.length, t: "Spieler", i: Users },
              {
                n: data.events.filter((e) => e.status !== "cancelled").length,
                t: "Trainings",
                i: CalendarDays,
              },
              { n: data.reports.length, t: "Berichte", i: FileText },
            ].map((m) => (
              <div className="panel admin-metric" key={m.t}>
                <m.i size={23} />
                <strong>{m.n}</strong>
                <span>{m.t}</span>
              </div>
            ))}
          </div>
          <div className="admin-shortcuts">
            {[
              {
                href: "spieler",
                title: "Familien verwalten",
                text: "Spieler, Eltern und Zuordnungen",
                icon: Users,
              },
              {
                href: "stripe",
                title: "Stripe-Import",
                text: "Abonnements mit Kindern verbinden",
                icon: RefreshCw,
              },
              {
                href: "protokolle",
                title: "Versand & Berichte",
                text: "Jobs, Fehler und Audit-Verlauf",
                icon: Mail,
              },
              {
                href: "einstellungen",
                title: "System konfigurieren",
                text: "Berichtszeit und Betriebsmodus",
                icon: Settings,
              },
            ].map((x) => (
              <Link
                className="panel admin-shortcut"
                key={x.href}
                href={`/admin/${x.href}`}
              >
                <x.icon />
                <h2>{x.title}</h2>
                <p>{x.text}</p>
                <ArrowUpRight size={20} />
              </Link>
            ))}
          </div>
          <div className="info-note">
            <ShieldCheck size={20} />
            <p>
              {data.demo
                ? "Demonstration mit fiktiven Familien. Verbindungen zu Supabase, Stripe und Proton werden erst nach Einrichtung der Testumgebung aktiv."
                : "Rollen, Stripe-Zuordnungen und Systemkonfiguration sind ausschließlich für Admins freigegeben."}
            </p>
          </div>
        </>
      )}
      {slug === "produkte" && (
        <p className="info-note">
          Bestandskunden: 4/8/10. Neukunden ab 01.09.2026: 4/8/12. Jahresabo: 10
          pro Monat. NEXT LEVEL: 8 Fußball + 4 Athletik. Alte Tarife bleiben für
          bestehende Abos aktiv und sind nicht öffentlich erhältlich.
        </p>
      )}
      {config && (
        <>
          <div className="admin-toolbar">
            <label className="search-input">
              <Search size={18} />
              <input
                aria-label="Datensätze suchen"
                placeholder="Suchen …"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {slug === "spieler" && (
              <Link className="secondary-button" href="/admin/eltern">
                Eltern verwalten <ArrowUpRight size={16} />
              </Link>
            )}
            <button
              className="icon-button"
              onClick={load}
              aria-label="Aktualisieren"
            >
              <RefreshCw size={19} />
            </button>
          </div>
          <section className="panel table-scroll">
            <table className="training-table">
              <thead>
                <tr>
                  {config.fields.map((f) => (
                    <th key={f.key}>{f.label.toUpperCase()}</th>
                  ))}
                  <th>AKTION</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) =>
                    JSON.stringify(r)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((r) => (
                    <tr key={String(r.id)}>
                      {config.fields.map((f) => (
                        <td key={f.key}>
                          {f.key === "generation"
                            ? ({
                                legacy: "Bestand",
                                current: "Neu ab 01.09.2026",
                                special: "Sondertarif",
                              }[String(r[f.key])] ?? "—")
                            : f.key === "billing_interval"
                              ? r[f.key] === "year"
                                ? "Jährlich"
                                : "Monatlich"
                              : String(r[f.key] ?? "—")}
                        </td>
                      ))}
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setEdit(r)}
                        >
                          Bearbeiten
                        </button>
                        {slug === "mitarbeiter" && (
                          <button
                            className="text-button"
                            onClick={async () => {
                              const role = window.prompt(
                                "Neue Rolle: parent, staff oder admin",
                                "staff",
                              );
                              if (!role) return;
                              try {
                                await api("admin/roles", { id: r.id, role });
                                notify("Rolle aktualisiert.");
                              } catch (e) {
                                notify((e as Error).message);
                              }
                            }}
                          >
                            Rolle ändern
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!rows.length && (
              <div className="empty-state">
                <Users />
                <p>
                  {loading
                    ? "Daten werden geladen …"
                    : "Noch keine Datensätze vorhanden."}
                </p>
              </div>
            )}
          </section>
        </>
      )}
      {slug === "eltern" && (
        <ParentLinks parents={rows} data={data} notify={notify} />
      )}
      {slug === "stripe" && <StripeImport data={data} notify={notify} />}
      {slug === "einladungen" && (
        <>
          <InviteForm data={data} notify={notify} />
          <RecordTable
            rows={rows}
            fields={["email", "expires_at", "consumed_at"]}
            empty="Noch keine Einladungen versendet."
          />
        </>
      )}
      {slug === "protokolle" && <Logs data={data} notify={notify} />}
      {slug === "einstellungen" && (
        <form
          className="panel account-panel settings-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            try {
              await api("admin/system_settings", {
                key: "report_send_time",
                value: form.get("report_send_time"),
              });
              notify("Versandzeit gespeichert.");
            } catch (e) {
              notify((e as Error).message);
            }
          }}
        >
          <h2>Berichte & Benachrichtigungen</h2>
          <label>
            PDF-Versandzeit · Europe/Berlin
            <input
              required
              type="time"
              name="report_send_time"
              value={reportTime}
              onChange={(e) => setReportTime(e.target.value)}
            />
          </label>
          <div className="account-row">
            <span>Elternstornierung</span>
            <Badge>Im MVP deaktiviert</Badge>
          </div>
          <div className="account-row">
            <span>Versandmodus</span>
            <Badge tone="demo">
              {data.demo ? "Lokale Demo" : "Serverkonfiguration"}
            </Badge>
          </div>
          <p className="muted">
            SMTP-Zugangsdaten, Stripe-Schlüssel und Cron-Secret werden
            ausschließlich auf dem Server hinterlegt.
          </p>
          <button className="primary-button">Einstellungen speichern</button>
        </form>
      )}
      {edit && config && (
        <Modal
          title={edit.id ? "Datensatz bearbeiten" : "Datensatz anlegen"}
          close={() => setEdit(null)}
        >
          <form className="form-body" onSubmit={save}>
            {config.fields.map((f) => (
              <label key={f.key}>
                {f.label}
                {f.key === "generation" || f.key === "billing_interval" ? (
                  <select
                    name={f.key}
                    defaultValue={String(
                      edit[f.key] ??
                        (f.key === "generation" ? "legacy" : "month"),
                    )}
                  >
                    {(f.key === "generation"
                      ? [
                          ["legacy", "Bestandskunden"],
                          ["current", "Neukunden ab 01.09.2026"],
                          ["special", "Sondertarif"],
                        ]
                      : [
                          ["month", "Monatlich"],
                          ["year", "Jährlich; Kontingent monatlich"],
                        ]
                    ).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name={f.key}
                    type={f.type ?? "text"}
                    required={
                      f.key !== "billing_email" && f.key !== "stripe_price_id"
                    }
                    defaultValue={String(
                      edit[f.key] ?? (f.key === "athletics_units" ? 0 : ""),
                    )}
                  />
                )}
              </label>
            ))}
            {error && <p className="error-message">{error}</p>}
            <button className="primary-button" type="submit">
              Speichern <Check size={17} />
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function RecordTable({
  rows,
  fields,
  empty,
}: {
  rows: RecordRow[];
  fields: string[];
  empty: string;
}) {
  return (
    <section className="panel table-scroll">
      <table className="training-table">
        <thead>
          <tr>
            {fields.map((f) => (
              <th key={f}>{f.replaceAll("_", " ").toUpperCase()}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.id ?? i)}>
              {fields.map((f) => (
                <td key={f}>
                  {typeof r[f] === "object"
                    ? JSON.stringify(r[f])
                    : String(r[f] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="empty-state">
          <FileText />
          <p>{empty}</p>
        </div>
      )}
    </section>
  );
}
function StripeImport({
  data,
  notify,
}: {
  data: PortalData;
  notify: (s: string) => void;
}) {
  const [customers, setCustomers] = useState<RecordRow[]>([]),
    [current, setCurrent] = useState<RecordRow | null>(null),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [activeQuery, setActiveQuery] = useState(""),
    [loaded, setLoaded] = useState(false),
    [nextCursor, setNextCursor] = useState<string | null>(null);
  async function loadCustomers(term: string, cursor?: string) {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (term) params.set("q", term);
      if (cursor) params.set("after", cursor);
      const result = await api(
        `admin/stripe-customers${params.size ? `?${params}` : ""}`,
        undefined,
        "GET",
      );
      setCustomers((previous) =>
        cursor
          ? [
              ...new Map(
                [...previous, ...result.rows].map((c) => [c.id, c]),
              ).values(),
            ]
          : result.rows,
      );
      setActiveQuery(term);
      setLoaded(true);
      setNextCursor(result.has_more ? result.next_cursor : null);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel account-panel">
        <div className="row-between">
          <div>
            <h2>Bestehende Stripe-Kunden</h2>
            <p>
              Eine E-Mail-Übereinstimmung ist ein Vorschlag. Bestätige jede
              Zuordnung manuell.
            </p>
          </div>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => {
              setQuery("");
              void loadCustomers("");
            }}
          >
            <RefreshCw size={17} />
            Kunden laden
          </button>
        </div>
        <form
          className="stripe-customer-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim().length >= 3) void loadCustomers(query.trim());
          }}
        >
          <label className="search-input">
            <Search size={18} />
            <input
              type="search"
              aria-label="Eltern nach Name oder E-Mail suchen"
              placeholder="Name oder E-Mail des Elternteils"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={120}
              disabled={busy}
            />
          </label>
          <button
            className="primary-button"
            disabled={busy || query.trim().length < 3}
          >
            Suchen
          </button>
        </form>
        <p>Suche im gesamten Stripe-Kundenbestand ab 3 Zeichen.</p>
        <p role="status" aria-live="polite">
          {busy
            ? "Kunden werden geladen …"
            : loaded
              ? activeQuery
                ? `${customers.length} Treffer geladen für „${activeQuery}“.`
                : `${customers.length} Kunden geladen.`
              : "Kunden laden oder direkt nach einem Elternteil suchen."}
        </p>
        {loaded && !busy && !customers.length && (
          <p>
            Keine Kunden gefunden. Prüfe den Namen oder suche nach der E-Mail.
            Ganz neue Stripe-Kunden erscheinen möglicherweise erst etwas später
            in der Suche; verwende dafür „Kunden laden“.
          </p>
        )}
        {data.demo && (
          <div className="info-note">
            <AlertCircle size={20} />
            <p>
              Für den Import muss zuerst ein Stripe-Testkonto konfiguriert
              werden. Die Demo verändert keine Stripe-Daten.
            </p>
          </div>
        )}
        {customers.map((c) => (
          <div className="account-row" key={String(c.id)}>
            <div>
              <b>{String(c.name ?? c.id)}</b>
              <p>
                {String(c.email ?? "Keine E-Mail")} · {String(c.id)}
              </p>
              <small>{JSON.stringify(c.subscriptions)}</small>
              <Badge tone={c.ambiguous ? "purple" : "neutral"}>
                {c.ambiguous
                  ? "Mehrdeutiger Treffer – prüfen"
                  : "Manuelle Zuordnung erforderlich"}
              </Badge>
            </div>
            <button className="secondary-button" onClick={() => setCurrent(c)}>
              Zuordnen
            </button>
          </div>
        ))}
        {nextCursor && (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void loadCustomers(activeQuery, nextCursor)}
          >
            Weitere Kunden laden
          </button>
        )}
      </section>
      {current && (
        <Modal
          title="Zuordnung manuell bestätigen"
          close={() => setCurrent(null)}
        >
          <form
            className="form-body"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await api("admin/stripe-link", {
                  customer_id: current.id,
                  subscription_id: f.get("subscription"),
                  item_id: f.get("item"),
                  parent_id: f.get("parent_id") || undefined,
                  parent_name: f.get("name"),
                  email: f.get("email"),
                  player_id: f.get("player"),
                });
                notify("Zuordnung gespeichert. Einladung wurde eingeplant.");
                setCurrent(null);
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <p>Stripe-Kunde: {String(current.id)}</p>
            <label>
              Bestehende Eltern-ID (optional)
              <input
                name="parent_id"
                placeholder="Leer lassen für neues Elternkonto"
              />
            </label>
            <label>
              Name des Elternteils
              <input
                required
                name="name"
                defaultValue={String(current.name ?? "")}
              />
            </label>
            <label>
              Bestätigte Kontakt-E-Mail
              <input
                name="email"
                type="email"
                required
                defaultValue={String(current.email ?? "")}
              />
            </label>
            <label>
              Stripe-Abonnement-ID
              <input name="subscription" required placeholder="sub_…" />
            </label>
            <label>
              Stripe-Abonnement-Item-ID
              <input name="item" required placeholder="si_…" />
            </label>
            <label>
              Kind
              <select name="player" required>
                {data.players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.first_name} {p.last_name}
                  </option>
                ))}
              </select>
            </label>
            <Link href="/admin/spieler">Kind zuerst neu anlegen</Link>
            <label className="checkbox-label">
              <input type="checkbox" required /> Ich habe Kunde, Kind und
              Elternkonto geprüft.
            </label>
            <button className="primary-button">
              Zuordnen & Einladung einplanen
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function InviteForm({
  data,
  notify,
}: {
  data: PortalData;
  notify: (s: string) => void;
}) {
  return (
    <form
      className="panel account-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          await api("admin/invite", { parent_id: f.get("parent_id") });
          notify("Einladung wurde als Versandauftrag angelegt.");
        } catch (e) {
          notify((e as Error).message);
        }
      }}
    >
      <h2>Eltern sicher einladen</h2>
      <p>
        Die Einladung nutzt die bestätigte Kontaktadresse und die bestehende
        Stripe-Zuordnung des Elternkontos.
      </p>
      <label>
        Eltern-ID
        <input
          required
          name="parent_id"
          placeholder="UUID des zugeordneten Elternkontos"
        />
      </label>
      <button className="primary-button">
        <Mail size={17} /> Einladung einplanen
      </button>
    </form>
  );
}
function Logs({
  data,
  notify,
}: {
  data: PortalData;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState("notification_jobs"),
    [rows, setRows] = useState<RecordRow[]>([]);
  useEffect(() => {
    if (!data.demo)
      api(`admin/${tab}`, undefined, "GET")
        .then((r) => setRows(r.rows))
        .catch((e) => notify(e.message));
    else setRows([]);
  }, [tab, data.demo]);
  const fields =
    tab === "audit_log"
      ? ["created_at", "actor_type", "action", "table_name", "record_id"]
      : tab === "report_snapshots"
        ? ["created_at", "player_id", "version"]
        : ["created_at", "kind", "status", "attempts", "last_error"];
  return (
    <>
      <div className="segmented log-tabs">
        {[
          ["notification_jobs", "E-Mail-Aufträge"],
          ["notification_deliveries", "Versandhistorie"],
          ["report_snapshots", "PDF-Berichte"],
          ["audit_log", "Audit-Log"],
          ["job_runs", "Job-Ausführungen"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "selected" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <RecordTable
        rows={rows}
        fields={fields}
        empty={
          data.demo
            ? "In der Demo werden keine echten Versand- oder Audit-Protokolle erzeugt."
            : "Keine Einträge vorhanden."
        }
      />
      {tab === "notification_jobs" &&
        rows
          .filter((r) => ["failed", "uncertain"].includes(String(r.status)))
          .map((r) => (
            <div className="account-row" key={String(r.id)}>
              <span>
                {String(r.kind)} · {String(r.status)} ·{" "}
                {String(r.last_error ?? "")}
              </span>
              <button
                className="secondary-button"
                onClick={async () => {
                  const reason = window.prompt(
                    "Vor Wiederholung Proton-Versandprotokoll prüfen. Bestätige, dass die Nachricht NICHT zugestellt wurde, und nenne den Prüfgrund:",
                  );
                  if (!reason) return;
                  try {
                    await api("admin/notification-retry", {
                      id: r.id,
                      checked_not_delivered: true,
                      reason,
                    });
                    notify("Auftrag zur erneuten Verarbeitung freigegeben.");
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                Nach Prüfung wiederholen
              </button>
            </div>
          ))}
      {tab === "report_snapshots" &&
        rows.map((r) => (
          <div className="account-row" key={String(r.id)}>
            <span>
              Bericht {String(r.id)} · Version {String(r.version)}
            </span>
            <a href={`/api/reports/${r.id}`} className="text-button">
              PDF öffnen
            </a>
            <button
              className="secondary-button"
              onClick={async () => {
                try {
                  await api("admin/report-resend", {
                    id: r.id,
                    request_id: crypto.randomUUID(),
                  });
                  notify("Neuversand eingeplant.");
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              Erneut senden
            </button>
            <button
              className="text-button"
              onClick={async () => {
                if (
                  !window.confirm(
                    "Neue unveränderliche Berichtsversion mit aktuellem Datenstand erzeugen?",
                  )
                )
                  return;
                try {
                  await api("admin/report-version", { period_id: r.period_id });
                  notify("Neue Version wird erzeugt.");
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              Neue Version
            </button>
          </div>
        ))}
    </>
  );
}
function ParentLinks({
  parents,
  data,
  notify,
}: {
  parents: RecordRow[];
  data: PortalData;
  notify: (text: string) => void;
}) {
  const [links, setLinks] = useState<RecordRow[]>([]);
  async function refresh() {
    if (data.demo) {
      setLinks(
        data.players.map((p) => ({
          id: `demo-${p.id}`,
          parent_id: "demo-parent",
          player_id: p.id,
        })),
      );
      return;
    }
    try {
      setLinks((await api("admin/parent_players", undefined, "GET")).rows);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, [data.demo]);
  return (
    <section className="panel account-panel" style={{ marginTop: 24 }}>
      <h2>Eltern und Kinder zuordnen</h2>
      <p>
        Eine Zuordnung gibt dem Elternkonto Zugriff auf die Termine und Berichte
        dieses Kindes. Mehrere Eltern sind möglich.
      </p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            input = {
              parent_id: String(f.get("parent")),
              player_id: String(f.get("child")),
            };
          try {
            if (data.demo)
              setLinks([
                ...links.filter(
                  (l) =>
                    l.parent_id !== input.parent_id ||
                    l.player_id !== input.player_id,
                ),
                { ...input, id: crypto.randomUUID() },
              ]);
            else {
              await api("admin/parent_players", input);
              await refresh();
            }
            notify("Zuordnung gespeichert.");
          } catch (e) {
            notify((e as Error).message);
          }
        }}
      >
        <label>
          Elternkonto
          <select name="parent" required>
            {parents.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {String(p.full_name)} · {String(p.contact_email)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kind
          <select name="child" required>
            {data.players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.first_name} {p.last_name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <input required type="checkbox" /> Zugriff bewusst freigeben
        </label>
        <button className="primary-button">Zuordnung bestätigen</button>
      </form>
      {links.map((l) => (
        <div className="account-row" key={String(l.id)}>
          <span>
            {String(
              parents.find((p) => p.id === l.parent_id)?.full_name ??
                l.parent_id,
            )}{" "}
            →{" "}
            {data.players.find((p) => p.id === l.player_id)?.first_name ??
              String(l.player_id)}
          </span>
          <button
            className="text-button"
            onClick={async () => {
              const reason = window.prompt(
                "Zugriff auf dieses Kind wirklich entziehen? Bitte Grund angeben:",
              );
              if (!reason || reason.length < 5) return;
              try {
                if (!data.demo)
                  await api("admin/parent-unlink", { id: l.id, reason });
                setLinks(links.filter((x) => x.id !== l.id));
                notify("Zuordnung aufgehoben; Änderung protokolliert.");
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            Zuordnung aufheben
          </button>
        </div>
      ))}
    </section>
  );
}
