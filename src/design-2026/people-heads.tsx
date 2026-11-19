"use client";
// Design 2026: Seitenköpfe für Spielerprofile und Elternprofile im Stil der
// Zentrale. Die Liste darunter lädt seitenweise; die Kennzahlen hier holen
// deshalb über dieselben, rein lesenden Endpunkte alle Treffer des aktuellen
// Filters, damit Summen, Durchschnitte und Top 10 über alle Familien stimmen.
import { useEffect, useState } from "react";
import {
  Archive,
  CalendarRange,
  Clock3,
  Radio,
  Crown,
  ShieldCheck,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import type { PlayerProfilePage } from "@/lib/player-profiles";
import type { ProfileListRow } from "@/lib/parent-profile";
import { familyStatus } from "@/lib/parent-profile";
import { activityStatus, ONLINE_WINDOW } from "@/lib/user-activity";
import type { ArchivePage, ArchivePlayer } from "@/lib/player-archive";
import { PageHead, SheetRow } from "./page-head";
import { PlayerArchive } from "./player-archive";

/** Grün: gerade aktiv im Portal. Orange: in den letzten 30 Minuten da. */
const IDLE_WINDOW = 30 * 60000;
function presence(at: string | null | undefined, now: number) {
  const t = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return "off" as const;
  const age = now - t;
  return age < ONLINE_WINDOW ? "live" : age < IDLE_WINDOW ? "idle" : "off";
}
function Led({ state }: { state: "live" | "idle" | "off" }) {
  return (
    <i
      className={`d26-led is-${state}`}
      aria-label={
        state === "live"
          ? "Gerade online"
          : state === "idle"
            ? "Vor Kurzem online"
            : "Offline"
      }
    />
  );
}

/** Lädt alle Seiten einer Liste (im Tab 5 Minuten gemerkt). */
export function useEverything<T extends { id: string }>(
  key: string,
  load: (signal: AbortSignal) => Promise<T[]>,
) {
  const [state, setState] = useState<{
    key: string;
    rows: T[] | null;
    failed: boolean;
  }>({ key: "", rows: null, failed: false });
  useEffect(() => {
    const store = `d26-all:${key}`;
    try {
      const hit = JSON.parse(sessionStorage.getItem(store) ?? "null");
      if (hit && Date.now() - hit.t < 5 * 60000) {
        setState({ key, rows: hit.rows, failed: false });
        return;
      }
    } catch {
      /* Kein Zwischenspeicher. */
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      load(abort.signal)
        .then((rows) => {
          const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
          try {
            sessionStorage.setItem(
              store,
              JSON.stringify({ t: Date.now(), rows: unique }),
            );
          } catch {
            /* Egal. */
          }
          setState({ key, rows: unique, failed: false });
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setState({ key, rows: null, failed: true });
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { key, rows: null, failed: false };
}
export async function json(url: string, signal: AbortSignal) {
  const r = await fetch(url, { signal, cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
const pending = "…";

const hours = (m: number) =>
  new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(m / 60);

export function PlayerDirectoryHead({
  rows: loaded,
  total,
  base,
  search = "",
  revision = 0,
}: {
  rows: PlayerProfilePage["rows"];
  total: number;
  base: string;
  search?: string;
  revision?: number;
}) {
  const all = useEverything<PlayerProfilePage["rows"][number]>(
    `players:${search}:${revision}`,
    async (signal) => {
      const out: PlayerProfilePage["rows"] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 60; page++) {
        const params = new URLSearchParams({
          sort: "name",
          search,
          limit: "100",
          ...(cursor ? { cursor } : {}),
        });
        const d = (await json(
          `/api/player-profiles?${params}`,
          signal,
        )) as PlayerProfilePage;
        out.push(...d.rows);
        cursor = d.next;
        if (!cursor) return out;
      }
      throw new Error("zu viele Seiten");
    },
  );
  const archive = useEverything<ArchivePlayer>(
    `archive:${revision}`,
    async (signal) =>
      ((await json("/api/player-archive", signal)) as ArchivePage).rows,
  );
  const rows = all.rows;
  const ready = !!rows;
  const minutes = rows?.reduce((s, r) => s + r.stats.all.minutes, 0) ?? 0;
  const avgMonths = rows?.length
    ? Math.round(rows.reduce((s, r) => s + r.months, 0) / rows.length)
    : 0;
  const month = rows?.reduce((s, r) => s + r.stats.month.count, 0) ?? 0;
  const camps = rows?.reduce((s, r) => s + (r.camps ?? 0), 0) ?? 0;
  const top = (key: (r: PlayerProfilePage["rows"][number]) => number) =>
    [...(rows ?? [])]
      .filter((r) => key(r) > 0)
      .sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name, "de"))
      .slice(0, 10);
  const list = (
    items: PlayerProfilePage["rows"],
    meta: (r: PlayerProfilePage["rows"][number]) => string,
    pill: (r: PlayerProfilePage["rows"][number]) => string,
    empty = "Niemand in dieser Auswahl.",
  ) => (
    <div className="d26-mini-list">
      {items.map((r) => (
        <SheetRow
          key={r.id}
          title={r.name}
          meta={meta(r)}
          pill={pill(r)}
          href={`${base}/spieler/${r.id}`}
        />
      ))}
      {!items.length && (
        <p className="d26-empty">
          {ready
            ? empty
            : all.failed
              ? "Konnte nicht geladen werden."
              : "Wird geladen …"}
        </p>
      )}
    </div>
  );
  const count = rows?.length ?? total;
  return (
    <PageHead
      title="Spielerprofile"
      greeting={
        !count && !loaded.length
          ? "Aktive Kinder mit Abo und ihre Entwicklung auf einen Blick."
          : ready
            ? `${count} aktive Spieler mit Abo, zusammen ${month === 1 ? "1 Einheit" : `${month} Einheiten`} in diesem Monat.`
            : all.failed
              ? `${total} aktive Spieler mit Abo. Die Kennzahlen konnten gerade nicht vollständig geladen werden.`
              : `${total} aktive Spieler mit Abo. Kennzahlen werden über alle Spieler berechnet …`
      }
      kpis={[
        {
          icon: Archive,
          value: archive.rows ? archive.rows.length : pending,
          label: "Alle Spieler",
          tip: "Archiv: alle jemals erfassten Spieler, unabhängig vom Status",
          sheet: {
            title: "Alle Spieler",
            eyebrow: archive.rows
              ? `Archiv · ${archive.rows.length} erfasst`
              : "Archiv",
            body: (
              <PlayerArchive
                rows={archive.rows}
                failed={archive.failed}
                base={base}
                search={search}
              />
            ),
          },
        },
        {
          icon: Users,
          value: count,
          label: "Abo-Spieler",
          sheet: {
            title: "Abo-Spieler",
            eyebrow: ready ? `${count} Spieler` : undefined,
            body: list(
              [...(rows ?? [])].sort((a, b) =>
                a.name.localeCompare(b.name, "de"),
              ),
              (r) => `${r.age}${r.team ? ` · ${r.team}` : ""}`,
              (r) => r.products[0] ?? "Abo",
            ),
          },
        },
        {
          icon: Clock3,
          value: ready ? `${hours(minutes)} Std.` : pending,
          label: "Trainingszeit gesamt",
          tip: "Summe über alle Spieler dieser Auswahl",
          sheet: {
            title: "Meiste Trainingsstunden",
            eyebrow: "Top 10",
            body: list(
              top((r) => r.stats.all.minutes),
              (r) => `${r.stats.all.count} Einheiten`,
              (r) => `${hours(r.stats.all.minutes)} Std.`,
            ),
          },
        },
        {
          icon: Crown,
          value: ready ? avgMonths : pending,
          label: "Ø Monate dabei",
          tip: "Durchschnitt über alle Spieler dieser Auswahl",
          sheet: {
            title: "Längste Treue",
            eyebrow: "Top 10",
            body: list(
              top((r) => r.months),
              (r) => familyStatus(r.months).label,
              (r) => `${r.months} ${r.months === 1 ? "Monat" : "Monate"}`,
            ),
          },
        },
        {
          icon: Trophy,
          value: ready ? camps : pending,
          label: "Campbesuche",
          sheet: {
            title: "Camp-Fans",
            eyebrow: "Top 10",
            body: list(
              top((r) => r.camps ?? 0),
              (r) =>
                r.parents.map((p) => p.name).join(", ") || "Ohne Elternprofil",
              (r) => `${r.camps} ${r.camps === 1 ? "Camp" : "Camps"}`,
              "Noch keine Campbesuche.",
            ),
          },
        },
      ]}
    />
  );
}

export function ParentListHead({
  rows: loaded,
  total,
  loading,
  base,
  search = "",
  includeInactive = false,
  campOnly = false,
}: {
  rows: ProfileListRow[];
  total: number | null;
  loading: boolean;
  base: string;
  search?: string;
  includeInactive?: boolean;
  campOnly?: boolean;
}) {
  const all = useEverything<ProfileListRow>(
    `parents:${search}:${includeInactive}:${campOnly}`,
    async (signal) => {
      const out: ProfileListRow[] = [];
      for (let offset = 0; offset < 5000; offset += 100) {
        const d = await json(
          `/api/parent-profiles/list?search=${encodeURIComponent(search)}&offset=${offset}&includeInactive=${includeInactive}&sort=name&campOnly=${campOnly}&limit=100`,
          signal,
        );
        out.push(...(d.rows as ProfileListRow[]));
        if (!d.more) return out;
      }
      throw new Error("zu viele Seiten");
    },
  );
  const rows = all.rows;
  const ready = !!rows;
  const families = rows?.length ?? total ?? loaded.length;
  const kids = rows?.reduce((s, r) => s + r.children, 0) ?? 0;
  const active = rows?.filter((r) => r.portal_access?.activated) ?? [];
  const inactive = rows?.filter((r) => !r.portal_access?.activated) ?? [];
  const loyal = [...(rows ?? [])]
    .filter((r) => r.months > 0)
    .sort((a, b) => b.months - a.months || a.name.localeCompare(b.name, "de"))
    .slice(0, 10);
  const avg = rows?.length
    ? Math.round(rows.reduce((s, r) => s + r.months, 0) / rows.length)
    : 0;
  const now = Date.now();
  const seen = (r: ProfileListRow) =>
    r.portal_access?.last_seen_at ?? r.last_seen_at ?? null;
  const recent = (rows ?? [])
    .filter((r) => seen(r))
    .sort((a, b) => seen(b)!.localeCompare(seen(a)!))
    .slice(0, 10);
  const onlineNow = (rows ?? []).filter(
    (r) => presence(seen(r), now) !== "off",
  ).length;
  const list = (
    items: ProfileListRow[],
    pill: (r: ProfileListRow) => string,
  ) => (
    <div className="d26-mini-list">
      {items.map((r) => (
        <SheetRow
          key={r.id}
          title={r.name}
          meta={`${r.children} ${r.children === 1 ? "Kind" : "Kinder"} · ${r.products.join(", ") || "Kein Abo"}`}
          pill={pill(r)}
          href={`${base}/${r.id}`}
        />
      ))}
      {!items.length && (
        <p className="d26-empty">
          {ready
            ? "Niemand in dieser Auswahl."
            : all.failed
              ? "Konnte nicht geladen werden."
              : "Wird geladen …"}
        </p>
      )}
    </div>
  );
  return (
    <PageHead
      title="Elternprofile"
      greeting={
        loading && !loaded.length && !ready
          ? "Elternprofile werden geladen …"
          : ready
            ? `${families} Familien in dieser Auswahl, ${active.length} davon mit aktivem Portalzugang${inactive.length ? ` und ${inactive.length} noch ohne` : ""}.`
            : all.failed
              ? `${families} Familien in dieser Auswahl. Die Kennzahlen konnten gerade nicht vollständig geladen werden.`
              : `${families} Familien in dieser Auswahl. Kennzahlen werden über alle Familien berechnet …`
      }
      kpis={[
        {
          icon: Users,
          value: families,
          label: "Familien",
          sheet: {
            title: "Alle Familien",
            eyebrow: ready ? `${families} Familien` : undefined,
            body: list(rows ?? [], (r) => familyStatus(r.months).label),
          },
        },
        {
          icon: UserRound,
          value: ready ? kids : pending,
          label: "Kinder",
          tip: "Aktive Kinder aller Familien dieser Auswahl",
        },
        {
          icon: ShieldCheck,
          value: ready ? active.length : pending,
          label: "Im Portal aktiv",
          alert: inactive.length > 0,
          tip: ready
            ? inactive.length
              ? `${inactive.length} von ${families} noch nicht aktiviert`
              : "Alle aktiviert"
            : undefined,
          sheet: {
            title: "Portalzugang",
            eyebrow: ready ? `${families} Familien` : undefined,
            body: (
              <PortalSwitch
                active={list(active, (r) =>
                  seen(r) ? activityStatus(seen(r), now).label : "Aktiviert",
                )}
                inactive={list(inactive, () => "Nicht aktiviert")}
                counts={[active.length, inactive.length]}
              />
            ),
          },
        },
        ...(/(^|\/)admin\//.test(base)
          ? [
              {
                icon: Radio,
                value: ready ? onlineNow : pending,
                label: "Zuletzt online",
                tip: "Grün: gerade im Portal. Orange: in den letzten 30 Minuten.",
                sheet: {
                  title: "Zuletzt online",
                  eyebrow: "Letzte 10 Eltern",
                  body: (
                    <div className="d26-mini-list">
                      {recent.map((r) => (
                        <SheetRow
                          key={r.id}
                          title={
                            <>
                              <Led state={presence(seen(r), now)} />
                              {r.name}
                            </>
                          }
                          meta={`${r.children} ${r.children === 1 ? "Kind" : "Kinder"} · ${r.products.join(", ") || "Kein Abo"}`}
                          pill={activityStatus(seen(r), now).label}
                          href={`${base}/${r.id}`}
                        />
                      ))}
                      {!recent.length && (
                        <p className="d26-empty">
                          {ready
                            ? "Noch keine Anmeldung erfasst."
                            : "Wird geladen …"}
                        </p>
                      )}
                    </div>
                  ),
                },
              },
            ]
          : []),
        {
          icon: CalendarRange,
          value: ready ? avg : pending,
          label: "Ø Statusmonate",
          tip: "Durchschnitt über alle Familien dieser Auswahl",
          sheet: {
            title: "Treueste Familien",
            eyebrow: "Top 10",
            body: list(
              loyal,
              (r) => `${r.months} ${r.months === 1 ? "Monat" : "Monate"}`,
            ),
          },
        },
      ]}
    />
  );
}

function PortalSwitch({
  active,
  inactive,
  counts,
}: {
  active: React.ReactNode;
  inactive: React.ReactNode;
  counts: [number, number];
}) {
  const [show, setShow] = useState<"on" | "off">("on");
  return (
    <>
      <div className="d26-chips d26-sheet-switch" aria-label="Portalstatus">
        <button
          type="button"
          className={`d26-chip ${show === "on" ? "is-active" : ""}`}
          aria-pressed={show === "on"}
          onClick={() => setShow("on")}
        >
          Aktiv · {counts[0]}
        </button>
        <button
          type="button"
          className={`d26-chip ${show === "off" ? "is-active" : ""}`}
          aria-pressed={show === "off"}
          onClick={() => setShow("off")}
        >
          Noch nicht aktiv · {counts[1]}
        </button>
      </div>
      {show === "on" ? active : inactive}
    </>
  );
}

export function ParentListFilters({
  campOnly,
  sort,
  includeInactive,
  revenue,
  set,
}: {
  campOnly: boolean;
  sort: string;
  includeInactive: boolean;
  revenue: boolean;
  set: (patch: {
    campOnly?: boolean;
    sort?: string;
    includeInactive?: boolean;
  }) => void;
}) {
  const sorts: [string, string][] = [
    ["name", "A–Z"],
    ["months", "Treue"],
    ...(revenue ? ([["revenue", "Umsatz"]] as [string, string][]) : []),
    ["newest", "Neueste"],
  ];
  return (
    <div className="d26-shop-filters">
      <div className="d26-chips" aria-label="Familien">
        <small>Familien</small>
        <button
          type="button"
          className={`d26-chip ${!campOnly ? "is-active" : ""}`}
          onClick={() => set({ campOnly: false })}
        >
          Alle
        </button>
        <button
          type="button"
          className={`d26-chip ${campOnly ? "is-active" : ""}`}
          onClick={() => set({ campOnly: true })}
        >
          Campfamilien
        </button>
        <button
          type="button"
          className={`d26-chip ${includeInactive ? "is-active" : ""}`}
          onClick={() => set({ includeInactive: !includeInactive })}
        >
          Auch ohne aktives Abo
        </button>
      </div>
      <div className="d26-chips" aria-label="Sortierung">
        <small>Sortieren</small>
        {sorts.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={`d26-chip ${sort === v ? "is-active" : ""}`}
            onClick={() => set({ sort: v })}
          >
            {label}
          </button>
        ))}
      </div>
      {sort === "revenue" && (
        <p className="d26-filter-note">
          Gesamtumsatz aus Stripe-Zahlungen inklusive Camps, abzüglich
          Erstattungen. Nicht eindeutig belegbare Euro-Umsätze stehen am Ende.
        </p>
      )}
    </div>
  );
}
