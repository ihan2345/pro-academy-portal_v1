"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useProfileListState } from "./profile-list-state";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Mail,
  MapPin,
  Phone,
  Search,
  UserRound,
  Users,
} from "lucide-react";
import { Modal, Badge } from "./portal";
import { MonthCalendar } from "./month-calendar";
import {
  familyStatus,
  childInitials,
  childCardTheme,
  type ParentProfile,
  type ProfileListRow,
  type ProfileUnit,
} from "@/lib/parent-profile";
import {
  durationLabel,
  formatDate,
  formatTime,
  STATUS_LABELS,
} from "@/lib/domain";
import { calendarDate } from "@/lib/calendar";
import type { ProfileFinances } from "@/lib/server/parent-profile-finances";

function money(amount: number, currency: string) {
  return currency.toLowerCase() === "eur"
    ? new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
      }).format(amount / 100)
    : `${amount.toLocaleString("de-DE")} ${currency.toUpperCase()} (kleinste Währungseinheit)`;
}
async function request(path: string, body?: unknown, signal?: AbortSignal) {
  const res = await fetch(`/api/parent-profiles/${path}`, {
    cache: "no-store",
    signal,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Anfrage fehlgeschlagen.");
  return data;
}
export function ProfileList({ base }: { base: string }) {
  const {
    search,
    setSearch,
    sort,
    setSort,
    includeInactive,
    setIncludeInactive,
    offset,
    setOffset,
  } = useProfileListState();
  const [rows, setRows] = useState<ProfileListRow[]>([]),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      request(
        `list?search=${encodeURIComponent(search)}&offset=${offset}&includeInactive=${includeInactive}&sort=${sort}`,
        undefined,
        abort.signal,
      )
        .then((d) => {
          setRows(d.rows);
          setMore(d.more);
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [search, offset, includeInactive, sort]);
  return (
    <div className="parent-profile">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ACADEMY · FAMILIEN</div>
          <h1>
            Elternprofile<span className="greeting-dot">.</span>
          </h1>
          <p>Kontakte, Kinder und ihre Entwicklung an einem Ort.</p>
        </div>
      </div>
      <label className="search-input profile-search">
        <Search size={18} />
        <input
          aria-label="Eltern nach Name oder E-Mail suchen"
          placeholder="Name oder E-Mail suchen"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      <div className="profile-filters">
        <label>
          Sortierung
          <select
            aria-label="Elternprofile sortieren"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setOffset(0);
            }}
          >
            <option value="name">A–Z</option>
            <option value="months">Platzierung (Gesamtmonate)</option>
            <option value="newest">Neu–Alt</option>
          </select>
        </label>
      </div>
      <label className="profile-inactive-filter">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => {
            setIncludeInactive(e.target.checked);
            setOffset(0);
          }}
        />
        Eltern ohne aktives Abo zusätzlich anzeigen
      </label>
      {error && (
        <p role="alert" className="profile-error">
          {error}
        </p>
      )}
      <div className="profile-list" aria-busy={loading}>
        {loading ? (
          <p role="status">Elternprofile werden geladen …</p>
        ) : !error && rows.length === 0 ? (
          <p>Keine passenden Elternprofile gefunden.</p>
        ) : (
          !error &&
          rows.map((r) => (
            <Link
              className="panel profile-list-row"
              href={`${base}/${r.id}`}
              key={r.id}
            >
              <span className="profile-list-icon">
                <UserRound size={22} />
              </span>
              <span>
                <strong>{r.name}</strong>
                <span className="profile-muted">{r.email}</span>
              </span>
              <span>
                {r.children} Kinder
                <span className="profile-muted">
                  {r.products.join(" · ") || "Kein aktuelles Abo"}
                </span>
              </span>
              <span className={`profile-tier ${familyStatus(r.months).tier}`}>
                {familyStatus(r.months).label}
                <small className="profile-muted">{r.months} Gesamtmonate</small>
              </span>
              {r.last_seen_at && (
                <small>Zuletzt aktiv {formatDate(r.last_seen_at)}</small>
              )}
              <ArrowRight size={18} />
            </Link>
          ))
        )}
      </div>
      <div className="profile-actions">
        <button
          className="secondary-button"
          disabled={!offset || loading}
          onClick={() => setOffset(Math.max(0, offset - 25))}
        >
          Zurück
        </button>
        <span>Seite {Math.floor(offset / 25) + 1}</span>
        <button
          className="secondary-button"
          disabled={!more || loading}
          onClick={() => setOffset(offset + 25)}
        >
          Weiter
        </button>
      </div>
    </div>
  );
}
function UnitRows({ units }: { units: ProfileUnit[] }) {
  return (
    <div className="profile-unit-list">
      {units.map((u) => (
        <article key={u.id} className="profile-unit">
          <div className="profile-unit-date">
            {u.day
              ? formatDate(`${u.day}T12:00:00Z`, {
                  day: "2-digit",
                  month: "short",
                })
              : "Undatiert"}
            <small>{u.starts_at ? formatTime(u.starts_at) : "Nachtrag"}</small>
          </div>
          <div>
            <strong>{u.title}</strong>
            <p>
              {u.child_name} · {u.event_type}
              {u.location ? ` · ${u.location}` : ""}
            </p>
          </div>
          <Badge tone={u.status.startsWith("attended") ? "green" : "neutral"}>
            {u.cancelled
              ? "Abgesagt"
              : u.status === "planned" &&
                  u.starts_at &&
                  u.starts_at < new Date().toISOString()
                ? "Bestätigung ausstehend"
                : STATUS_LABELS[u.status]}
          </Badge>
        </article>
      ))}
      {!units.length && (
        <p className="profile-muted">Keine Einheiten in dieser Auswahl.</p>
      )}
    </div>
  );
}
export function ProfileView({
  initial,
  base,
  full = false,
}: {
  initial: ParentProfile;
  base: string;
  full?: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial),
    [window, setWindow] = useState<"month" | "all">("month"),
    [selected, setSelected] = useState(""),
    [editing, setEditing] = useState(false),
    [unlinking, setUnlinking] = useState<string | null>(null),
    [editingChild, setEditingChild] = useState<string | null>(null),
    [stampChild, setStampChild] = useState(""),
    [archiving, setArchiving] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [finance, setFinance] = useState<ProfileFinances | null>(null),
    [financeBusy, setFinanceBusy] = useState(false),
    [financeError, setFinanceError] = useState(""),
    [financeAttempt, setFinanceAttempt] = useState(0),
    [financeWindow, setFinanceWindow] = useState<"month" | "all">("month");
  const [child, setChild] = useState(""),
    [period, setPeriod] = useState("all"),
    [state, setState] = useState("all"),
    [offset, setOffset] = useState(0),
    [units, setUnits] = useState(initial.units),
    [more, setMore] = useState(false),
    [unitsBusy, setUnitsBusy] = useState(false),
    [unitsError, setUnitsError] = useState("");
  const cards = useRef<HTMLDivElement>(null),
    status = familyStatus(data.months);
  useEffect(() => {
    if (data.role !== "admin" || full) return;
    const abort = new AbortController();
    setFinance(null);
    setFinanceError("");
    setFinanceBusy(true);
    const timer = setTimeout(
      async () => {
        try {
          const result = await request(`${data.id}/finances`, {}, abort.signal);
          if (!abort.signal.aborted) setFinance(result);
        } catch (e) {
          if (!abort.signal.aborted) setFinanceError((e as Error).message);
        } finally {
          if (!abort.signal.aborted) setFinanceBusy(false);
        }
      },
      financeAttempt ? 0 : 1500,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [data.id, data.role, full, financeAttempt]);
  useEffect(() => {
    setData(initial);
    setUnits(initial.units);
  }, [initial]);
  useEffect(() => {
    if (!full && !selected) {
      setUnits(initial.units);
      return;
    }
    const abort = new AbortController();
    setUnitsBusy(true);
    setUnitsError("");
    const params = new URLSearchParams({
      child,
      period,
      state,
      offset: String(full ? offset : 0),
      day: selected,
      limit: full ? "25" : "5",
    });
    request(`${initial.id}/units?${params}`, undefined, abort.signal)
      .then((d) => {
        setUnits(d.units);
        setMore(d.more);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setUnitsError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setUnitsBusy(false);
      });
    return () => abort.abort();
  }, [full, selected, child, period, state, offset, initial]);
  const canEdit = data.role === "admin" || data.role === "parent";
  const locked =
    data.role === "parent" &&
    !!data.next_edit_at &&
    Date.parse(data.next_edit_at) > Date.now();
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await request(`${data.id}/contact`, {
        phone: String(form.get("phone") ?? ""),
        city: String(form.get("city") ?? ""),
      });
      setData(await request(data.id));
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    if (!archiving) return;
    setBusy(true);
    setError("");
    try {
      await request(`${data.id}/archive`, { child_id: archiving });
      setData(await request(data.id));
      setArchiving(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeChild(action: "unlink" | "child", input: unknown) {
    setBusy(true);
    setError("");
    try {
      await request(`${data.id}/${action}`, input);
      setData(await request(data.id));
      setUnlinking(null);
      setEditingChild(null);
      setStampChild("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const editableChild = data.children.find((c) => c.id === editingChild);
  const stampChildren = data.children.filter((c) => !c.archived);
  const chosenStampChild =
    stampChildren.find((c) => c.id === stampChild)?.id ?? stampChildren[0]?.id;
  const filters = (
    <>
      <select
        aria-label="Kind filtern"
        value={child}
        onChange={(e) => {
          setChild(e.target.value);
          setOffset(0);
        }}
      >
        <option value="">Alle Kinder</option>
        {data.children.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Zeitraum filtern"
        value={period}
        onChange={(e) => {
          setPeriod(e.target.value);
          setOffset(0);
        }}
      >
        <option value="all">Gesamter Zeitraum</option>
        <option value="month">Aktueller Monat</option>
      </select>
      <select
        aria-label="Einheitenstatus filtern"
        value={state}
        onChange={(e) => {
          setState(e.target.value);
          setOffset(0);
        }}
      >
        <option value="all">Alle Einheiten</option>
        <option value="planned">Geplant</option>
        <option value="past">Vergangen</option>
      </select>
    </>
  );
  return (
    <div className="parent-profile">
      <nav className="profile-breadcrumb" aria-label="Profilnavigation">
        <Link href={data.role === "parent" ? "/" : base}>
          <ArrowLeft size={16} />
          {data.role === "parent" ? "Übersicht" : "Elternprofile"}
        </Link>
        <span>/</span>
        <Link href={data.role === "parent" ? "/profil" : `${base}/${data.id}`}>
          {data.name}
        </Link>
        {full && <span>/ Einheiten</span>}
      </nav>
      {full ? (
        <>
          <div className="page-heading">
            <div>
              <h1>
                Alle Einheiten<span className="greeting-dot">.</span>
              </h1>
              <p>Die Trainingshistorie deiner Auswahl.</p>
            </div>
          </div>
          <div className="profile-filters">{filters}</div>
        </>
      ) : (
        <>
          <section className="panel profile-hero">
            <div className={`profile-avatar-ring ${status.tier}`}>
              <span>
                <UserRound size={38} />
              </span>
            </div>
            <div className="profile-identity">
              <div className="eyebrow">DEINE ACADEMY-FAMILIE</div>
              <h1>{data.name}</h1>
              <div className="profile-contacts">
                <span>
                  <Mail size={15} />
                  {data.email}
                </span>
                <span>
                  <Phone size={15} />
                  {data.phone || "Telefon nicht hinterlegt"}
                </span>
                <span>
                  <MapPin size={15} />
                  {data.city || "Ort nicht hinterlegt"}
                </span>
                <span>
                  <Users size={15} />
                  {data.children.filter((c) => !c.archived).length} Kinder
                </span>
              </div>
            </div>
            {canEdit && (
              <div className="profile-edit">
                <button
                  className="secondary-button"
                  disabled={locked}
                  onClick={() => {
                    setError("");
                    setEditing(true);
                  }}
                >
                  Kontaktdaten bearbeiten
                </button>
                {locked && (
                  <small>
                    Erneut bearbeitbar ab{" "}
                    {formatDate(data.next_edit_at!, {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                )}
              </div>
            )}
          </section>
          <section className={`panel profile-status ${status.tier}`}>
            <div>
              <span className="eyebrow">FAMILIENSTATUS</span>
              <h2>{status.label}</h2>
              <p>
                {status.tier === "ultimate"
                  ? "Ultimativ Status erreicht"
                  : `Noch ${status.remaining} Monate bis ${status.next}`}
              </p>
            </div>
            <div className="profile-progress-area">
              <strong>
                {status.tier === "ultimate"
                  ? `${data.months} Abo-Monate`
                  : `${data.months} / ${status.target} Monate`}
              </strong>
              <div
                className="profile-progress"
                role="progressbar"
                aria-label="Familienstatus"
                aria-valuemin={0}
                aria-valuemax={status.target}
                aria-valuenow={Math.min(data.months, status.target)}
              >
                <span style={{ width: `${status.progress}%` }} />
              </div>
              <small>{data.history_note}</small>
            </div>
          </section>
          <div className="profile-section-heading">
            <div>
              <h2>Zugeordnete Kinder</h2>
              <p className="profile-muted">
                Training, Entwicklung und gemeinsame Zeit.
              </p>
            </div>
            <div className="segmented" aria-label="Trainingszeitraum">
              {(["month", "all"] as const).map((w) => (
                <button
                  key={w}
                  className={window === w ? "selected" : ""}
                  aria-pressed={window === w}
                  onClick={() => setWindow(w)}
                >
                  {w === "month" ? "Aktueller Monat" : "Gesamt"}
                </button>
              ))}
            </div>
            {data.children.length > 1 && (
              <div className="profile-arrows">
                <button
                  className="icon-button"
                  aria-label="Vorherige Kinderkarte"
                  onClick={() =>
                    cards.current?.scrollBy({
                      left: -340,
                      behavior: matchMedia("(prefers-reduced-motion: reduce)")
                        .matches
                        ? "instant"
                        : "smooth",
                    })
                  }
                >
                  <ChevronLeft />
                </button>
                <button
                  className="icon-button"
                  aria-label="Nächste Kinderkarte"
                  onClick={() =>
                    cards.current?.scrollBy({
                      left: 340,
                      behavior: matchMedia("(prefers-reduced-motion: reduce)")
                        .matches
                        ? "instant"
                        : "smooth",
                    })
                  }
                >
                  <ChevronRight />
                </button>
              </div>
            )}
          </div>
          {!data.backfills_available && (
            <p role="status" className="profile-error">
              Nachträge sind derzeit nicht verfügbar. Trainingswerte können
              unvollständig sein.
            </p>
          )}
          <div
            className="profile-children"
            ref={cards}
            tabIndex={0}
            aria-label="Kinderkarten"
          >
            {data.children.map((c) => (
              <article
                className={`panel profile-child premium-child ${childCardTheme(c.products)}`}
                key={c.id}
              >
                <div className="profile-child-head">
                  <span className="child-avatar">
                    {childInitials(c.first_name, c.last_name)}
                  </span>
                  <div>
                    <h3>{c.name}</h3>
                    <small>{c.age}</small>
                  </div>
                  {c.archived && <Badge>Archiviert</Badge>}
                </div>
                <p className="profile-product">
                  {c.products.join(" · ") || "Kein aktuelles Abo"}
                </p>
                <p className="profile-muted">
                  Mitglied seit {c.since ? formatDate(c.since) : "–"} ·{" "}
                  {c.months} Monate
                </p>
                <div className="profile-metrics">
                  <div>
                    <strong>{c.stats[window].count}</strong>
                    <span>Trainingseinheiten</span>
                  </div>
                  <div>
                    <strong>{durationLabel(c.stats[window].minutes)}</strong>
                    <span>Trainingszeit</span>
                  </div>
                  <div>
                    <strong>{c.camps ?? "–"}</strong>
                    <span>Besuchte Camps · gesamt</span>
                  </div>
                </div>
                {(data.role === "admin" ||
                  (data.role === "parent" && !c.archived)) && (
                  <div className="profile-child-actions">
                    <button
                      className="child-edit-button"
                      onClick={() => {
                        setError("");
                        setEditingChild(c.id);
                      }}
                    >
                      Angaben des Kindes bearbeiten
                    </button>
                    {data.role === "admin" && (
                      <div>
                        {!c.archived && (
                          <button
                            className="profile-archive"
                            onClick={() => {
                              setError("");
                              setArchiving(c.id);
                            }}
                          >
                            Kind archivieren
                          </button>
                        )}
                        <button
                          className="profile-archive"
                          onClick={() => {
                            setError("");
                            setUnlinking(c.id);
                          }}
                        >
                          Kind vom Elternteil lösen
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))}
            {!data.children.length && <p>Noch keine Kinder zugeordnet.</p>}
          </div>
          {!data.camps_available && (
            <p className="profile-muted">
              Camp-Teilnahmedaten sind derzeit nicht verfügbar.
            </p>
          )}
          {data.role === "admin" && (
            <section className="panel profile-finances">
              <div className="profile-section-heading">
                <div>
                  <h2>Finanzübersicht</h2>
                  <p className="profile-muted">
                    Erfolgreiche Stripe-Zahlungen abzüglich Erstattungen.
                  </p>
                </div>
                <button
                  className="secondary-button"
                  disabled={financeBusy}
                  onClick={() => setFinanceAttempt((n) => n + 1)}
                >
                  {financeBusy
                    ? "Wird geladen …"
                    : finance
                      ? "Aktualisieren"
                      : "Erneut versuchen"}
                </button>
              </div>
              {financeError && (
                <p role="alert" className="profile-error">
                  {financeError}
                </p>
              )}
              {finance && (
                <>
                  <div className="segmented">
                    {(["month", "all"] as const).map((w) => (
                      <button
                        key={w}
                        className={financeWindow === w ? "selected" : ""}
                        onClick={() => setFinanceWindow(w)}
                      >
                        {w === "month" ? "Aktueller Monat" : "Gesamt"}
                      </button>
                    ))}
                  </div>
                  {!finance.complete && (
                    <p className="profile-error">
                      Daten unvollständig – keine verlässlichen Gesamtsummen
                      verfügbar.
                    </p>
                  )}
                  {finance.complete &&
                    finance.currencies.map((c) => (
                      <div className="profile-money" key={c.currency}>
                        <div>
                          <span>Aboausgaben</span>
                          <strong>
                            {c[financeWindow].subscriptions === null
                              ? "Zuordnung offen"
                              : money(
                                  c[financeWindow].subscriptions!,
                                  c.currency,
                                )}
                          </strong>
                        </div>
                        <div>
                          <span>Gesamtausgaben</span>
                          <strong>
                            {money(c[financeWindow].total, c.currency)}
                          </strong>
                        </div>
                      </div>
                    ))}
                  {finance.complete && !finance.currencies.length && (
                    <p>Keine vereinnahmten Stripe-Zahlungen gefunden.</p>
                  )}
                  {finance.notes.map((n) => (
                    <p key={n} className="profile-muted">
                      {n}
                    </p>
                  ))}
                  <small>
                    Stand{" "}
                    {formatDate(finance.checked_at, {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · Erstattungen zählen im Monat der Erstattung.
                  </small>
                </>
              )}
            </section>
          )}
        </>
      )}
      <div className={full ? "panel profile-units" : "profile-calendar-layout"}>
        {!full && (
          <div>
            <MonthCalendar
              month={data.month}
              selected={selected}
              today={calendarDate()}
              counts={
                new Map(
                  Object.entries(data.calendar).map(([d, c]) => [
                    d,
                    c.attended + c.planned,
                  ]),
                )
              }
              markers={data.calendar}
              select={(d) => setSelected(selected === d ? "" : d)}
            />
            <p className="profile-calendar-legend">
              <span>● Teilgenommen</span>
              <span>● Geplant</span>
            </p>
          </div>
        )}
        <section className={full ? "" : "panel profile-units"}>
          <div className="profile-section-heading">
            <h2>
              Einheiten
              {selected ? ` · ${formatDate(`${selected}T12:00:00Z`)}` : ""}
            </h2>
            {selected && (
              <button
                className="secondary-button"
                onClick={() => setSelected("")}
              >
                Datum zurücksetzen
              </button>
            )}
          </div>
          {unitsError ? (
            <p role="alert" className="profile-error">
              {unitsError}
            </p>
          ) : unitsBusy ? (
            <p role="status">Einheiten werden geladen …</p>
          ) : (
            <UnitRows units={units} />
          )}
          <div className="profile-actions">
            {full ? (
              <>
                <button
                  className="secondary-button"
                  disabled={!offset || unitsBusy}
                  onClick={() => setOffset(Math.max(0, offset - 25))}
                >
                  Zurück
                </button>
                <span>Seite {Math.floor(offset / 25) + 1}</span>
                <button
                  className="secondary-button"
                  disabled={!more || unitsBusy}
                  onClick={() => setOffset(offset + 25)}
                >
                  Weiter
                </button>
              </>
            ) : (
              <Link
                className="secondary-button"
                href={`${data.role === "parent" ? "/profil" : `${base}/${data.id}`}/einheiten`}
              >
                Alle Einheiten <ArrowRight size={16} />
              </Link>
            )}
          </div>
        </section>
      </div>
      {!full && chosenStampChild && (
        <section className="panel profile-stamp-picker">
          <div>
            <span className="eyebrow">TRAININGSFORTSCHRITT</span>
            <h2>Stempelkarte anzeigen</h2>
          </div>
          <div className="ios-child-select">
            <select
              aria-label="Kind für Stempelkarte auswählen"
              value={chosenStampChild}
              onChange={(e) => setStampChild(e.target.value)}
            >
              {stampChildren.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <ChevronDown size={18} aria-hidden="true" />
          </div>
          <Link
            className="primary-button"
            href={`${data.role === "parent" ? "/stempelkarte" : data.role === "admin" ? "/admin/stempelkarten" : "/team/stempelkarten"}?child=${encodeURIComponent(chosenStampChild)}`}
          >
            Stempelkarte anzeigen <ArrowRight size={16} />
          </Link>
        </section>
      )}
      {editableChild && (
        <Modal
          title="Angaben des Kindes bearbeiten"
          close={() => {
            if (!busy) setEditingChild(null);
          }}
        >
          <form
            className="profile-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void changeChild("child", {
                child_id: editableChild.id,
                first_name: String(form.get("first_name")),
                last_name: String(form.get("last_name")),
                birth_year: form.get("birth_year")
                  ? Number(form.get("birth_year"))
                  : null,
                team: String(form.get("team")),
              });
            }}
          >
            <p className="profile-muted">
              Diese Angaben werden direkt im Kinderprofil gespeichert und gelten
              auch in den anderen Ansichten.
            </p>
            <label>
              Vorname
              <input
                name="first_name"
                required
                maxLength={100}
                defaultValue={editableChild.first_name}
              />
            </label>
            <label>
              Nachname
              <input
                name="last_name"
                required
                maxLength={100}
                defaultValue={editableChild.last_name}
              />
            </label>
            <label>
              Geburtsjahr
              <input
                name="birth_year"
                type="number"
                min={1990}
                max={2100}
                defaultValue={editableChild.birth_year ?? ""}
              />
            </label>
            <label>
              Altersklasse
              <input
                name="team"
                maxLength={40}
                defaultValue={editableChild.team}
              />
            </label>
            {error && (
              <p role="alert" className="profile-error">
                {error}
              </p>
            )}
            <button className="primary-button" disabled={busy}>
              {busy ? "Wird gespeichert …" : "Änderungen speichern"}
            </button>
          </form>
        </Modal>
      )}
      {unlinking && (
        <Modal
          title="Kind vom Elternteil lösen"
          close={() => {
            if (!busy) setUnlinking(null);
          }}
        >
          <p>
            Sind Sie sicher, dass Sie{" "}
            <strong>
              {data.children.find((c) => c.id === unlinking)?.name}
            </strong>{" "}
            vom Elternteil <strong>{data.name}</strong> lösen möchten?
          </p>
          <p>
            Dieser Elternteil verliert den Zugriff auf das Kind. Das
            Kinderprofil und seine Historie bleiben erhalten. Das Kind kann
            anschließend neu verknüpft werden. Abos und Buchungen werden nicht
            gekündigt.
          </p>
          {error && (
            <p role="alert" className="profile-error">
              {error}
            </p>
          )}
          <div className="profile-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setUnlinking(null)}
            >
              Abbrechen
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={() =>
                void changeChild("unlink", { child_id: unlinking })
              }
            >
              {busy ? "Wird gelöst …" : "Verknüpfung lösen"}
            </button>
          </div>
        </Modal>
      )}
      {editing && (
        <Modal
          title="Kontaktdaten bearbeiten"
          close={() => {
            if (!busy) setEditing(false);
          }}
        >
          <form onSubmit={save} className="profile-form">
            <p className="profile-muted">
              E-Mail: {data.email} · unveränderbar
            </p>
            <label>
              Telefonnummer
              <input
                name="phone"
                type="tel"
                maxLength={50}
                defaultValue={data.phone ?? ""}
              />
            </label>
            <label>
              Ort
              <input
                name="city"
                maxLength={120}
                defaultValue={data.city ?? ""}
              />
            </label>
            {data.role === "parent" && (
              <p>Änderungen sind einmal innerhalb von sieben Tagen möglich.</p>
            )}
            {error && (
              <p role="alert" className="profile-error">
                {error}
              </p>
            )}
            <button className="primary-button" disabled={busy}>
              {busy ? "Wird gespeichert …" : "Speichern"}
            </button>
          </form>
        </Modal>
      )}
      {archiving && (
        <Modal
          title="Kind archivieren"
          close={() => {
            if (!busy) setArchiving(null);
          }}
        >
          <p>
            <strong>
              {data.children.find((c) => c.id === archiving)?.name}
            </strong>{" "}
            wirklich archivieren?
          </p>
          <p>
            Das Kind wird aus aktiven Ansichten ausgeblendet. Abos, bestehende
            Termine und Campbuchungen werden dadurch nicht gekündigt oder
            storniert. Historie und Zuordnung bleiben erhalten.
          </p>
          {error && (
            <p role="alert" className="profile-error">
              {error}
            </p>
          )}
          <div className="profile-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setArchiving(null)}
            >
              Abbrechen
            </button>
            <button className="danger-button" disabled={busy} onClick={archive}>
              Archivieren
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
