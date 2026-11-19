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
  locations: {
    id: string;
    name: string;
    is_region: boolean;
    active: boolean;
  }[];
};
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
  const [sheet, setSheet] = useState<"reports" | "regions" | null>(null);
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
            <small>Zusätzliche Zustimmung „Fotos meiner Kinder“ anbieten</small>
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
          {data.reports.map((r) => (
            <div key={r.id} className={`ek-report ${r.state}`}>
              <span className="ek-tag">{REASON[r.reason]}</span>
              <p>„{r.community_posts?.body}“</p>
              <small>
                {new Date(r.created_at).toLocaleString("de-DE")} ·{" "}
                {r.state === "open"
                  ? "offen"
                  : r.state === "resolved"
                    ? "ausgeblendet"
                    : "ist okay"}
              </small>
              {r.state === "open" && (
                <div className="ek-co-actions">
                  <button
                    type="button"
                    onClick={async () => {
                      await api("admin/moderate", {
                        action: "hide",
                        post_id: r.post_id,
                        report_id: r.id,
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
                        report_id: r.id,
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
      {msg && <p className="ek-error">{msg}</p>}
    </div>
  );
}
