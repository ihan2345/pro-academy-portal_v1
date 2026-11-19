"use client";
// /admin-elternkabine: nur Super-Admins mit zusätzlichem Passwort.
import { useCallback, useEffect, useState } from "react";
import { api, ChannelFeed, Sheet } from "./elternkabine";

type AdminData = {
  flags: { enabled: boolean; childPhotos: boolean };
  families: number;
  co_parents: number;
  channels: any[];
  reports: any[];
  terms: Term[] | null;
  camps: { id: string; title: string }[];
  locations: {
    id: string;
    name: string;
    is_region: boolean;
    active: boolean;
  }[];
};
type Term = { id: string; term: string; match: "contains" | "word" };
const AUDIENCE = {
  general: "Alle Abo-Eltern",
  plan: "Eltern eines Abos",
  age: "Jahrgang",
  region: "Region",
  camp: "Camp",
} as const;
type Audience = keyof typeof AUDIENCE;
const AREA: Record<string, string> = {
  academy: "Pro Academy",
  trial: "Probetraining",
  training: "Trainingsgruppe",
  ages: "Jahrgänge",
  regions: "Regionen",
  camps: "Camps",
};
const REASON: Record<string, string> = {
  insult: "Beleidigung",
  ads: "Werbung",
  photo: "Foto",
  privacy: "Private Daten",
  other: "Sonstiges",
};

export function AdminUnlock() {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <div className="ek ek-unlock">
      <div className="ek-card">
        <h2>Elternkabine · Verwaltung</h2>
        <p className="ek-hint">
          Dieser Bereich ist zusätzlich mit einem Passwort geschützt.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("admin/unlock", { password: pw });
              window.location.reload();
            } catch (err) {
              setMsg((err as Error).message);
            }
          }}
        >
          <input
            type="password"
            autoFocus
            placeholder="Passwort"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <button type="submit" className="ek-primary">
            Entsperren
          </button>
        </form>
        {msg && <p className="ek-error">{msg}</p>}
      </div>
    </div>
  );
}

