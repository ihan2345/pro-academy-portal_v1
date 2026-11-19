"use client";
// Elternkabine: Community für Eltern. Kanäle erscheinen automatisch nach Abo,
// Camp-Buchung, Region und Jahrgang. Die Rechte prüft der Server bei jedem Aufruf.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BellOff,
  Bell,
  CornerDownRight,
  Flag,
  Lock,
  MessageCircle,
  Pin,
  Send,
  Settings2,
  Trash2,
  Pencil,
  EyeOff,
  Check,
  Ban,
} from "lucide-react";
import { graceDaysLeft, type Access } from "@/lib/elternkabine/rules";
import { CoParentPanel } from "./co-parent";

export type Channel = {
  id: string;
  area: string;
  kind: string;
  title: string;
  emoji: string;
  description: string;
  access: Access;
  via?: string[];
  unread: number;
  muted: boolean;
  published_at: string | null;
  last: { body: string; at: string; name: string } | null;
};
type Overview = {
  flags: { enabled: boolean; community?: boolean; childPhotos: boolean };
  co_parent: boolean;
  role: string;
  family: null | {
    enabled: boolean;
    consent_privacy: boolean;
    consent_photos: boolean;
    consent_child_photos: boolean;
    region_id: string | null;
  };
  me: { name_style: string; display_name: string; banned: boolean };
  regions: { id: string; name: string }[];
  children: {
    id: string;
    first_name: string;
    birth_year: number | null;
    u: number | null;
    plans: string[];
  }[];
  co: {
    current: null | {
      id: string;
      email: string;
      first_name: string;
      status: string;
      invite_sent_at: string | null;
      wait_hours: number;
    };
    changes_left: number;
  };
  channels: Channel[];
};
type Post = {
  id: string;
  author: string;
  author_banned?: boolean;
  team: boolean;
  mine: boolean;
  editable: boolean;
  reply_to: string | null;
  kind: string;
  body: string;
  pinned: boolean;
  solved_by: string | null;
  hidden_at: string | null;
  deleted_at: string | null;
  created_at: string;
  edited_at: string | null;
  author_id: string;
  mention_names: string[];
  reactions: { emoji: string; count: number; mine: boolean }[];
};
type Feed = {
  channel: any;
  access: Access;
  members: number;
  posts: Post[];
  mention_candidates: { id: string; name: string; team: boolean }[];
};

