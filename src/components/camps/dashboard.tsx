"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Plus, RefreshCw, Users } from "lucide-react";
import { Temporal } from "@js-temporal/polyfill";
import { type Camp, type Offer, maximumSeats, money } from "@/lib/camps/domain";
import { CampError, campApi, date } from "./shared";
import { StripeReview } from "./stripe-review";
type Booking = {
  id: string;
  camp_id: string;
  player_id: string;
  parent_data?: { name: string; email: string; phone: string };
  child_data: {
    first_name: string;
    last_name: string;
    birth_date: string;
    gender: string;
    clothing_size: string;
  };
  status: string;
  customer_group?: string;
  paid_amount: number;
  review_reason?: string;
  invitation_requested_at?: string;
};
type Report = {
  booking_id: string;
  content: string;
  visible_to_parent?: boolean;
  updated_at: string;
};
type Data = {
  role: string;
  local_stripe_review?: boolean;
  locations: { id: string; name: string; address: string | null }[];
  camps: (Camp & { occupied?: number })[];
  bookings: Booking[];
  offers: Offer[];
  plans: {
    id: string;
    name: string;
    generation: string;
    billing_interval: string;
    camp_benefit_percent: number | null;
  }[];
  reports: Report[];
  children: {
    id: string;
    first_name: string;
    last_name: string;
    percent: number;
  }[];
};
const statusLabel: Record<string, string> = {
  draft: "In Vorbereitung",
  open: "Anmeldung offen",
  closed: "Anmeldung geschlossen",
  archived: "Archiviert",
  paid: "Gebucht",
  review: "Klärung erforderlich",
  cancelled: "Storniert",
  refunded: "Erstattet",
};
function berlin(value: string) {
  return Temporal.PlainDateTime.from(value)
    .toZonedDateTime("Europe/Berlin", { disambiguation: "reject" })
    .toInstant()
    .toString();
}
function NewCamp({
  saved,
  locations,
}: {
  saved: () => void;
  locations: Data["locations"];
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [id] = useState(() => crypto.randomUUID()),
    [days, setDays] = useState([{ date: "", start: "09:00", end: "15:00" }]),
    [link, setLink] = useState("");
  return (
    <form
      className="camp-panel camp-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
          const f = new FormData(e.currentTarget),
            early = f.get("early_until") as string;
          const body = {
            id,
            title: f.get("title"),
            location_id: f.get("location_id"),
            description: f.get("description"),
            capacity: Number(f.get("capacity")),
            buffer_percent: Number(f.get("buffer")),
            min_age: Number(f.get("min_age")),
            max_age: Number(f.get("max_age")),
            status: f.get("status"),
            days: days.map((d, i) => ({
              starts_at: berlin(
                `${f.get("day-date-" + i)}T${f.get("day-start-" + i)}`,
              ),
              ends_at: berlin(
                `${f.get("day-date-" + i)}T${f.get("day-end-" + i)}`,
              ),
            })),
            early_bird_until: early ? berlin(early) : null,
            main_amount: f.get("amount")
              ? Math.round(Number(f.get("amount")) * 100)
              : undefined,
            early_amount:
              early && f.get("early_amount")
                ? Math.round(Number(f.get("early_amount")) * 100)
                : undefined,
          };
          const result = await campApi("save", body);
          setLink(result.url);
          saved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Neues Camp</h2>
      <p>
        Lege Termine, Plätze und Preise fest. Nach dem Speichern erhältst du den
        Buchungslink für dein Camp.
      </p>
      <div className="camp-grid">
        <label>
          Campname
          <input name="title" required />
        </label>
        <label>
          Ort / Adresse
          <select
            name="location_id"
            required
            defaultValue=""
            disabled={!locations.length}
          >
            <option value="" disabled>
              Standort auswählen
            </option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
                {location.address ? ` · ${location.address}` : ""}
              </option>
            ))}
          </select>
          {!locations.length && (
            <span>Es ist noch kein aktiver Standort hinterlegt.</span>
          )}
        </label>
        <label>
          Reguläre Plätze
          <input
            type="number"
            name="capacity"
            defaultValue="30"
            min="1"
            required
          />
        </label>
        <label>
          Zusätzlicher Puffer in %
          <input
            type="number"
            name="buffer"
            defaultValue="10"
            min="0"
            max="20"
            required
          />
        </label>
        <label>
          Mindestalter
          <input type="number" name="min_age" defaultValue="6" required />
        </label>
        <label>
          Höchstalter
          <input type="number" name="max_age" defaultValue="16" required />
        </label>
        <label>
          Normalpreis in €
          <input type="number" name="amount" min="0.50" step="0.01" />
        </label>
        <label>
          Frühbucherpreis in €
          <input type="number" name="early_amount" min="0.50" step="0.01" />
        </label>
        <label>
          Frühbucher bis
          <input type="datetime-local" name="early_until" />
        </label>
        <label>
          Anmeldestatus
          <select name="status" defaultValue="draft">
            <option value="draft">In Vorbereitung</option>
            <option value="open">Anmeldung offen</option>
          </select>
        </label>
      </div>
      <label>
        Beschreibung
        <textarea name="description" rows={3} />
      </label>
      <h3>Trainingstage · deutsche Ortszeit</h3>
      {days.map((d, i) => (
        <div className="camp-grid" key={i}>
          <label>
            Tag {i + 1}
            <input
              name={"day-date-" + i}
              type="date"
              required
              value={d.date}
              onInput={(e) =>
                setDays(
                  days.map((x, j) =>
                    j === i ? { ...x, date: e.currentTarget.value } : x,
                  ),
                )
              }
              onChange={(e) =>
                setDays(
                  days.map((x, j) =>
                    j === i ? { ...x, date: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            Beginn
            <input
              name={"day-start-" + i}
              type="time"
              required
              value={d.start}
              onChange={(e) =>
                setDays(
                  days.map((x, j) =>
                    j === i ? { ...x, start: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            Ende
            <input
              name={"day-end-" + i}
              type="time"
              required
              value={d.end}
              onChange={(e) =>
                setDays(
                  days.map((x, j) =>
                    j === i ? { ...x, end: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          {days.length > 1 && (
            <button
              type="button"
              className="text-button"
              onClick={() => setDays(days.filter((_, j) => j !== i))}
            >
              Tag entfernen
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="secondary-button"
        onClick={() =>
          setDays([...days, { date: "", start: "09:00", end: "15:00" }])
        }
      >
        Trainingstag hinzufügen
      </button>
      <CampError message={error} />
      <button className="primary-button" disabled={busy || !locations.length}>
        {busy ? "Camp wird eingerichtet …" : "Camp speichern"}
      </button>
      {link && (
        <div className="camp-success">
          <p>Camp gespeichert. Dein Formularlink:</p>
          <Link href={link}>{link}</Link>
          <button
            type="button"
            className="text-button"
            onClick={() => navigator.clipboard.writeText(link)}
          >
            Link kopieren
          </button>
        </div>
      )}
    </form>
  );
}
export function CampDashboard({
  loginHref = "/login",
  campId = "",
  view = "overview",
}: {
  loginHref?: string;
  campId?: string;
  view?: "overview" | "mitglieder" | "pruefung";
}) {
  const router = useRouter();
  const selected = campId;
  const [data, setData] = useState<Data | null>(null),
    [player, setPlayer] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [readiness, setReadiness] = useState<{
      checks: { name: string; status: string; detail: string }[];
    } | null>(null);
  async function load() {
    setError("");
    try {
      const d = await campApi("dashboard");
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!campId && data?.camps[0]) router.replace(`/camps/${data.camps[0].id}`);
  }, [campId, data, router]);
  async function action(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await campApi(path, body);
      setMessage(
        path === "reconcile"
          ? `${r.checked} Zahlungen geprüft.${r.errors.length ? " " + r.errors.join(" ") : ""}`
          : "Gespeichert.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const team = data?.role === "admin" || data?.role === "staff",
    camp = data?.camps.find((c) => c.id === selected),
    bookings = data?.bookings.filter((b) => b.camp_id === selected) ?? [],
    paid = bookings.filter((b) => b.status === "paid");
  return (
    <div className="camp-dashboard">
      <div className="page-heading">
        <div>
          <div className="camp-eyebrow">GEMEINSAM AUF DEN PLATZ</div>
          <h1>
            {camp?.title ?? "Camps"}
            <span className="greeting-dot">.</span>
          </h1>
          <p>
            {team
              ? "Planung, Buchungen und Berichte an einem Ort."
              : "Deine Camp-Termine, Buchungen und Vorteile."}
          </p>
        </div>
        {team && (
          <button
            className="primary-button"
            onClick={() => setCreating(!creating)}
          >
            <Plus size={17} />
            {creating ? "Formular schließen" : "Camp erstellen"}
          </button>
        )}
      </div>
      <CampError message={error} />
      {message && (
        <p role="status" className="camp-success">
          {message}
        </p>
      )}
      {creating && data && (
        <NewCamp locations={data.locations} saved={() => void load()} />
      )}
      {!data ? (
        <p role="status">
          {error ? (
            <Link href={loginHref}>Zum Kundenzugang</Link>
          ) : (
            "Camps werden geladen …"
          )}
        </p>
      ) : (
        <>
          {!data.camps.length && (
            <section className="camp-panel">
              <h2>Noch kein Camp angelegt</h2>
              <p>
                {team
                  ? "Lege dein erstes Camp mit Terminen, Preisen und Buchungslink an."
                  : "Hier erscheinen kommende Camps und deine Buchungen."}
              </p>
            </section>
          )}
          {!!data.camps.length && (
            <label className="camp-select">
              Camp auswählen
              <select
                value={selected}
                onChange={(e) => {
                  router.push(`/camps/${e.target.value}`);
                }}
              >
                {data.camps.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.title} ·{" "}
                    {new Date(c.days[0].starts_at) < new Date()
                      ? "Vergangen"
                      : statusLabel[c.status]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {camp && (
            <>
              <nav
                className="camp-actions camp-navigation"
                aria-label="Camp-Bereiche"
              >
                <Link
                  className="secondary-button"
                  href={`/camps/${camp.id}`}
                  aria-current={view === "overview" ? "page" : undefined}
                >
                  Übersicht
                </Link>
                {team && (
                  <Link
                    className="secondary-button"
                    href={`/camps/${camp.id}/mitglieder`}
                    aria-current={view === "mitglieder" ? "page" : undefined}
                  >
                    <Users size={17} aria-hidden="true" />
                    Mitglieder ({paid.length})
                  </Link>
                )}
                {data.role === "admin" && data.local_stripe_review && (
                  <Link
                    className="secondary-button"
                    href={`/camps/${camp.id}/pruefung`}
                    aria-current={view === "pruefung" ? "page" : undefined}
                  >
                    Kinder zur Prüfung / Angaben ergänzen
                  </Link>
                )}
              </nav>
              {view === "pruefung" &&
                (data.role === "admin" && data.local_stripe_review ? (
                  <StripeReview
                    campId={camp.id}
                    onImported={() => void load()}
                  />
                ) : (
                  <CampError message="Die Prüfung ist für diesen Zugang nicht verfügbar." />
                ))}
              {view === "mitglieder" && !team && (
                <CampError message="Die Mitgliederübersicht ist nur für das Academy-Team verfügbar." />
              )}
              {view === "overview" && (
                <>
                  <section className="camp-panel">
                    <div className="camp-actions">
                      <h2>{camp.title}</h2>
                      <span className="badge">{statusLabel[camp.status]}</span>
                    </div>
                    <p>{camp.location}</p>
                    <p>{camp.description}</p>
                    {camp.days.map((d, i) => (
                      <p key={i}>
                        Tag {i + 1}: {date(d.starts_at)} – {date(d.ends_at)}
                      </p>
                    ))}
                    {team ? (
                      <>
                        <div className="camp-metrics">
                          <div>
                            <b>
                              {camp.occupied ?? paid.length} /{" "}
                              {maximumSeats(camp)}
                            </b>
                            <span>Belegt / inkl. Puffer</span>
                          </div>
                          <div>
                            <b>
                              {Math.round(
                                ((camp.occupied ?? paid.length) /
                                  maximumSeats(camp)) *
                                  100,
                              )}{" "}
                              %
                            </b>
                            <span>Belegung</span>
                          </div>
                          {[
                            ["subscriber", "Aktives Abo"],
                            ["former", "Früheres Abo"],
                            ["new", "Ohne Abo / Neukunde"],
                          ].map(([g, label]) => (
                            <div key={g}>
                              <b>
                                {
                                  paid.filter((b) => b.customer_group === g)
                                    .length
                                }
                              </b>
                              <span>{label}</span>
                            </div>
                          ))}
                        </div>
                        <p className="camp-muted">
                          {camp.capacity} reguläre Plätze +{" "}
                          {maximumSeats(camp) - camp.capacity} zusätzliche
                          Plätze als Puffer. Ein Platz ist nach erfolgreicher
                          Zahlung gebucht.
                        </p>
                        <details className="camp-details">
                          <summary>Buchungslink & Verwaltung</summary>
                          <div className="camp-actions">
                            <Link
                              className="primary-button"
                              href={`/camp/buchung/${camp.id}`}
                            >
                              Buchungsformular öffnen
                            </Link>
                            <button
                              className="secondary-button"
                              onClick={async () => {
                                await navigator.clipboard.writeText(
                                  `${location.origin}/camp/buchung/${camp.id}`,
                                );
                                setMessage("Formularlink kopiert.");
                              }}
                            >
                              <Copy size={16} />
                              Link kopieren
                            </button>
                            <button
                              className="secondary-button"
                              disabled={busy}
                              onClick={() =>
                                action("reconcile", { id: camp.id })
                              }
                            >
                              <RefreshCw size={16} />
                              Zahlungen jetzt prüfen
                            </button>
                            <button
                              className="secondary-button"
                              disabled={busy}
                              onClick={() =>
                                action("status", {
                                  id: camp.id,
                                  status:
                                    camp.status === "open" ? "closed" : "open",
                                })
                              }
                            >
                              {camp.status === "open"
                                ? "Anmeldung schließen"
                                : "Anmeldung öffnen"}
                            </button>
                          </div>
                          <div className="camp-actions">
                            <button
                              className="secondary-button"
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                setError("");
                                try {
                                  setReadiness(
                                    await campApi(`readiness?id=${camp.id}`),
                                  );
                                } catch (e) {
                                  setError((e as Error).message);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              Release prüfen
                            </button>
                          </div>
                          {readiness && (
                            <section
                              aria-label="Release-Prüfung"
                              className="camp-readiness"
                            >
                              <h3>Release-Prüfung</h3>
                              <p>
                                Diese Prüfung liest die Konfiguration und
                                Zahlungsangebote. Sie veröffentlicht nichts.
                              </p>
                              {readiness.checks.map((check) => (
                                <div key={check.name} className="camp-booking">
                                  <strong>{check.name}</strong>{" "}
                                  <span className="badge">
                                    {check.status === "ok"
                                      ? "Geprüft"
                                      : check.status === "deferred"
                                        ? "Zurückgestellt"
                                        : "Offen"}
                                  </span>
                                  <p>{check.detail}</p>
                                </div>
                              ))}
                            </section>
                          )}
                          <p className="camp-muted">
                            Schließen sperrt das Academy-Formular. Stripe-Links
                            müssen separat deaktiviert werden.
                          </p>
                          {data.offers
                            .filter((o) => o.camp_id === camp.id)
                            .map((o) => (
                              <p key={o.id}>
                                {o.kind === "early"
                                  ? "Frühbucher"
                                  : "Normalpreis"}
                                : {money(o.amount)} ·{" "}
                                <a
                                  target="_blank"
                                  rel="noreferrer"
                                  href={`https://dashboard.stripe.com/${camp.payment_mode === "test" ? "test/" : ""}payment_links/${o.stripe_payment_link_id}`}
                                >
                                  Zahlungsangebot verwalten
                                </a>
                              </p>
                            ))}
                        </details>
                      </>
                    ) : (
                      camp.status === "open" && (
                        <Link
                          className="primary-button"
                          href={`/camp/buchung/${camp.id}`}
                        >
                          Für dieses Camp buchen
                        </Link>
                      )
                    )}
                  </section>
                  {!team && (
                    <section className="camp-panel">
                      <h2>Meine Vorteile</h2>
                      {data.children.map((c) => (
                        <div className="camp-actions" key={c.id}>
                          <b>
                            {c.first_name} {c.last_name}
                          </b>
                          {c.percent ? (
                            <button
                              className="primary-button"
                              onClick={async () => {
                                try {
                                  const d = await campApi(
                                    `discount?camp_id=${camp.id}&player_id=${c.id}`,
                                  );
                                  if (!d.code)
                                    throw new Error(
                                      "Für dieses Angebot ist kein Rabattcode hinterlegt.",
                                    );
                                  await navigator.clipboard.writeText(d.code);
                                  setMessage("Rabattcode kopiert.");
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              }}
                            >
                              <Copy size={16} />
                              Mein Rabatt: {c.percent} %
                            </button>
                          ) : (
                            <span>Kein aktiver Abo-Vorteil</span>
                          )}
                        </div>
                      ))}
                    </section>
                  )}
                </>
              )}
              {((team && view === "mitglieder") ||
                (!team && view === "overview")) && (
                <section className="camp-panel">
                  <h2>
                    {team
                      ? "Teilnehmende Kinder & Buchungen"
                      : "Meine Kinder & Berichte"}
                  </h2>
                  {!team && (
                    <label>
                      Kind auswählen
                      <select
                        value={player}
                        onChange={(e) => setPlayer(e.target.value)}
                      >
                        <option value="">Alle Kinder</option>
                        {data.children.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.first_name} {c.last_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {!bookings.length && (
                    <p>Noch keine Buchungen für dieses Camp.</p>
                  )}
                  {bookings
                    .filter((b) => !player || b.player_id === player)
                    .map((b) => {
                      const report = data.reports.find(
                        (r) => r.booking_id === b.id,
                      );
                      return (
                        <article className="camp-booking" key={b.id}>
                          <div className="camp-actions">
                            <h3>
                              {b.child_data.first_name} {b.child_data.last_name}
                            </h3>
                            <span className="badge">
                              {b.status === "draft"
                                ? "Zahlung ausstehend"
                                : statusLabel[b.status]}
                            </span>
                          </div>
                          {b.paid_amount != null && (
                            <p>{money(b.paid_amount)}</p>
                          )}
                          {team && (
                            <details className="camp-details">
                              <summary>Angaben & Camp-Bericht</summary>
                              <p>
                                {b.parent_data?.name} · {b.parent_data?.email} ·{" "}
                                {b.parent_data?.phone}
                              </p>
                              <p>
                                Geboren: {b.child_data.birth_date} ·{" "}
                                {b.child_data.gender} · Größe{" "}
                                {b.child_data.clothing_size}
                              </p>
                              {b.review_reason && (
                                <CampError message={b.review_reason} />
                              )}{" "}
                              {b.invitation_requested_at && (
                                <p>
                                  Portalzugang angefragt · Einladung ausstehend.
                                </p>
                              )}
                              {b.status === "paid" && (
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    const f = new FormData(e.currentTarget);
                                    void action("report", {
                                      booking_id: b.id,
                                      content: f.get("content"),
                                      visible_to_parent:
                                        f.get("visible") === "on",
                                    });
                                  }}
                                >
                                  <label>
                                    Camp-Bericht
                                    <textarea
                                      name="content"
                                      defaultValue={report?.content ?? ""}
                                      rows={3}
                                      required
                                    />
                                  </label>
                                  <label className="camp-check">
                                    <input
                                      name="visible"
                                      type="checkbox"
                                      defaultChecked={
                                        report?.visible_to_parent ?? false
                                      }
                                    />
                                    Im Elternportal sichtbar
                                  </label>
                                  <button
                                    className="secondary-button"
                                    disabled={busy}
                                  >
                                    Bericht speichern
                                  </button>
                                </form>
                              )}
                            </details>
                          )}
                          {!team &&
                            (report ? (
                              <div className="camp-report">
                                {report.content}
                              </div>
                            ) : (
                              <p>
                                {Date.parse(camp.days[0].starts_at) > Date.now()
                                  ? "Dein Camp steht bevor. Den Ablauf findest du oben."
                                  : "Der Camp-Bericht ist noch nicht verfügbar."}
                              </p>
                            ))}
                        </article>
                      );
                    })}
                </section>
              )}
            </>
          )}
          {campId && !camp && (
            <CampError message="Dieses Camp ist nicht verfügbar." />
          )}
          {data.role === "admin" && view === "overview" && (
            <details className="camp-panel camp-details">
              <summary>Camp-Vorteile der Abo-Tarife</summary>
              <p>
                Lege fest, welchen Camp-Rabatt Kinder mit einem aktiven Abo
                erhalten.
              </p>
              {data.plans.map((p) => (
                <label className="camp-plan" key={p.id}>
                  <span>
                    {p.name} ·{" "}
                    {{
                      legacy: "Bestandstarif",
                      current: "Aktueller Tarif",
                      special: "Sondertarif",
                    }[p.generation] ?? p.generation}{" "}
                    · {p.billing_interval === "year" ? "Jahr" : "Monat"}
                  </span>
                  <select
                    disabled={busy}
                    value={p.camp_benefit_percent ?? ""}
                    onChange={(e) =>
                      action("benefit", {
                        id: p.id,
                        percent: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  >
                    <option value="">Kein Vorteil</option>
                    {[10, 15, 20].map((n) => (
                      <option key={n} value={n}>
                        {n} %
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </details>
          )}
        </>
      )}
    </div>
  );
}
