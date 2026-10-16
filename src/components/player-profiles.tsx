"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search, Stamp, Trophy, Users } from "lucide-react";
import {
  childCardTheme,
  childInitials,
  familyStatus,
} from "@/lib/parent-profile";
import { durationLabel, formatDate } from "@/lib/domain";
import type {
  PlayerProfilePage,
  PlayerProfileSort,
} from "@/lib/player-profiles";

export function PlayerProfiles({
  base,
  admin,
}: {
  base: string;
  admin: boolean;
}) {
  const [search, setSearch] = useState(""),
    [term, setTerm] = useState("");
  const [sort, setSort] = useState<PlayerProfileSort>("name"),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  return (
    <div className="parent-profile player-directory">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ACADEMY · SPIELER</div>
          <h1>
            Spielerprofil<span className="greeting-dot">.</span>
          </h1>
          <p>Aktive Kinder mit Abo – ihre Entwicklung auf einen Blick.</p>
        </div>
      </div>
      <div className="player-directory-controls">
        <label className="search-input">
          <Search size={18} />
          <input
            aria-label="Spieler oder Eltern suchen"
            placeholder="Spieler, Eltern oder E-Mail suchen"
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="player-directory-sort">
          Sortierung
          <select
            aria-label="Spielerprofile sortieren"
            value={sort}
            onChange={(e) => setSort(e.target.value as PlayerProfileSort)}
          >
            <option value="name">A–Z</option>
            <option value="subscription">
              Abo (Pro → Gamechanger → Firsttouch)
            </option>
            <option value="months">Platzierung (Gesamtmonate)</option>
            {admin && <option value="revenue">Umsatz (höchster zuerst)</option>}
            <option value="newest">Neu–Alt</option>
            <option value="hours">Trainingsstunden (höchste zuerst)</option>
          </select>
        </label>
        <button
          className="secondary-button"
          onClick={() => setRevision((n) => n + 1)}
        >
          Aktualisieren
        </button>
      </div>
      {sort === "revenue" && (
        <p className="profile-muted">
          Familienumsatz wie im Elternprofil, kein Umsatz je Kind. Bei mehreren
          Elternkonten wird kein uneindeutiger Betrag zugeordnet.
        </p>
      )}
      <PlayerFeed
        key={`${sort}:${term}:${revision}`}
        base={base}
        sort={sort}
        search={term}
        refresh={() => setRevision((n) => n + 1)}
      />
    </div>
  );
}
function PlayerFeed({
  base,
  sort,
  search,
  refresh,
}: {
  base: string;
  sort: PlayerProfileSort;
  search: string;
  refresh: () => void;
}) {
  const [rows, setRows] = useState<PlayerProfilePage["rows"]>([]),
    [next, setNext] = useState<string | null>(null),
    [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [expired, setExpired] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    sentinel = useRef<HTMLDivElement>(null),
    pending = useRef(false),
    controller = useRef<AbortController | null>(null);
  const load = useCallback(
    async (cursor: string | null) => {
      if (pending.current) return;
      pending.current = true;
      setLoading(true);
      setError("");
      const abort = new AbortController();
      controller.current = abort;
      try {
        const params = new URLSearchParams({
          sort,
          search,
          ...(cursor ? { cursor } : {}),
        });
        const response = await fetch(`/api/player-profiles?${params}`, {
          signal: abort.signal,
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) {
          setExpired(response.status === 409);
          throw new Error(
            data.error ?? "Spielerprofile konnten nicht geladen werden.",
          );
        }
        if (abort.signal.aborted) return;
        const page = data as PlayerProfilePage;
        setRows((previous) =>
          cursor
            ? [
                ...previous,
                ...page.rows.filter(
                  (row) => !previous.some((p) => p.id === row.id),
                ),
              ]
            : page.rows,
        );
        setNext(page.next);
        setTotal(page.total);
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "Laden fehlgeschlagen.");
      } finally {
        if (!abort.signal.aborted) {
          pending.current = false;
          setLoading(false);
        }
      }
    },
    [sort, search],
  );
  useEffect(() => {
    void load(null);
    return () => {
      controller.current?.abort();
      pending.current = false;
    };
  }, [load]);
  useEffect(() => {
    if (
      !next ||
      loading ||
      error ||
      !sentinel.current ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void load(next);
      },
      { root: root.current, rootMargin: "900px 0px", threshold: 0 },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [next, loading, error, load]);
  return (
    <>
      <p className="player-directory-count" role="status">
        {loading && !rows.length
          ? "Spielerprofile werden geladen …"
          : `${rows.length} von ${total} Spielern`}
      </p>
      <div
        className="player-directory-scroll"
        ref={root}
        tabIndex={0}
        aria-label="Spielerprofile – scrollbare Kartenübersicht"
      >
        <div className="player-directory-grid" aria-busy={loading}>
          {rows.map((c) => (
            <article
              className={`panel profile-child premium-child player-directory-card ${childCardTheme(c.products)}`}
              key={c.id}
            >
              <Link
                href={`${base.startsWith("/admin/") ? "/admin" : "/team"}/spieler/${c.id}`}
                className="player-directory-card-link"
                aria-label={`Spielerprofil von ${c.name} öffnen`}
                prefetch={false}
              />
              <div className="profile-child-head">
                <span className="child-avatar">
                  {childInitials(c.first_name, c.last_name)}
                </span>
                <div>
                  <h2>{c.name}</h2>
                  <small>
                    {c.age}
                    {c.team ? ` · ${c.team}` : ""}
                  </small>
                </div>
              </div>
              <p className="profile-product">
                {c.products.join(" · ") || "Aktives Abo"}
              </p>
              <p className="profile-muted">
                Mitglied seit {c.since ? formatDate(c.since) : "–"} · {c.months}{" "}
                Monate <MembershipMedal months={c.months} />
              </p>
              <div className="profile-metrics">
                <div>
                  <strong>{c.stats.all.count}</strong>
                  <span>Trainingseinheiten</span>
                </div>
                <div>
                  <strong title={durationLabel(c.stats.all.minutes)}>
                    {new Intl.NumberFormat("de-DE", {
                      maximumFractionDigits: 1,
                    }).format(c.stats.all.minutes / 60)}
                  </strong>
                  <span>Trainingsstunden · gesamt</span>
                </div>
                <div>
                  <strong>{c.camps ?? "–"}</strong>
                  <span>Besuchte Camps</span>
                </div>
              </div>
              {!c.trainingAvailable && (
                <small className="profile-muted">
                  Nachträge fehlen derzeit; Trainingswerte können unvollständig
                  sein.
                </small>
              )}
              {sort === "revenue" && (
                <p className="profile-muted">
                  Familienumsatz:{" "}
                  {c.familyRevenue == null
                    ? "Nicht eindeutig verfügbar"
                    : new Intl.NumberFormat("de-DE", {
                        style: "currency",
                        currency: "EUR",
                      }).format(c.familyRevenue / 100)}
                </p>
              )}
              <div className="player-directory-family">
                <span className="profile-muted player-directory-family-heading">
                  <span>
                    <Users size={14} /> Elternprofil
                  </span>
                  <Link
                    className="player-directory-stamp-link"
                    href={`${base.startsWith("/admin/") ? "/admin" : "/team"}/stempelkarten?child=${encodeURIComponent(c.id)}`}
                    aria-label={`Stempelkarte von ${c.name} öffnen`}
                    title="Stempelkarte öffnen"
                    prefetch={false}
                  >
                    <Stamp size={18} aria-hidden="true" />
                  </Link>
                </span>
                {c.parents.map((p) => (
                  <Link
                    className="child-edit-button"
                    href={`${base}/${p.id}`}
                    key={p.id}
                  >
                    {p.name}
                    <ArrowUpRight size={16} />
                  </Link>
                ))}
                {!c.parents.length && (
                  <small className="profile-muted">
                    Kein aktives Elternprofil zugeordnet
                  </small>
                )}
              </div>
            </article>
          ))}
          {loading &&
            !rows.length &&
            Array.from({ length: 10 }, (_, i) => (
              <div
                className="player-directory-skeleton"
                key={i}
                aria-hidden="true"
              />
            ))}
        </div>
        {!loading && !error && !rows.length && (
          <p className="player-directory-empty">
            Keine passenden aktiven Spieler mit Abo gefunden.
          </p>
        )}
        <div ref={sentinel} className="player-directory-load">
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <button
                className="secondary-button"
                onClick={() => (expired ? refresh() : void load(next))}
              >
                {expired ? "Liste neu laden" : "Erneut versuchen"}
              </button>
            </div>
          ) : loading && rows.length > 0 ? (
            <p role="status">Weitere Spieler werden geladen …</p>
          ) : next ? (
            <button
              className="secondary-button"
              onClick={() => void load(next)}
            >
              Weitere Spieler laden
            </button>
          ) : rows.length > 0 ? (
            <p>Alle Spieler geladen</p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function MembershipMedal({ months }: { months: number }) {
  const status = familyStatus(months);
  const gradient = useId();
  if (status.tier === "starter") return null;
  const label = `Abostatus: ${status.label}`;
  const number =
    status.tier === "bronze" ? 3 : status.tier === "silver" ? 2 : 1;
  return (
    <span
      className={`player-membership-medal ${status.tier}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {status.tier === "ultimate" ? (
        <Trophy size={24} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <svg width="25" height="30" viewBox="0 0 28 34" aria-hidden="true">
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--medal-light)" />
              {status.tier === "gold" && (
                <>
                  <stop offset="0.22" stopColor="#ffd43b" />
                  <stop offset="0.38" stopColor="#fffef0" />
                  <stop offset="0.46" stopColor="#fff3a1" />
                </>
              )}
              <stop offset="0.5" stopColor="var(--medal-main)" />
              <stop offset="1" stopColor="var(--medal-dark)" />
            </linearGradient>
          </defs>
          <path
            d="M5 1h7l4 11-6 3zM16 1h7l-5 14-6-3z"
            fill="var(--medal-dark)"
          />
          <circle
            cx="14"
            cy="21"
            r="11.5"
            fill={`url(#${gradient})`}
            stroke="var(--medal-dark)"
          />
          <circle
            cx="14"
            cy="21"
            r="8.5"
            fill="none"
            stroke="var(--medal-light)"
            strokeOpacity="0.8"
          />
          <text
            x="14"
            y="25.5"
            textAnchor="middle"
            fontSize="13"
            fontWeight="800"
            fill="var(--medal-ink)"
          >
            {number}
          </text>
        </svg>
      )}
    </span>
  );
}