export function AdminElternkabine() {
  const [data, setData] = useState<AdminData | null>(null);
  const [open, setOpen] = useState<any>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [sheet, setSheet] = useState<
    "reports" | "regions" | "channel" | "terms" | null
  >(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await api<AdminData>("admin"));
    } catch (e) {
      setMsg((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!data) return;
    const q = new URLSearchParams(window.location.search);
    const ch = data.channels.find((c) => c.id === q.get("kanal"));
    if (ch && !open) {
      setOpen(ch);
      setFocus(q.get("beitrag"));
    }
  }, [data, open]);
  async function setting(body: unknown) {
    try {
      await api("admin/settings", body);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  if (!data) return <div className="ek-empty">{msg || "Wird geladen …"}</div>;
  const openReports = data.reports.filter((r) => r.state === "open");
  const drafts = data.channels.filter(
    (c) => !c.published_at && c.status === "active",
  );
  return (
    <div className="ek ek-admin">
      <header className="ek-head">
        <div>
          <small className="ek-date">Super-Admin</small>
          <h1>Elternkabine</h1>
          <p>
            {data.flags.enabled
              ? "Für Eltern freigeschaltet."
              : "Für Eltern noch aus. Nur du siehst diesen Bereich."}
          </p>
        </div>
      </header>
      <div className="ek-kpis">
        <div className="ek-kpi">
          <b>{data.families}</b>
          <small>Familien in der Kabine</small>
        </div>
        <div className="ek-kpi">
          <b>{data.co_parents}</b>
          <small>Zweitkonten aktiv</small>
        </div>
        <button
          type="button"
          className={`ek-kpi ${openReports.length ? "is-red" : ""}`}
          onClick={() => setSheet("reports")}
        >
          <b>{openReports.length}</b>
          <small>Meldungen offen</small>
        </button>
        <button
          type="button"
          className="ek-kpi"
          onClick={() => drafts[0] && setOpen(drafts[0])}
        >
          <b>{drafts.length}</b>
          <small>Kanäle warten auf erste Nachricht</small>
        </button>
      </div>
      <div className="ek-card ek-switches">
        <label className="ek-switch">
          <span>
            <b>Elternkabine für Eltern</b>
            <small>Menüpunkt und Beitritt für alle Eltern</small>
          </span>
          <input
            type="checkbox"
            checked={data.flags.enabled}
            onChange={(e) => {
              if (
                e.target.checked &&
                !confirm("Elternkabine wirklich für alle Eltern freischalten?")
              )
                return;
              void setting({
                type: "feature",
                key: "elternkabine",
                enabled: e.target.checked,
              });
            }}
          />
        </label>
        <label className="ek-switch">
          <span>
            <b>Kinderfotos</b>
            <small>Eltern „Fotomediathek für mein Kind“ anbieten</small>
          </span>
          <input
            type="checkbox"
            checked={data.flags.childPhotos}
            onChange={(e) =>
              setting({
                type: "feature",
                key: "elternkabine_child_photos",
                enabled: e.target.checked,
              })
            }
          />
        </label>
        <button
          type="button"
          className="ek-link"
          onClick={() => setSheet("regions")}
        >
          Regionen verwalten ({data.locations.filter((l) => l.is_region).length}
          )
        </button>
        <button
          type="button"
          className="ek-link"
          onClick={() => setSheet("channel")}
        >
          + Neuer Kanal
        </button>
        <button
          type="button"
          className="ek-link"
          onClick={() => setSheet("terms")}
        >
          Blacklist ({data.terms ? data.terms.length : "Startliste"})
        </button>
      </div>
      {Object.keys(AREA).map((area) => {
        const list = data.channels.filter(
          (c) => c.area === area && c.status !== "archived",
        );
        if (!list.length) return null;
        return (
          <section key={area} className="ek-card">
            <h3 className="ek-area">{AREA[area]}</h3>
            <table className="ek-table">
              <thead>
                <tr>
                  <th>Kanal</th>
                  <th>Personen</th>
                  <th>Beiträge 7 T.</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <b>
                        {c.emoji} {c.title}
                      </b>
                      <small>{c.description}</small>
                    </td>
                    <td>{c.members}</td>
                    <td>{c.posts_7d}</td>
                    <td>
                      {!c.published_at ? (
                        <span className="ek-tag is-draft">Entwurf</span>
                      ) : (
                        <select
                          value={c.status}
                          onChange={(e) =>
                            setting({
                              type: "channel",
                              channel_id: c.id,
                              status: e.target.value,
                            })
                          }
                        >
                          <option value="active">Aktiv</option>
                          <option value="readonly">Nur lesen</option>
                          <option value="archived">Archiv</option>
                        </select>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ek-chip"
                        onClick={() => {
                          setFocus(null);
                          setOpen(c);
                        }}
                      >
                        Öffnen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      {open && (
        <Sheet
          title={open.title}
          close={() => {
            setOpen(null);
            void load();
          }}
        >
          <div className="ek-admin-feed">
            <ChannelFeed channel={open} team focus={focus} changed={load} />
          </div>
        </Sheet>
      )}
      {sheet === "reports" && (
        <Sheet title="Meldungen" close={() => setSheet(null)}>
          {!data.reports.length && <p className="ek-hint">Keine Meldungen.</p>}
          {groupReports(data.reports).map(({ r, count, reasons }) => (
            <div key={r.id} className={`ek-report ${r.state}`}>
              {reasons.map((x) => (
                <span key={x} className="ek-tag">
                  {REASON[x] ?? x}
                </span>
              ))}
              {count > 1 && <span className="ek-tag">{count} Meldungen</span>}
              <p>„{r.community_posts?.body}“</p>
              <small>
                {new Date(r.created_at).toLocaleString("de-DE")} ·{" "}
                {r.state === "open"
                  ? "offen"
                  : r.state === "resolved"
                    ? "erledigt: Beitrag ausgeblendet"
                    : "erledigt: ist okay"}
              </small>
              {r.state === "open" && (
                <div className="ek-co-actions">
                  <button
                    type="button"
                    onClick={async () => {
                      await api("admin/moderate", {
                        action: "hide",
                        post_id: r.post_id,
                      });
                      await load();
                    }}
                  >
                    Ausblenden
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await api("admin/moderate", {
                        action: "dismiss",
                        post_id: r.post_id,
                      });
                      await load();
                    }}
                  >
                    Ist okay
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const ch = data.channels.find(
                        (c) => c.id === r.community_posts?.channel_id,
                      );
                      if (ch) {
                        setSheet(null);
                        setFocus(r.post_id);
                        setOpen(ch);
                      }
                    }}
                  >
                    Im Kanal ansehen
                  </button>
                </div>
              )}
            </div>
          ))}
        </Sheet>
      )}
      {sheet === "regions" && (
        <Sheet title="Regionen" close={() => setSheet(null)}>
          <p className="ek-hint">
            Jeder Standort mit Haken wird zur Region. Eltern wählen eine Region
            im Profil, danach öffnet sich der Regionskanal.
          </p>
          {data.locations
            .filter((l) => l.active)
            .map((l) => (
              <label key={l.id} className="ek-switch">
                <span>📍 {l.name}</span>
                <input
                  type="checkbox"
                  checked={l.is_region}
                  onChange={(e) =>
                    setting({
                      type: "region",
                      location_id: l.id,
                      is_region: e.target.checked,
                    })
                  }
                />
              </label>
            ))}
        </Sheet>
      )}
      {sheet === "channel" && (
        <Sheet title="Neuer Kanal" close={() => setSheet(null)}>
          <NewChannel
            data={data}
            done={async (id) => {
              setSheet(null);
              await load();
              const ch = (await api<AdminData>("admin")).channels.find(
                (c) => c.id === id,
              );
              if (ch) setOpen(ch);
            }}
          />
        </Sheet>
      )}
      {sheet === "terms" && (
        <Sheet title="Blacklist" close={() => setSheet(null)}>
          <Terms terms={data.terms} changed={load} />
        </Sheet>
      )}
      {msg && <p className="ek-error">{msg}</p>}
    </div>
  );
}

/** Meldungen pro Beitrag und Status zusammenfassen (neueste zuerst). */
function groupReports(reports: any[]) {
  const map = new Map<string, { r: any; count: number; reasons: string[] }>();
  for (const r of reports) {
    const key = `${r.post_id}:${r.state}`;
    const g = map.get(key);
    if (!g) map.set(key, { r, count: 1, reasons: [r.reason] });
    else {
      g.count++;
      if (!g.reasons.includes(r.reason)) g.reasons.push(r.reason);
    }
  }
  return [...map.values()];
}

function NewChannel({
  data,
  done,
}: {
  data: AdminData;
  done: (id: string) => void;
}) {
  const [f, setF] = useState({
    title: "",
    emoji: "",
    description: "",
    audience: "general" as Audience,
    plan_name: "FirstTouch",
    u_from: 9,
    u_to: 12,
    location_id: "",
    camp_id: "",
    write_mode: "members",
  });
  const [msg, setMsg] = useState("");
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const regions = data.locations.filter((l) => l.is_region && l.active);
  return (
    <form
      className="ek-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg("");
        try {
          const r = await api<{ id: string }>("admin/settings", {
            type: "channel_create",
            ...f,
            location_id: f.location_id || undefined,
            camp_id: f.camp_id || undefined,
          });
          done(r.id);
        } catch (err) {
          setMsg((err as Error).message);
        }
      }}
    >
      <p className="ek-hint">
        Der Kanal startet als Entwurf. Eltern sehen ihn erst, wenn du die erste
        Nachricht schreibst.
      </p>
      <div className="ek-form-row">
        <input
          className="ek-emoji-input"
          placeholder="🏆"
          value={f.emoji}
          maxLength={8}
          onChange={(e) => set("emoji", e.target.value)}
        />
        <input
          placeholder="Name, z. B. Turniere"
          value={f.title}
          required
          minLength={2}
          maxLength={60}
          onChange={(e) => set("title", e.target.value)}
        />
      </div>
      <input
        placeholder="Kurze Beschreibung (optional)"
        value={f.description}
        maxLength={200}
        onChange={(e) => set("description", e.target.value)}
      />
      <span className="ek-form-label">Für wen?</span>
      <div className="ek-chips">
        {(Object.keys(AUDIENCE) as Audience[]).map((a) => (
          <button
            key={a}
            type="button"
            className={`ek-chip ${f.audience === a ? "is-on" : ""}`}
            onClick={() => set("audience", a)}
          >
            {AUDIENCE[a]}
          </button>
        ))}
      </div>
      {f.audience === "plan" && (
        <select
          value={f.plan_name}
          onChange={(e) => set("plan_name", e.target.value)}
        >
          <option>FirstTouch</option>
          <option>GameChanger</option>
          <option>Pro-Player</option>
        </select>
      )}
      {f.audience === "age" && (
        <div className="ek-form-row">
          <label>
            von U
            <input
              type="number"
              min={3}
              max={19}
              value={f.u_from}
              onChange={(e) => set("u_from", Number(e.target.value))}
            />
          </label>
          <label>
            bis U
            <input
              type="number"
              min={3}
              max={19}
              value={f.u_to}
              onChange={(e) => set("u_to", Number(e.target.value))}
            />
          </label>
        </div>
      )}
      {f.audience === "region" && (
        <select
          value={f.location_id}
          required
          onChange={(e) => set("location_id", e.target.value)}
        >
          <option value="">Region wählen …</option>
          {regions.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      {f.audience === "camp" && (
        <select
          value={f.camp_id}
          required
          onChange={(e) => set("camp_id", e.target.value)}
        >
          <option value="">Camp wählen …</option>
          {data.camps.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      )}
      <p className="ek-hint">
        {f.audience === "camp"
          ? "Alle Familien mit bezahlter Buchung für dieses Camp."
          : "Nur Familien mit aktivem Abo, nach Abo-Ende noch 14 Tage zum Mitlesen."}
      </p>
      <label className="ek-switch">
        <span>
          <b>Nur das Team schreibt</b>
          <small>Eltern können lesen und reagieren</small>
        </span>
        <input
          type="checkbox"
          checked={f.write_mode === "team"}
          onChange={(e) =>
            set("write_mode", e.target.checked ? "team" : "members")
          }
        />
      </label>
      <button type="submit" className="ek-primary">
        Kanal als Entwurf anlegen
      </button>
      {msg && <p className="ek-error">{msg}</p>}
    </form>
  );
}

function Terms({
  terms,
  changed,
}: {
  terms: Term[] | null;
  changed: () => Promise<void>;
}) {
  const [term, setTerm] = useState("");
  const [match, setMatch] = useState<"contains" | "word">("contains");
  const [msg, setMsg] = useState("");
  if (!terms)
    return (
      <p className="ek-hint">
        Die bearbeitbare Liste braucht das SQL-Release 052. Bis dahin gilt die
        feste Startliste.
      </p>
    );
  return (
    <div className="ek-form">
      <p className="ek-hint">
        Gilt nur für Eltern, nicht für das Team. Beiträge mit einem Treffer
        werden nicht gesendet, die Person sieht „Bitte bleib freundlich“.
        Außerdem gesperrt: Links und Telefonnummern.
      </p>
      <form
        className="ek-form-row"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg("");
          try {
            await api("admin/settings", { type: "term_add", term, match });
            setTerm("");
            await changed();
          } catch (err) {
            setMsg((err as Error).message);
          }
        }}
      >
        <input
          placeholder="Wort oder Satz"
          value={term}
          minLength={2}
          maxLength={80}
          required
          onChange={(e) => setTerm(e.target.value)}
        />
        <select
          value={match}
          onChange={(e) => setMatch(e.target.value as "contains" | "word")}
        >
          <option value="contains">auch als Wortteil</option>
          <option value="word">nur ganzes Wort/Satz</option>
        </select>
        <button type="submit" className="ek-primary">
          Hinzufügen
        </button>
      </form>
      <p className="ek-hint">
        „Auch als Wortteil“ erkennt auch Tricks wie A.r.s.c.h, 4rschl0ch oder
        Drecks-Wort. „Nur ganzes Wort“ für Wörter, die in harmlosen Wörtern
        stecken (z. B. „spast“ würde sonst „Spastik“ treffen).
      </p>
      {msg && <p className="ek-error">{msg}</p>}
      <ul className="ek-terms">
        {terms.map((t) => (
          <li key={t.id}>
            <b>{t.term}</b>
            <small>
              {t.match === "word" ? "ganzes Wort/Satz" : "auch als Wortteil"}
            </small>
            <button
              type="button"
              className="ek-chip"
              onClick={async () => {
                await api("admin/settings", {
                  type: "term_remove",
                  term_id: t.id,
                });
                await changed();
              }}
            >
              Entfernen
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
