"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { PlayerApiShare } from "./player-api-share";
import { api } from "./team";
import {
  filterCustomers,
  withStripeOrder,
  type StripeCustomerOrder,
  type CustomerSort,
  type RegistryCustomer,
} from "@/lib/stripe-customers";
import { formatDate } from "@/lib/domain";
import type { Player, PortalData } from "@/lib/types";
import { useUserActivity, UserActivityStatus } from "./user-activity";
type RecordRow = Record<string, unknown>;
function ParentInviteButton({
  parent,
  notify,
}: {
  parent: RecordRow;
  notify: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState<"pending" | "held" | null>(null);
  const registered = parent.portal_status === "registered";
  return (
    <button
      type="button"
      className={
        registered
          ? "text-button"
          : parent.portal_status === "invited"
            ? "secondary-button parent-invite-repeat"
            : "primary-button parent-invite-new"
      }
      disabled={busy || registered || requested !== null}
      title={
        registered
          ? "Dieses Elternkonto ist bereits angemeldet."
          : `Einladung an ${String(parent.contact_email)}`
      }
      onClick={async () => {
        setBusy(true);
        try {
          const result = await api("admin/invite", { parent_id: parent.id });
          setRequested(result.status === "pending" ? "pending" : "held");
          notify(
            result.status === "pending"
              ? `Einladung an ${String(parent.contact_email)} zum Versand eingeplant.`
              : "Einladung vorgemerkt. Der Versand bleibt gesperrt.",
          );
        } catch (error) {
          notify((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Mail size={16} />
      {busy
        ? "Wird angefordert …"
        : registered
          ? "Bereits angemeldet"
          : requested === "pending"
            ? "Einladung eingeplant"
            : requested === "held"
              ? "Einladung vorgemerkt"
              : parent.portal_status === "invited"
                ? "Nochmal einladen"
                : "Einladen"}
    </button>
  );
}
async function allAdminRows(table: string) {
  const rows: RecordRow[] = [];
  for (let offset = 0; ; offset += 100) {
    const result = await api(
      `admin/${table}?offset=${offset}`,
      undefined,
      "GET",
    );
    rows.push(...result.rows);
    if (result.rows.length < 100) return rows;
  }
}
type AssignmentFilter = "all" | "open" | "assigned";
function AssignmentFilters({
  value,
  change,
  counts,
}: {
  value: AssignmentFilter;
  change: (value: AssignmentFilter) => void;
  counts: Record<AssignmentFilter, number>;
}) {
  return (
    <div
      className="segmented assignment-filters"
      aria-label="Zuordnung filtern"
    >
      {(
        [
          ["all", "Alle"],
          ["open", "Noch nicht zugeordnet"],
          ["assigned", "Bereits zugeordnet"],
        ] as const
      ).map(([key, label]) => (
        <button
          type="button"
          key={key}
          className={value === key ? "selected" : ""}
          aria-pressed={value === key}
          onClick={() => change(key)}
        >
          {label} ({counts[key]})
        </button>
      ))}
    </div>
  );
}
function NewChild({
  close,
  saved,
}: {
  close: () => void;
  saved: (player: Player) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Kind anlegen" close={close}>
      <form
        className="form-body"
        onSubmit={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          const player = {
            first_name: String(f.get("first_name")),
            last_name: String(f.get("last_name")),
            team: String(f.get("team")),
            birth_year: f.get("birth_year")
              ? Number(f.get("birth_year"))
              : null,
          };
          try {
            const result = await api("admin/players", player);
            saved({ ...player, id: result.id });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {entities.spieler.fields.map((f) => (
          <label key={f.key}>
            {f.label}
            <input
              name={f.key}
              type={f.type ?? "text"}
              required={f.key !== "birth_year"}
            />
          </label>
        ))}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <button className="primary-button" disabled={busy}>
          Kind speichern
        </button>
      </form>
    </Modal>
  );
}
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
      { key: "birth_year", label: "Geburtsjahr (optional)", type: "number" },
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
  const router = useRouter();
  const [assignment, setAssignment] = useState<AssignmentFilter>("all");
  const slug = section.split("/")[1] ?? "",
    config = entities[slug];
  const [rows, setRows] = useState<RecordRow[]>([]),
    [search, setSearch] = useState(""),
    [edit, setEdit] = useState<RecordRow | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [reportTime, setReportTime] = useState("08:00");
  const activity = useUserActivity(
    ["eltern", "mitarbeiter"].includes(slug)
      ? rows
          .map((r) => String((slug === "eltern" ? r.auth_user_id : r.id) ?? ""))
          .filter(Boolean)
      : [],
  );
  const matchingRows = rows.filter((r) =>
    JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
  );
  const assignedCount = matchingRows.filter(
    (r) => (r.parent_players as unknown[] | undefined)?.length,
  ).length;
  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = ["eltern", "spieler"].includes(slug)
        ? { rows: await allAdminRows(config.table) }
        : await api(
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
        f.type === "number"
          ? f.key === "birth_year" && !String(form.get(f.key) ?? "").trim()
            ? null
            : Number(form.get(f.key))
          : String(form.get(f.key));
    if (edit?.id) record.id = edit.id;
    try {
      await api(`admin/${config.table}`, record);
      await load();
      router.refresh();
      notify("Datensatz gespeichert und protokolliert.");

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
              {
                "Rollen, Stripe-Zuordnungen und Systemkonfiguration sind ausschließlich für Admins freigegeben."
              }
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
          {["eltern", "spieler"].includes(slug) && (
            <AssignmentFilters
              value={assignment}
              change={setAssignment}
              counts={{
                all: matchingRows.length,
                open: matchingRows.length - assignedCount,
                assigned: assignedCount,
              }}
            />
          )}
          <section className="panel table-scroll">
            <table className="training-table">
              <thead>
                <tr>
                  {config.fields.map((f) => (
                    <th key={f.key}>
                      {slug === "eltern" && f.key === "billing_email"
                        ? "EINLADUNG"
                        : f.label.toUpperCase()}
                    </th>
                  ))}
                  {slug === "eltern" && <th>KONTOSTATUS</th>}
                  {["eltern", "mitarbeiter"].includes(slug) && (
                    <th className="user-activity-column">STATUS</th>
                  )}
                  {["eltern", "spieler"].includes(slug) && <th>ZUORDNUNG</th>}
                  {slug === "eltern" && <th>STRIPE-KUNDEN</th>}
                  <th>AKTION</th>
                </tr>
              </thead>
              <tbody>
                {matchingRows
                  .filter(
                    (r) =>
                      !["eltern", "spieler"].includes(slug) ||
                      assignment === "all" ||
                      Boolean(
                        (r.parent_players as unknown[] | undefined)?.length,
                      ) ===
                        (assignment === "assigned"),
                  )
                  .map((r) => (
                    <tr
                      key={String(r.id)}
                      className={
                        slug === "spieler" ? "player-profile-row" : undefined
                      }
                      onClick={
                        slug === "spieler"
                          ? (event) => {
                              if (
                                event.defaultPrevented ||
                                (event.target as HTMLElement).closest(
                                  "a, button, input, select, textarea, label, summary, [role='button']",
                                ) ||
                                window.getSelection()?.toString()
                              )
                                return;
                              const href = `/admin/spieler/${r.id}`;
                              if (event.metaKey || event.ctrlKey)
                                window.open(
                                  href,
                                  "_blank",
                                  "noopener,noreferrer",
                                );
                              else router.push(href);
                            }
                          : undefined
                      }
                    >
                      {config.fields.map((f) => (
                        <td key={f.key}>
                          {slug === "eltern" && f.key === "billing_email" ? (
                            <ParentInviteButton parent={r} notify={notify} />
                          ) : slug === "eltern" && f.key === "full_name" ? (
                            <Link
                              href={`/admin/elternprofile/${r.id}`}
                              className="text-button"
                            >
                              {String(r[f.key] ?? "Profil")}
                            </Link>
                          ) : slug === "spieler" &&
                            ["first_name", "last_name"].includes(f.key) ? (
                            <Link
                              href={`/admin/spieler/${r.id}`}
                              className="text-button"
                            >
                              {String(r[f.key] ?? "Spielerprofil")}
                            </Link>
                          ) : f.key === "generation" ? (
                            ({
                              legacy: "Bestand",
                              current: "Neu ab 01.09.2026",
                              special: "Sondertarif",
                            }[String(r[f.key])] ?? "—")
                          ) : f.key === "billing_interval" ? (
                            r[f.key] === "year" ? (
                              "Jährlich"
                            ) : (
                              "Monatlich"
                            )
                          ) : (
                            String(r[f.key] ?? "—")
                          )}
                        </td>
                      ))}
                      {slug === "eltern" && (
                        <td>
                          <span
                            className={`parent-status ${String(r.portal_status ?? "none")}`}
                          >
                            <i aria-hidden="true" />
                            {r.portal_status === "registered"
                              ? "Angemeldet"
                              : r.portal_status === "invited"
                                ? "Einladung erhalten"
                                : "Keine Einladung"}
                          </span>
                        </td>
                      )}
                      {["eltern", "mitarbeiter"].includes(slug) && (
                        <td className="user-activity-column">
                          <UserActivityStatus
                            lastSeen={
                              slug === "eltern" && !r.auth_user_id
                                ? null
                                : activity.seen[
                                    String(
                                      slug === "eltern" ? r.auth_user_id : r.id,
                                    )
                                  ]
                            }
                            now={activity.now}
                          />
                        </td>
                      )}
                      {["eltern", "spieler"].includes(slug) && (
                        <td>
                          <a
                            className={
                              (r.parent_players as unknown[] | undefined)
                                ?.length
                                ? "secondary-button assigned-button"
                                : "secondary-button"
                            }
                            href={`/admin/eltern?${slug === "eltern" ? "parent" : "player"}=${String(r.id)}#zuordnung`}
                          >
                            {(r.parent_players as unknown[] | undefined)?.length
                              ? "Zugeordnet"
                              : "Zuordnen"}
                          </a>
                        </td>
                      )}
                      {slug === "eltern" && (
                        <td>
                          {(
                            r.parent_stripe_customers as
                              { stripe_customer_id: string }[] | undefined
                          )?.map((c) => (
                            <div key={c.stripe_customer_id}>
                              {c.stripe_customer_id}
                            </div>
                          )) ?? "—"}
                        </td>
                      )}
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
        <ParentLinks
          parents={rows}
          data={data}
          notify={notify}
          changed={() => {
            void load();
            router.refresh();
          }}
        />
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
            <Badge tone="neutral">{"Serverkonfiguration"}</Badge>
          </div>
          <p className="muted">
            SMTP-Zugangsdaten, Stripe-Schlüssel und Cron-Secret werden
            ausschließlich auf dem Server hinterlegt.
          </p>
          <button className="primary-button">Einstellungen speichern</button>
        </form>
      )}
      {slug === "einstellungen" && data.role === "admin" && (
        <PlayerApiShare notify={notify} />
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
                      f.key !== "billing_email" &&
                      f.key !== "stripe_price_id" &&
                      f.key !== "birth_year"
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
  rowHref,
}: {
  rows: RecordRow[];
  fields: string[];
  empty: string;
  rowHref?: (row: RecordRow) => string;
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
              {fields.map((f, column) => (
                <td key={f} style={rowHref ? { padding: 0 } : undefined}>
                  {rowHref ? (
                    <a
                      className="log-detail-link"
                      href={rowHref(r)}
                      target="_blank"
                      rel="noopener noreferrer"
                      tabIndex={column === 0 ? 0 : -1}
                      title="Protokolldetail als Text öffnen"
                    >
                      {typeof r[f] === "object"
                        ? JSON.stringify(r[f])
                        : String(r[f] ?? "—")}
                    </a>
                  ) : (
                    <>
                      {typeof r[f] === "object"
                        ? JSON.stringify(r[f])
                        : String(r[f] ?? "—")}
                    </>
                  )}
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
  const router = useRouter();
  const [assignment, setAssignment] = useState<AssignmentFilter>("all");
  const [newChild, setNewChild] = useState(false);
  const [addedPlayers, setAddedPlayers] = useState<Player[]>([]);
  const [playerId, setPlayerId] = useState("");
  const players = [
    ...data.players,
    ...addedPlayers.filter(
      (p) => !data.players.some((item) => item.id === p.id),
    ),
  ];
  const [customers, setCustomers] = useState<RegistryCustomer[]>([]);
  const [current, setCurrent] = useState<RecordRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CustomerSort>("stripe");
  const [recent, setRecent] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [visible, setVisible] = useState({ open: 10, assigned: 10 });
  const [status, setStatus] = useState(
    "Kunden laden, um den vollständigen Bestand zu prüfen.",
  );
  useEffect(() => {
    setVisible({ open: 10, assigned: 10 });
  }, [query, sort, recent, activeOnly]);
  async function loadCustomers() {
    setBusy(true);
    try {
      let after: string | undefined;
      let count = 0;
      const cursors = new Set<string>();
      const stripeOrder: StripeCustomerOrder[] = [];
      do {
        const result = await api("admin/stripe-customers-sync", {
          ...(after ? { after } : {}),
        });
        if (
          !Array.isArray(result.customers) ||
          result.customers.length !== result.count
        )
          throw new Error(
            "Stripe-Reihenfolge unvollständig. Bitte erneut laden.",
          );
        stripeOrder.push(...result.customers);
        count += result.count;
        setStatus(`${count} Stripe-Kunden geprüft …`);
        after = result.next_cursor ?? undefined;
        if (after && cursors.has(after))
          throw new Error("Kundenliste unvollständig. Bitte erneut laden.");
        if (after) cursors.add(after);
      } while (after);
      const result = await api("admin/stripe-customers", undefined, "GET");
      setCustomers(withStripeOrder(result.rows, stripeOrder));
      setVisible({ open: 10, assigned: 10 });
      setStatus(
        `${result.rows.length} Kunden im System erfasst. Bestand vollständig geladen.`,
      );
    } catch (e) {
      setStatus(
        (e as Error).message ||
          "Aktualisierung unvollständig. Bitte erneut laden; bisherige Anzeige bleibt erhalten.",
      );
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function selectCustomer(customer: RegistryCustomer) {
    setBusy(true);
    setPlayerId("");
    try {
      setCurrent(
        await api(
          `admin/stripe-customer-detail?id=${encodeURIComponent(customer.id)}`,
          undefined,
          "GET",
        ),
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = filterCustomers(
    customers,
    query,
    sort,
    recent,
    Date.now(),
    activeOnly,
  );
  const open = filtered.filter((c) => !c.assigned);
  const assigned = filtered.filter((c) => c.assigned);
  function customerRows(rows: RegistryCustomer[], group: "open" | "assigned") {
    return (
      <>
        <p className="muted">
          {Math.min(visible[group], rows.length)} von {rows.length} Kunden
          angezeigt
        </p>
        {rows.slice(0, visible[group]).map((c) => (
          <div className="account-row" key={c.id}>
            <div>
              <b>{c.name || c.email || c.id}</b>
              <p>
                {c.email || "Keine E-Mail"} · {c.id}
              </p>
              <small>
                {c.stripe_created_at
                  ? `Bei Stripe erstellt am ${formatDate(c.stripe_created_at)}`
                  : "Nicht in der aktuellen Stripe-Liste"}
                <br />
                Im Portal erfasst am {formatDate(c.first_seen_at)}
              </small>
            </div>
            <button
              className={
                c.assigned
                  ? "secondary-button assigned-button"
                  : "secondary-button"
              }
              disabled={busy}
              onClick={() => void selectCustomer(c)}
            >
              {c.assigned ? "Zugeordnet" : "Zuordnen"}
            </button>
          </div>
        ))}
        {visible[group] < rows.length && (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              setVisible((v) => ({ ...v, [group]: v[group] + 10 }))
            }
          >
            10 weitere anzeigen
          </button>
        )}
      </>
    );
  }
  return (
    <>
      <section className="panel account-panel stripe-registry">
        <div className="row-between">
          <div>
            <h2>Stripe-Zuordnung</h2>
            <p>Neue Kunden prüfen und einem Elternkonto zuordnen.</p>
          </div>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void loadCustomers()}
          >
            <RefreshCw size={17} /> Kunden laden
          </button>
        </div>
        <div className="form-grid">
          <label>
            Kunden suchen
            <input
              type="search"
              aria-label="Eltern nach Name oder E-Mail suchen"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, E-Mail oder Kunden-ID"
            />
          </label>
          <fieldset className="stripe-sort-controls">
            <legend>Sortierung</legend>
            <button
              type="button"
              className="secondary-button"
              aria-pressed={sort === "stripe"}
              onClick={() => setSort("stripe")}
            >
              Stripe-Reihenfolge
            </button>
            <button
              type="button"
              className="secondary-button"
              aria-pressed={sort.startsWith("added")}
              onClick={() =>
                setSort(sort === "added-desc" ? "added-asc" : "added-desc")
              }
            >
              Im Portal hinzugefügt {sort === "added-asc" ? "↑" : "↓"}
            </button>
            <button
              type="button"
              className="secondary-button"
              aria-pressed={sort.startsWith("name")}
              onClick={() =>
                setSort(sort === "name-asc" ? "name-desc" : "name-asc")
              }
            >
              {sort === "name-desc" ? "Name Z–A" : "Name A–Z"}
            </button>
          </fieldset>
        </div>
        <div className="stripe-filter-controls">
          <button
            type="button"
            className="secondary-button"
            aria-pressed={activeOnly}
            onClick={() => setActiveOnly((value) => !value)}
          >
            Aktive Abos
          </button>
          <span className="muted">
            {activeOnly
              ? "Nur Kunden mit mindestens einem aktiven Stripe-Abo."
              : "Alle Kunden – auch ohne aktives Abo."}
          </span>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={recent}
            onChange={(e) => setRecent(e.target.checked)}
          />{" "}
          In den letzten 14 Tagen erstmals erfasst
        </label>
        <p className="muted">
          {sort === "stripe"
            ? "Wie in Stripe: neueste Stripe-Konten zuerst."
            : sort.startsWith("added")
              ? `Erstmals im Portal erfasst: ${sort === "added-desc" ? "neueste" : "älteste"} zuerst. Erneut klicken, um die Richtung zu wechseln.`
              : `Nach Name: ${sort === "name-asc" ? "A–Z" : "Z–A"}. Erneut klicken, um die Richtung zu wechseln.`}
        </p>
        <p role="status" aria-live="polite">
          {status}
        </p>
        <AssignmentFilters
          value={assignment}
          change={setAssignment}
          counts={{
            all: filtered.length,
            open: open.length,
            assigned: assigned.length,
          }}
        />
        {assignment !== "assigned" && (
          <>
            <h3>Noch nicht zugeordnet · {open.length}</h3>
            {customerRows(open, "open")}
          </>
        )}
        {assignment !== "open" && (
          <>
            <h3>Bereits zugeordnet · {assigned.length}</h3>
            {customerRows(assigned, "assigned")}
          </>
        )}
      </section>
      {current && (
        <Modal
          active={!newChild}
          title="Zuordnung manuell bestätigen"
          close={() => setCurrent(null)}
        >
          {!(current.subscriptions as unknown[])?.length ? (
            <section className="form-body">
              <p>Stripe-Kunde: {String(current.id)}</p>
              <h3>Kein Stripe-Abo vorhanden</h3>
              <p>
                Für Campbuchungen – auch mit 100 % Rabatt – werden keine Abo-
                oder Item-IDs benötigt. Bitte die Campbuchung dort prüfen und
                zuordnen.
              </p>
              {(
                current.camp_bookings as
                  | {
                      id: string;
                      camp_id: string;
                      status: string;
                      paid_amount: number | null;
                    }[]
                  | undefined
              )?.map((b) => (
                <p key={b.id}>
                  <Link href={`/camps/${b.camp_id}/pruefung`}>
                    Campbuchung {b.id} ·{" "}
                    {b.status === "review" ? "Zur Prüfung" : b.status}
                    {b.paid_amount === 0 ? " · 0 € Zahlbetrag" : ""}
                  </Link>
                </p>
              ))}
              <Link className="secondary-button" href="/camps">
                Zum Camp-Bereich
              </Link>
            </section>
          ) : (
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
                  notify(
                    "Zuordnung gespeichert. Einladung vorgemerkt, Versand gesperrt.",
                  );
                  setCustomers((rows) =>
                    rows.map((row) =>
                      row.id === current.id ? { ...row, assigned: true } : row,
                    ),
                  );
                  setCurrent(null);
                  router.refresh();
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              <p>Stripe-Kunde: {String(current.id)}</p>
              {(
                current.subscriptions as {
                  id: string;
                  status: string;
                  items: { id: string; product: string }[];
                }[]
              ).map((sub) => (
                <div className="stripe-subscription" key={sub.id}>
                  <b>{sub.status}</b> · {sub.id}
                  {sub.items.map((item) => (
                    <p key={item.id}>
                      {item.product}
                      <br />
                      <small>{item.id}</small>
                    </p>
                  ))}
                </div>
              ))}
              <p>
                Eine Namens- oder E-Mail-Übereinstimmung ist nur ein Vorschlag.
                Bitte die Zuordnung prüfen.
              </p>
              <label>
                Bestehende Eltern-ID (optional)
                <input
                  name="parent_id"
                  placeholder="Leer: passendes Konto verwenden oder neu anlegen"
                  defaultValue={String(
                    (current.family_matches as RecordRow[] | undefined)
                      ?.length === 1
                      ? (current.family_matches as RecordRow[])[0].id
                      : "",
                  )}
                />
              </label>
              <p>
                Gleicher Name und gleiche E-Mail verwenden dasselbe Elternkonto.
                Weitere Stripe-Kunden-IDs werden diesem Konto hinzugefügt.
              </p>
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
                <select
                  name="player"
                  required
                  value={playerId || ""}
                  onChange={(e) => setPlayerId(e.target.value)}
                >
                  <option value="" disabled>
                    Kind ausdrücklich auswählen
                  </option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.first_name} {p.last_name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() => setNewChild(true)}
              >
                Neues Kind anlegen
              </button>
              <label className="checkbox-label">
                <input type="checkbox" required /> Ich habe Kunde, Kind und
                Elternkonto geprüft.
              </label>
              <button className="primary-button">
                Zuordnen & Einladung vormerken
              </button>
            </form>
          )}
        </Modal>
      )}
      {newChild && (
        <NewChild
          close={() => setNewChild(false)}
          saved={(p) => {
            setAddedPlayers((rows) => [...rows, p]);
            setPlayerId(p.id);
            setNewChild(false);
            router.refresh();
          }}
        />
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
          const result = await api("admin/invite", {
            parent_id: f.get("parent_id"),
          });
          notify(
            result.status === "pending"
              ? "Einladung für den freigegebenen Empfänger zum Versand eingeplant."
              : "Einladung vorgemerkt. Der Versand bleibt gesperrt.",
          );
        } catch (e) {
          notify((e as Error).message);
        }
      }}
    >
      <h2>Eltern sicher einladen</h2>
      <p>
        Die Einladung nutzt die bestätigte Kontaktadresse und die bestehende
        Stripe-Zuordnung des Elternkontos. Der Versand ist nur für ausdrücklich
        freigegebene Empfänger möglich. Automatische Einladungen bleiben
        gesperrt.
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
        <Mail size={17} /> Einladung anfordern
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
    let active = true;
    api(`admin/${tab}`, undefined, "GET")
      .then((r) => {
        if (active) setRows(r.rows);
      })
      .catch((e) => {
        if (active) notify(e.message);
      });
    return () => {
      active = false;
    };
  }, [tab]);
  const fields =
    tab === "audit_log"
      ? ["created_at", "actor_type", "action", "table_name", "record_id"]
      : tab === "report_snapshots"
        ? ["created_at", "player_id", "version"]
        : tab === "notification_deliveries"
          ? ["created_at", "job_id", "attempt", "provider", "status", "error"]
          : tab === "job_runs"
            ? ["created_at", "status", "error"]
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
            onClick={() => {
              setRows([]);
              setTab(key);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="profile-muted">
        Zeile anklicken: Details mit IDs als Text in einem neuen Tab öffnen.
      </p>
      <RecordTable
        rowHref={(r) =>
          `/api/admin/log-detail?table=${encodeURIComponent(tab)}&id=${encodeURIComponent(String(r.id))}`
        }
        rows={rows.map((r) =>
          r.status === "held"
            ? {
                ...r,
                status:
                  r.kind === "stamp_card" && r.manual_email === true
                    ? r.last_error
                      ? "Manueller Versand fehlgeschlagen"
                      : "Manueller Versand noch nicht gestartet"
                    : "Zurückgehalten – Versand gesperrt",
              }
            : r,
        )}
        fields={fields}
        empty={"Keine Einträge vorhanden."}
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
  changed,
}: {
  changed: () => void;
  parents: RecordRow[];
  data: PortalData;
  notify: (text: string) => void;
}) {
  const [links, setLinks] = useState<RecordRow[]>([]);
  const [linksReady, setLinksReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parentId, setParentId] = useState("");
  const [childId, setChildId] = useState("");
  const [newChild, setNewChild] = useState(false);
  const [addedPlayers, setAddedPlayers] = useState<Player[]>([]);
  const players = [
    ...data.players,
    ...addedPlayers.filter(
      (p) => !data.players.some((item) => item.id === p.id),
    ),
  ];
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setParentId(params.get("parent") ?? "");
    setChildId(params.get("player") ?? "");
  }, []);
  const selectedParent = parentId || String(parents[0]?.id ?? "");
  const availablePlayers = linksReady
    ? players.filter((p) => !links.some((l) => l.player_id === p.id))
    : [];
  const selectedChild = availablePlayers.some((p) => p.id === childId)
    ? childId
    : "";
  async function refresh() {
    setLinksReady(false);
    try {
      setLinks(await allAdminRows("parent_players"));
      setLinksReady(true);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <section
      id="zuordnung"
      className="panel account-panel"
      style={{ marginTop: 24 }}
    >
      <h2>Eltern und Kinder zuordnen</h2>
      <p>
        Eine Zuordnung gibt dem Elternkonto Zugriff auf die Termine und Berichte
        dieses Kindes. Pro Kind ist ein Elternkonto möglich. Für einen Wechsel
        zuerst die bestehende Zuordnung aufheben.
      </p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!linksReady || saving || !selectedChild) return;
          setSaving(true);
          const f = new FormData(e.currentTarget),
            input = {
              parent_id: String(f.get("parent")),
              player_id: String(f.get("child")),
            };
          try {
            await api("admin/parent_players", input);
            await refresh();
            changed();
            notify("Zuordnung gespeichert.");
          } catch (e) {
            notify((e as Error).message);
            await refresh();
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          Elternkonto
          <select
            name="parent"
            required
            value={selectedParent}
            onChange={(e) => setParentId(e.target.value)}
          >
            {parents.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {String(p.full_name)} · {String(p.contact_email)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kind
          <select
            name="child"
            required
            disabled={!linksReady || saving || !availablePlayers.length}
            value={selectedChild}
            onChange={(e) => setChildId(e.target.value)}
          >
            <option value="">
              {!linksReady
                ? "Zuordnungen werden geladen …"
                : availablePlayers.length
                  ? "Bitte ein Kind auswählen"
                  : "Keine unzugeordneten Kinder verfügbar"}
            </option>
            {availablePlayers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.first_name} {p.last_name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <input required type="checkbox" /> Zugriff bewusst freigeben
        </label>
        <button
          type="button"
          className="text-button"
          onClick={() => setNewChild(true)}
        >
          Neues Kind anlegen
        </button>
        <button
          className="primary-button"
          disabled={!linksReady || saving || !selectedParent || !selectedChild}
        >
          {saving ? "Wird zugeordnet …" : "Zuordnen"}
        </button>
      </form>
      {newChild && (
        <NewChild
          close={() => setNewChild(false)}
          saved={(p) => {
            setAddedPlayers((rows) => [...rows, p]);
            setChildId(p.id);
            setNewChild(false);
            changed();
          }}
        />
      )}
      {links.map((l) => (
        <div className="account-row" key={String(l.id)}>
          <span>
            {String(
              parents.find((p) => p.id === l.parent_id)?.full_name ??
                l.parent_id,
            )}{" "}
            →{" "}
            {players.find((p) => p.id === l.player_id)?.first_name ??
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
                await api("admin/parent-unlink", { id: l.id, reason });
                setLinks(links.filter((x) => x.id !== l.id));
                changed();
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