const AREAS: Record<string, string> = {
  academy: "Pro Academy",
  trial: "Probetraining",
  training: "Trainingsgruppe",
  ages: "Jahrgänge",
  regions: "Regionen",
  camps: "Camps",
};
const FILTERS = [
  { id: "all", label: "Alle" },
  { id: "new", label: "Neu" },
  { id: "training", label: "Training" },
  { id: "camps", label: "Camps" },
  { id: "regions", label: "Region" },
  { id: "ages", label: "Jahrgang" },
];
export const KIND_CHIPS: Record<string, string> = {
  text: "💬 Beitrag",
  question: "❓ Frage",
  tip: "💡 Tipp",
  ride: "🚗 Fahrt",
  swap: "🔁 Tausch",
  info: "📣 Info",
};
const NAME_STYLES = [
  { id: "full", label: "Voller Name" },
  { id: "first_initial", label: "Vorname + Initiale" },
  { id: "initials", label: "Initialen" },
];
const REACTIONS = ["👍", "❤️", "🙌", "😂", "⚽", "🙏"];
const REPORTS = [
  { id: "insult", label: "Beleidigung" },
  { id: "ads", label: "Werbung" },
  { id: "photo", label: "Foto" },
  { id: "privacy", label: "Private Daten" },
  { id: "other", label: "Sonstiges" },
];

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/elternkabine/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? "Das hat nicht geklappt.");
  return data as T;
}
const time = (iso: string) => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 1) return "gerade eben";
  if (diff < 60) return `vor ${Math.round(diff)} Min.`;
  if (diff < 24 * 60) return `vor ${Math.round(diff / 60)} Std.`;
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
};
const initials = (name: string) =>
  name
    .replace(/\./g, "")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const avatarColor = (name: string) =>
  ["#8b53fe", "#ff9f0a", "#1fc7c1", "#ff4d5e", "#30c75a", "#1d1d1f"][
    [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 6
  ];

export function Elternkabine({ team = false }: { team?: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [active, setActive] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [locked, setLocked] = useState<Channel | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<Overview>("overview"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("kanal");
    if (id) setActive(id);
  }, []);
  if (error && !data) return <div className="ek-empty">{error}</div>;
  if (!data) return <div className="ek-empty">Elternkabine wird geladen …</div>;
  const joined =
    team ||
    (data.family?.enabled && data.family.consent_privacy && !data.me.banned);
  if (!joined)
    return (
      <div className="ek">
        <Head data={data} onSettings={() => setSettings(true)} />
        <Join data={data} reload={load} />
      </div>
    );
  const shown = data.channels.filter((c) =>
    filter === "all"
      ? true
      : filter === "new"
        ? c.unread > 0
        : filter === "training"
          ? c.area === "training" || c.area === "academy"
          : c.area === filter,
  );
  const groups = Object.keys(AREAS)
    .map((a) => ({ area: a, list: shown.filter((c) => c.area === a) }))
    .filter((g) => g.list.length);
  const current = data.channels.find((c) => c.id === active) ?? null;
  return (
    <div className={`ek ${current ? "has-channel" : ""}`}>
      <Head data={data} onSettings={() => setSettings(true)} />
      <div className="ek-grid">
        <aside className="ek-list">
          <div className="ek-chips" role="tablist">
            {FILTERS.filter(
              (f) =>
                f.id === "all" ||
                f.id === "new" ||
                data.channels.some((c) =>
                  f.id === "training" ? c.area === "training" : c.area === f.id,
                ),
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                className={`ek-chip ${filter === f.id ? "is-on" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                {f.id === "new" && (
                  <b>
                    {data.channels.reduce(
                      (n, c) => n + (c.muted ? 0 : c.unread),
                      0,
                    )}
                  </b>
                )}
              </button>
            ))}
          </div>
          {!groups.length && (
            <p className="ek-hint">
              Hier ist gerade nichts. Neue Kanäle erscheinen automatisch, zum
              Beispiel nach einer Camp-Buchung.
            </p>
          )}
          {groups.map((g) => (
            <section key={g.area}>
              <h3 className="ek-area">{AREAS[g.area]}</h3>
              {g.list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`ek-channel area-${c.area} ${c.access.level === "locked" ? "is-locked" : ""} ${active === c.id ? "is-active" : ""}`}
                  onClick={() =>
                    c.access.level === "locked" ? setLocked(c) : setActive(c.id)
                  }
                >
                  <span className={`ek-icon kind-${c.kind}`}>
                    {c.access.level === "locked" ? (
                      <Lock size={14} />
                    ) : (
                      c.emoji || "#"
                    )}
                  </span>
                  <span className="ek-channel-text">
                    <b>
                      {c.title}
                      {!!c.via?.length && (
                        <em className="ek-via">über {c.via.join(", ")}</em>
                      )}
                      {team && !c.published_at && (
                        <em className="ek-draft">Entwurf</em>
                      )}
                    </b>
                    <small>
                      {c.access.level === "locked"
                        ? c.access.reason === "region"
                          ? "Wähle eine Region aus"
                          : "Fotomediathek nicht aktiviert"
                        : c.last
                          ? `${c.last.name}: ${c.last.body}`
                          : c.description}
                    </small>
                  </span>
                  {c.muted ? (
                    <BellOff size={13} className="ek-muted" />
                  ) : c.unread > 0 ? (
                    <span className="ek-badge">{c.unread}</span>
                  ) : null}
                </button>
              ))}
            </section>
          ))}
        </aside>
        <main className="ek-feed-wrap">
          {current ? (
            <ChannelFeed
              key={current.id}
              channel={current}
              team={team}
              back={() => setActive(null)}
              changed={load}
            />
          ) : (
            <div className="ek-welcome">
              <MessageCircle size={28} />
              <h2>Willkommen in der Elternkabine</h2>
              <p>
                Wähle links einen Kanal. Du siehst nur Kanäle, die zu deinen
                Kindern passen. Neue erscheinen automatisch.
              </p>
            </div>
          )}
        </main>
      </div>
      {settings && (
        <Sheet title="Einstellungen" close={() => setSettings(false)}>
          <SettingsPanel data={data} reload={load} />
        </Sheet>
      )}
      {locked && (
        <Sheet title={locked.title} close={() => setLocked(null)}>
          {locked.access.reason === "region" ? (
            <RegionPicker
              data={data}
              done={() => {
                setLocked(null);
                void load();
              }}
            />
          ) : (
            <p className="ek-hint">
              Für diesen Kanal muss die Fotomediathek aktiviert sein. Das
              Hauptkonto kann sie in den Einstellungen einschalten.
            </p>
          )}
        </Sheet>
      )}
    </div>
  );
}

function Head({
  data,
  onSettings,
}: {
  data: Overview;
  onSettings: () => void;
}) {
  return (
    <header className="ek-head">
      <div>
        <small className="ek-date">
          {new Date().toLocaleDateString("de-DE", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </small>
        <h1>Elternkabine</h1>
        <p>
          {data.co_parent
            ? "Du bist als zweiter Elternteil dabei."
            : "Euer geschützter Ort für Fragen, Tipps und Absprachen."}
        </p>
        {data.role !== "parent" && !data.flags.enabled && (
          <p className="ek-staff-only">
            Nur für Mitarbeiter sichtbar. Eltern sehen die Elternkabine erst,
            wenn sie veröffentlicht ist.
          </p>
        )}
      </div>
      {data.role === "parent" && (
        <button
          type="button"
          className="ek-round"
          onClick={onSettings}
          aria-label="Einstellungen"
        >
          <Settings2 size={18} />
        </button>
      )}
    </header>
  );
}

function Join({ data, reload }: { data: Overview; reload: () => void }) {
  const [privacy, setPrivacy] = useState(false);
  const [photos, setPhotos] = useState(false);
  const [childPhotos, setChildPhotos] = useState(false);
  const [style, setStyle] = useState(data.me.name_style);
  const [births, setBirths] = useState<Record<string, string>>({});
  const missing = data.children.filter((c) => !c.birth_year);
  const birthsOk = missing.every((c) => births[c.id]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (data.me.banned)
    return (
      <div className="ek-card">
        Dein Zugang zur Elternkabine ist gesperrt. Bei Fragen melde dich beim
        Team.
      </div>
    );
  if (data.co_parent)
    return (
      <div className="ek-card">
        <h2>Noch nicht beigetreten</h2>
        <p>
          Die Elternkabine schaltet das Hauptkonto deiner Familie frei. Sobald
          das passiert ist, siehst du hier eure Kanäle.
        </p>
      </div>
    );
  async function join() {
    setBusy(true);
    setMsg("");
    try {
      for (const c of missing)
        await api("child-birth", { player_id: c.id, birth_date: births[c.id] });
      await api("me", { name_style: style });
      await api("family", {
        enabled: true,
        consent_privacy: privacy,
        consent_photos: photos,
        consent_child_photos: childPhotos,
        region_id: data.family?.region_id ?? null,
      });
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <div className="ek-card ek-join">
      <h2>Tritt der Elternkabine bei</h2>
      <p>
        Hier triffst du andere Eltern aus deiner Trainingsgruppe, deinem Camp,
        deiner Region und dem Jahrgang deines Kindes. Du landest automatisch nur
        in Kanälen, die zu euch passen.
      </p>
      <h3>So sehen dich andere</h3>
      <div className="ek-chips">
        {NAME_STYLES.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`ek-chip ${style === n.id ? "is-on" : ""}`}
            onClick={() => setStyle(n.id)}
          >
            {n.label}
          </button>
        ))}
      </div>
      {style === "full" && (
        <p className="ek-hint">
          Hinweis: Dein voller Name ist für alle Mitglieder deiner Kanäle
          sichtbar.
        </p>
      )}
      <h3>Kinder und Jahrgang</h3>
      <p className="ek-hint">
        Die Jahrgangskanäle ergeben sich aus dem Geburtsjahr. Bei mehreren
        Kindern bist du automatisch in jedem passenden Kanal.
      </p>
      <ChildAges data={data} births={births} setBirths={setBirths} />
      <h3>Zustimmung</h3>
      <label className="ek-check">
        <input
          type="checkbox"
          checked={privacy}
          onChange={(e) => setPrivacy(e.target.checked)}
        />
        <span>
          <b>Datenschutz und Regeln (Pflicht).</b> Ich stimme der Verarbeitung
          meiner Beiträge und meines Anzeigenamens in der Elternkabine zu und
          halte mich an die Regeln: freundlich bleiben, keine Werbung, keine
          Telefonnummern oder Adressen, Beschwerden über „Frag das Team“.
        </span>
      </label>
      <label className="ek-check">
        <input
          type="checkbox"
          checked={photos}
          onChange={(e) => setPhotos(e.target.checked)}
        />
        <span>
          <b>Fotomediathek für mich aktivieren (freiwillig).</b> Ich kann Fotos
          und Dateien teilen und sehe die Fotos der anderen Eltern. Auf meinen
          Fotos sind keine Kinder zu sehen. Ohne Mediathek bleiben Foto-Kanäle
          ausgegraut.
        </span>
      </label>
      {data.flags.childPhotos && (
        <label className="ek-check">
          <input
            type="checkbox"
            checked={childPhotos}
            onChange={(e) => setChildPhotos(e.target.checked)}
          />
          <span>
            <b>Fotomediathek für mein Kind aktivieren (freiwillig).</b> Pro
            Academy und ich dürfen Fotos zeigen, auf denen mein Kind zu sehen
            ist, nur in den Kanälen seiner Gruppe.
          </span>
        </label>
      )}
      <p className="ek-hint">
        Du kannst jederzeit wieder austreten. Deine Zustimmung wird mit Datum
        gespeichert.
      </p>
      {msg && <p className="ek-error">{msg}</p>}
      <button
        type="button"
        className="ek-primary"
        disabled={!privacy || !birthsOk || busy}
        onClick={join}
      >
        Elternkabine beitreten
      </button>
    </div>
  );
}

function RegionPicker({ data, done }: { data: Overview; done: () => void }) {
  const [msg, setMsg] = useState("");
  if (data.co_parent)
    return (
      <p className="ek-hint">
        Die Region wählt das Hauptkonto deiner Familie in den Einstellungen.
      </p>
    );
  async function pick(id: string) {
    try {
      await api("family", { ...familyBody(data), region_id: id });
      done();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  return (
    <div>
      <p className="ek-hint">
        Wähle eine Region aus. Danach öffnet sich der passende Regionskanal.
      </p>
      <div className="ek-region-list">
        {data.regions.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`ek-region ${data.family?.region_id === r.id ? "is-on" : ""}`}
            onClick={() => pick(r.id)}
          >
            📍 {r.name}
          </button>
        ))}
      </div>
      {msg && <p className="ek-error">{msg}</p>}
    </div>
  );
}
const familyBody = (data: Overview) => ({
  enabled: !!data.family?.enabled,
  consent_privacy: !!data.family?.consent_privacy,
  consent_photos: !!data.family?.consent_photos,
  consent_child_photos: !!data.family?.consent_child_photos,
  region_id: data.family?.region_id ?? null,
});

function SettingsPanel({
  data,
  reload,
}: {
  data: Overview;
  reload: () => void;
}) {
  const [msg, setMsg] = useState("");
  const main = !data.co_parent;
  async function save(path: string, body: unknown) {
    setMsg("");
    try {
      await api(path, body);
      reload();
      setMsg("Gespeichert ✓");
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  return (
    <div className="ek-settings">
      <section>
        <h3>So sehen dich andere</h3>
        <p className="ek-hint">
          Aktuell: <b>{data.me.display_name}</b>
        </p>
        <div className="ek-chips">
          {NAME_STYLES.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`ek-chip ${data.me.name_style === n.id ? "is-on" : ""}`}
              onClick={() => save("me", { name_style: n.id })}
            >
              {n.label}
            </button>
          ))}
        </div>
      </section>
      {data.regions.length > 0 && (
        <section>
          <h3>Region</h3>
          {main ? (
            <div className="ek-region-list">
              {data.regions.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`ek-region ${data.family?.region_id === r.id ? "is-on" : ""}`}
                  onClick={() =>
                    save("family", { ...familyBody(data), region_id: r.id })
                  }
                >
                  📍 {r.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="ek-hint">
              {data.regions.find((r) => r.id === data.family?.region_id)
                ?.name ?? "Noch keine Region gewählt."}{" "}
              Ändern kann das nur das Hauptkonto.
            </p>
          )}
        </section>
      )}
      {main && data.family?.enabled && (
        <section>
          <h3>Zustimmungen</h3>
          <label className="ek-switch">
            <span>
              <b>Fotomediathek für mich</b>
              <small>Fotos und Dateien teilen und sehen, ohne Kinder</small>
            </span>
            <input
              type="checkbox"
              checked={data.family.consent_photos}
              onChange={(e) =>
                save("family", {
                  ...familyBody(data),
                  consent_photos: e.target.checked,
                })
              }
            />
          </label>
          {data.flags.childPhotos && (
            <label className="ek-switch">
              <span>
                <b>Fotomediathek für mein Kind</b>
                <small>Fotos, auf denen mein Kind zu sehen ist</small>
              </span>
              <input
                type="checkbox"
                checked={data.family.consent_child_photos}
                onChange={(e) =>
                  save("family", {
                    ...familyBody(data),
                    consent_child_photos: e.target.checked,
                  })
                }
              />
            </label>
          )}
        </section>
      )}
      {data.children.length > 0 && (
        <section>
          <h3>Kinder und Jahrgang</h3>
          <ChildAges
            data={data}
            save={
              main
                ? (id, date) =>
                    save("child-birth", { player_id: id, birth_date: date })
                : undefined
            }
          />
        </section>
      )}
      {main && <CoParentPanel co={data.co} reload={reload} />}
      {main && data.family?.enabled && (
        <section>
          <button
            type="button"
            className="ek-danger"
            onClick={() =>
              confirm(
                "Elternkabine wirklich verlassen? Du kannst später wieder beitreten.",
              ) && save("family", { ...familyBody(data), enabled: false })
            }
          >
            Elternkabine verlassen
          </button>
        </section>
      )}
      {msg && <p className="ek-hint">{msg}</p>}
    </div>
  );
}

export function Sheet({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [close]);
  return (
    <div
      className="ek-sheet-bg"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="ek-sheet" role="dialog" aria-label={title}>
        <div className="ek-sheet-head">
          <b>{title}</b>
          <button type="button" onClick={close}>
            Fertig
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ChannelFeed({
  channel,
  team,
  back,
  changed,
  focus,
}: {
  channel: Pick<Channel, "id" | "title" | "emoji" | "kind">;
  team: boolean;
  back?: () => void;
  changed?: () => void;
  focus?: string | null;
}) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [replyTo, setReplyTo] = useState<Post | null>(null);
  const [reporting, setReporting] = useState<Post | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      setFeed(await api<Feed>(`channel/${channel.id}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [channel.id]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!focus) end.current?.scrollIntoView({ block: "end" });
    else
      document
        .getElementById(`ek-post-${focus}`)
        ?.scrollIntoView({ block: "center" });
  }, [feed?.posts.length, focus]);
  const roots = useMemo(
    () =>
      (feed?.posts ?? [])
        .filter((p) => !p.reply_to)
        .filter((p) => kindFilter === "all" || p.kind === kindFilter)
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            a.created_at.localeCompare(b.created_at),
        ),
    [feed, kindFilter],
  );
  async function act(path: string, body: unknown) {
    try {
      await api(path, body);
      await load();
      changed?.();
    } catch (e) {
      alertError(e);
    }
  }
  const grace = graceDaysLeft(feed?.access.grace_until);
  return (
    <section className="ek-feed">
      <header className="ek-feed-head">
        {back && (
          <button
            type="button"
            className="ek-round ek-back"
            onClick={back}
            aria-label="Zurück"
          >
            <ArrowLeft size={17} />
          </button>
        )}
        <div>
          <h2>
            {channel.emoji} {channel.title}
          </h2>
          <small>
            {feed
              ? `${feed.members} ${feed.members === 1 ? "Person" : "Personen"}`
              : ""}
            {feed?.channel.description ? ` · ${feed.channel.description}` : ""}
          </small>
        </div>
        {!team && feed && (
          <button
            type="button"
            className="ek-round"
            aria-label="Stummschalten"
            onClick={() =>
              act("mute", {
                channel_id: channel.id,
                muted: !("muted" in channel && (channel as Channel).muted),
              })
            }
          >
            {"muted" in channel && (channel as Channel).muted ? (
              <BellOff size={16} />
            ) : (
              <Bell size={16} />
            )}
          </button>
        )}
      </header>
      <div className="ek-chips ek-kind-chips">
        {["all", "question", "tip", "ride", "swap", "info"].map((k) => (
          <button
            key={k}
            type="button"
            className={`ek-chip ${kindFilter === k ? "is-on" : ""}`}
            onClick={() => setKindFilter(k)}
          >
            {k === "all" ? "Alle" : KIND_CHIPS[k]}
          </button>
        ))}
      </div>
      <div className="ek-posts">
        {error && <p className="ek-error">{error}</p>}
        {feed && !roots.length && (
          <p className="ek-hint ek-center">
            {team && !feed.channel.published_at
              ? "Dieser Kanal ist noch ein Entwurf. Mit deiner ersten Nachricht wird er für Eltern sichtbar."
              : "Noch keine Beiträge. Fang gern an!"}
          </p>
        )}
        {roots.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            replies={(feed?.posts ?? []).filter((r) => r.reply_to === p.id)}
            team={team}
            focus={focus}
            onReply={() => setReplyTo(p)}
            onReport={setReporting}
            act={act}
          />
        ))}
        <div ref={end} />
      </div>
      {grace !== null && (
        <div className="ek-grace">
          Dein Abo ist beendet. Du kannst hier noch{" "}
          <b>
            {grace} {grace === 1 ? "Tag" : "Tage"}
          </b>{" "}
          mitlesen, danach wird der Kanal für dich deaktiviert.
        </div>
      )}
      {feed && (
        <Composer
          feed={feed}
          team={team}
          replyTo={replyTo}
          clearReply={() => setReplyTo(null)}
          sent={async () => {
            setReplyTo(null);
            await load();
            changed?.();
          }}
        />
      )}
      {reporting && (
        <Sheet title="Beitrag melden" close={() => setReporting(null)}>
          <p className="ek-hint">
            Das Team schaut sich den Beitrag an. Bei drei Meldungen wird er
            automatisch ausgeblendet.
          </p>
          <div className="ek-chips">
            {REPORTS.map((r) => (
              <button
                key={r.id}
                type="button"
                className="ek-chip"
                onClick={async () => {
                  await act("report", { post_id: reporting.id, reason: r.id });
                  setReporting(null);
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </section>
  );
}
function alertError(e: unknown) {
  window.alert((e as Error).message);
}

function PostCard({
  post,
  replies,
  team,
  focus,
  onReply,
  onReport,
  act,
}: {
  post: Post;
  replies: Post[];
  team: boolean;
  focus?: string | null;
  onReply: () => void;
  onReport: (p: Post) => void;
  act: (path: string, body: unknown) => Promise<void>;
}) {
  const [picker, setPicker] = useState(false);
  return (
    <article
      id={`ek-post-${post.id}`}
      className={`ek-post ${post.team ? "is-team" : ""} ${post.pinned ? "is-pinned" : ""} ${post.hidden_at ? "is-hidden" : ""} ${focus === post.id ? "is-focus" : ""}`}
    >
      <PostBody post={post} team={team} onReport={onReport} act={act} />
      <div className="ek-post-foot">
        {post.reactions.map((r) => (
          <button
            key={r.emoji}
            type="button"
            className={`ek-react ${r.mine ? "is-mine" : ""}`}
            onClick={() => act("react", { post_id: post.id, emoji: r.emoji })}
          >
            {r.emoji} {r.count}
          </button>
        ))}
        <span className="ek-react-add">
          <button
            type="button"
            className="ek-react"
            onClick={() => setPicker(!picker)}
          >
            ＋
          </button>
          {picker && (
            <span className="ek-react-picker">
              {REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    setPicker(false);
                    void act("react", { post_id: post.id, emoji: e });
                  }}
                >
                  {e}
                </button>
              ))}
            </span>
          )}
        </span>
        <button type="button" className="ek-link" onClick={onReply}>
          <CornerDownRight size={12} /> Antworten
          {replies.length ? ` · ${replies.length}` : ""}
        </button>
        {team && post.kind === "question" && (
          <button
            type="button"
            className="ek-link"
            onClick={() =>
              act("admin/moderate", {
                action: "solve",
                post_id: post.id,
                solved_by: post.solved_by ? undefined : post.id,
              })
            }
          >
            <Check size={12} /> {post.solved_by ? "Offen" : "Gelöst"}
          </button>
        )}
      </div>
      {replies.length > 0 && (
        <div className="ek-replies">
          {replies.map((r) => (
            <div
              key={r.id}
              id={`ek-post-${r.id}`}
              className={`ek-reply ${r.team ? "is-team" : ""} ${r.hidden_at ? "is-hidden" : ""}`}
            >
              <PostBody
                post={r}
                team={team}
                onReport={onReport}
                act={act}
                small
              />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
function PostBody({
  post,
  team,
  onReport,
  act,
  small,
}: {
  post: Post;
  team: boolean;
  onReport: (p: Post) => void;
  act: (path: string, body: unknown) => Promise<void>;
  small?: boolean;
}) {
  return (
    <>
      <div className="ek-who">
        <span
          className="ek-avatar"
          style={{
            background: post.team ? "#8b53fe" : avatarColor(post.author),
          }}
        >
          {post.team ? "PA" : initials(post.author)}
        </span>
        <b>{post.author}</b>
        {post.team && <span className="ek-tag is-team">Team</span>}
        {!small && post.kind !== "text" && (
          <span className="ek-tag">{KIND_CHIPS[post.kind]}</span>
        )}
        {post.solved_by && <span className="ek-tag is-solved">✓ gelöst</span>}
        {post.pinned && <Pin size={12} className="ek-pin" />}
        <small>
          {time(post.created_at)}
          {post.edited_at ? " · bearbeitet" : ""}
        </small>
        <span className="ek-tools">
          {post.editable && (
            <button
              type="button"
              aria-label="Bearbeiten"
              onClick={() => {
                const t = prompt("Beitrag bearbeiten", post.body);
                if (t) void act("edit", { id: post.id, body: t });
              }}
            >
              <Pencil size={13} />
            </button>
          )}
          {post.mine && !post.deleted_at && (
            <button
              type="button"
              aria-label="Löschen"
              onClick={() =>
                confirm("Beitrag löschen?") && act("delete", { id: post.id })
              }
            >
              <Trash2 size={13} />
            </button>
          )}
          {!post.mine && !team && (
            <button
              type="button"
              aria-label="Melden"
              onClick={() => onReport(post)}
            >
              <Flag size={13} />
            </button>
          )}
          {team && (
            <>
              <button
                type="button"
                aria-label={post.pinned ? "Lösen" : "Anheften"}
                onClick={() =>
                  act("admin/moderate", {
                    action: post.pinned ? "unpin" : "pin",
                    post_id: post.id,
                  })
                }
              >
                <Pin size={13} />
              </button>
              <button
                type="button"
                aria-label={post.hidden_at ? "Wieder zeigen" : "Ausblenden"}
                onClick={() =>
                  act("admin/moderate", {
                    action: post.hidden_at ? "unhide" : "hide",
                    post_id: post.id,
                  })
                }
              >
                <EyeOff size={13} />
              </button>
              {!post.team && post.author_id && (
                <button
                  type="button"
                  className={post.author_banned ? "is-banned" : ""}
                  aria-label={
                    post.author_banned
                      ? `${post.author} entsperren`
                      : `${post.author} sperren`
                  }
                  title={
                    post.author_banned
                      ? `${post.author} ist gesperrt. Klicken zum Entsperren.`
                      : `${post.author} in der Elternkabine sperren`
                  }
                  onClick={() => {
                    const text = post.author_banned
                      ? `${post.author} wieder freischalten?`
                      : `${post.author} in der Elternkabine sperren? Die Person sieht die Elternkabine dann nicht mehr. Ist es ein Zweitkonto, kann das Hauptkonto es 30 Tage lang nicht ändern.`;
                    if (!window.confirm(text)) return;
                    void act("admin/moderate", {
                      action: post.author_banned ? "unban" : "ban",
                      user_id: post.author_id,
                    });
                  }}
                >
                  <Ban size={13} />
                </button>
              )}
            </>
          )}
        </span>
      </div>
      <p className="ek-text">
        {post.deleted_at ? (
          <i>Beitrag gelöscht</i>
        ) : (
          highlight(post.body, post.mention_names)
        )}
      </p>
      {post.hidden_at && (
        <small className="ek-hidden-note">Für Eltern ausgeblendet</small>
      )}
    </>
  );
}
function highlight(body: string, names: string[]) {
  if (!names.length) return body;
  const parts = body.split(
    new RegExp(
      `(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`,
    ),
  );
  return parts.map((p, i) =>
    p.startsWith("@") ? <mark key={i}>{p}</mark> : p,
  );
}

function Composer({
  feed,
  team,
  replyTo,
  clearReply,
  sent,
}: {
  feed: Feed;
  team: boolean;
  replyTo: Post | null;
  clearReply: () => void;
  sent: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState(
    feed.access.level === "ask" ? "question" : "text",
  );
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const level = feed.access.level;
  const ownThread = replyTo && replyTo.mine;
  const canWrite =
    team ||
    level === "write" ||
    (level === "ask" &&
      (!replyTo || (feed.channel.kind === "ask_team" && ownThread)));
  const query = /@([\p{L}.]*)$/u.exec(text)?.[1];
  const suggestions =
    query !== undefined
      ? feed.mention_candidates
          .filter((c) => c.name.toLowerCase().startsWith(query.toLowerCase()))
          .slice(0, 5)
      : [];
  if (!canWrite)
    return (
      <div className="ek-composer is-readonly">
        {level === "ask"
          ? "Antworten kommen hier vom Team."
          : feed.access.grace_until
            ? "Nur noch mitlesen."
            : "In diesem Kanal schreibt nur das Team."}
      </div>
    );
  const kinds =
    level === "ask" && !team
      ? ["question"]
      : team
        ? ["text", "info", "question", "tip"]
        : ["text", "question", "tip", "ride", "swap"];
  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      await api("post", {
        channel_id: feed.channel.id,
        body: text,
        kind,
        reply_to: replyTo?.id ?? null,
        mentions: mentions
          .filter((m) => text.includes(`@${m.name}`))
          .map((m) => m.id),
      });
      setText("");
      setMentions([]);
      await sent();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <div className="ek-composer">
      {replyTo ? (
        <div className="ek-replying">
          Antwort an <b>{replyTo.author}</b>
          <button type="button" onClick={clearReply}>
            ×
          </button>
        </div>
      ) : (
        <div className="ek-chips">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              className={`ek-chip ${kind === k ? "is-on" : ""}`}
              onClick={() => setKind(k)}
            >
              {KIND_CHIPS[k]}
            </button>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="ek-mentions">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setText(text.replace(/@([\p{L}.]*)$/u, `@${s.name} `));
                setMentions([...mentions, s]);
              }}
            >
              @{s.name} {s.team && <span className="ek-tag is-team">Team</span>}
            </button>
          ))}
        </div>
      )}
      <div className="ek-input">
        <textarea
          rows={1}
          value={text}
          maxLength={4000}
          placeholder={
            replyTo
              ? "Deine Antwort …"
              : level === "ask" && !team
                ? "Stell deine Frage …"
                : !feed.channel.published_at && team
                  ? "Erste Nachricht schreiben und Kanal eröffnen …"
                  : `Schreib in „${feed.channel.title}“ … (@ für Erwähnung)`
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <button
          type="button"
          className="ek-send"
          disabled={busy || !text.trim()}
          onClick={send}
          aria-label="Senden"
        >
          <Send size={16} />
        </button>
      </div>
      {msg && <p className="ek-error">{msg}</p>}
    </div>
  );
}

const ageGroup = (u: number) =>
  u <= 5
    ? "U4–U5"
    : u <= 8
      ? "U6–U8"
      : u <= 12
        ? "U9–U12"
        : u <= 16
          ? "U13–U16"
          : null;
function ChildAges({
  data,
  births,
  setBirths,
  save,
}: {
  data: Overview;
  births?: Record<string, string>;
  setBirths?: (b: Record<string, string>) => void;
  save?: (id: string, date: string) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  return (
    <div className="ek-kids">
      {data.children.map((c) => (
        <div key={c.id} className="ek-kid">
          <b>{c.first_name}</b>
          {c.u !== null ? (
            <span className="ek-tag is-team">
              U{c.u}
              {ageGroup(c.u)
                ? ` · Kanal ${ageGroup(c.u)}`
                : " · kein Jahrgangskanal"}
            </span>
          ) : setBirths ? (
            <label className="ek-kid-birth">
              Geburtsdatum (Pflicht)
              <input
                type="date"
                value={births?.[c.id] ?? ""}
                onChange={(e) =>
                  setBirths({ ...births, [c.id]: e.target.value })
                }
              />
            </label>
          ) : save ? (
            <span className="ek-kid-birth">
              <input
                type="date"
                value={draft[c.id] ?? ""}
                onChange={(e) => setDraft({ ...draft, [c.id]: e.target.value })}
              />
              <button
                type="button"
                className="ek-chip"
                disabled={!draft[c.id]}
                onClick={() => save(c.id, draft[c.id])}
              >
                Speichern
              </button>
            </span>
          ) : (
            <span className="ek-hint">
              Geburtsdatum fehlt. Das Hauptkonto kann es eintragen.
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
