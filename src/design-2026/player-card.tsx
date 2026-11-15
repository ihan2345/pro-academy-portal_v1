// Design 2026: Spielerkarte (Verwaltung und Team) als iOS-Profil. Reine
// Darstellung der bereits geladenen Spielerdaten, der Bearbeiten-Dialog wird
// unverändert als Baustein eingesetzt.
import Link from "next/link";
import {
  ArrowLeft,
  CalendarRange,
  Footprints,
  Ruler,
  Shield,
  Target,
  UserRound,
  Users,
} from "lucide-react";
import { formatDate } from "@/lib/domain";

export type PlayerCardData = {
  spielername: string;
  elternteile: string[];
  geburtsjahr: number | null;
  geschlecht: string | null;
  verein: string | null;
  position: string | null;
  fuss: string | null;
  groesse_cm: number | null;
  entwicklungsziele: string | null;
  archiviert: boolean;
  abos: { art: string; von: string; bis: string }[];
  aktive_monate: number | string | null;
};

export function PlayerCard({
  player,
  team,
  back,
  editor,
  now = Date.now(),
}: {
  player: PlayerCardData;
  team?: string | null;
  back: string;
  editor?: React.ReactNode;
  now?: number;
}) {
  const initials = player.spielername
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  const age = player.geburtsjahr
    ? new Date(now).getFullYear() - player.geburtsjahr
    : null;
  const goals = (player.entwicklungsziele ?? "")
    .split(/\n+|(?<=\.)\s+(?=[A-ZÄÖÜ])/)
    .map((g) => g.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter(Boolean);
  const tiles = [
    {
      icon: CalendarRange,
      value: player.aktive_monate ?? 0,
      label: "Aktive Monate",
    },
    {
      icon: Shield,
      value: player.abos.length,
      label: player.abos.length === 1 ? "Laufendes Abo" : "Laufende Abos",
    },
    {
      icon: Ruler,
      value: player.groesse_cm ? `${player.groesse_cm} cm` : "–",
      label: "Größe",
    },
    {
      icon: Footprints,
      value: player.fuss
        ? player.fuss.charAt(0).toUpperCase() + player.fuss.slice(1)
        : "–",
      label: "Starker Fuß",
    },
  ];
  const facts: [string, string | number | null][] = [
    ["Elternteil", player.elternteile.join(", ") || null],
    [
      "Geburtsjahr",
      player.geburtsjahr
        ? `${player.geburtsjahr}${age ? ` · ${age} Jahre` : ""}`
        : null,
    ],
    ["Geschlecht", player.geschlecht],
    ["Verein", player.verein],
    ["Position", player.position],
  ];
  return (
    <div className="d26-experience d26-player-card">
      <Link href={back} className="d26-backlink">
        <ArrowLeft size={16} /> Spielerprofile
      </Link>
      <section className="d26-card d26-player-hero">
        <span className="d26-player-avatar">{initials || "?"}</span>
        <div>
          <span className="d26-eyebrow">Spielerkarte</span>
          <h1>{player.spielername}</h1>
          <p>
            {team && <span className="d26-pill tone-purple">{team}</span>}
            {player.archiviert ? (
              <span className="d26-pill tone-amber">Archiviert</span>
            ) : player.abos.length ? (
              <span className="d26-pill tone-lime">Aktiv</span>
            ) : (
              <span className="d26-pill">Kein laufendes Abo</span>
            )}
            {player.position && (
              <span className="d26-pill">{player.position}</span>
            )}
          </p>
        </div>
        {editor && <div className="d26-player-edit">{editor}</div>}
      </section>

      <div className="d26-kpis">
        {tiles.map((t) => (
          <div className="d26-card d26-kpi" key={t.label}>
            <t.icon size={18} />
            <b>{t.value}</b>
            <span>{t.label}</span>
          </div>
        ))}
      </div>

      <div className="d26-player-grid">
        <div className="d26-settings-group">
          <h4>Steckbrief</h4>
          <div className="d26-settings d26-player-facts">
            {facts.map(([label, value]) => (
              <div className="d26-setting is-static" key={label}>
                <span className="d26-setting-icon tone-purple">
                  {label === "Elternteil" ? (
                    <Users size={16} />
                  ) : (
                    <UserRound size={16} />
                  )}
                </span>
                <span className="d26-setting-main">
                  <small>{label}</small>
                  <b className={value ? "" : "is-missing"}>
                    {value ?? "Nicht hinterlegt"}
                  </b>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="d26-settings-group">
          <h4>Entwicklungsziele</h4>
          <div className="d26-card d26-goals">
            {goals.length ? (
              <ol>
                {goals.map((g, i) => (
                  <li key={i}>
                    <Target size={15} />
                    <span>{g}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="d26-empty">Noch keine Ziele hinterlegt.</p>
            )}
          </div>

          <h4>Aktuelle Abos</h4>
          <div className="d26-settings">
            {player.abos.map((abo, i) => {
              const from = Date.parse(abo.von),
                to = Date.parse(abo.bis);
              const share = Math.min(
                1,
                Math.max(0, (now - from) / Math.max(1, to - from)),
              );
              const left = Math.max(0, Math.ceil((to - now) / 86400000));
              return (
                <div className="d26-setting is-static" key={i}>
                  <span className="d26-setting-icon tone-lime">
                    <Shield size={16} />
                  </span>
                  <span className="d26-setting-main">
                    <b>{abo.art}</b>
                    <small>
                      {formatDate(abo.von)} – {formatDate(abo.bis)} · noch{" "}
                      {left} {left === 1 ? "Tag" : "Tage"}
                    </small>
                    <i
                      className="d26-setting-bar"
                      data-tip={`${Math.round(share * 100)} % des Zeitraums vorbei`}
                    >
                      <em style={{ width: `${share * 100}%` }} />
                    </i>
                  </span>
                </div>
              );
            })}
            {!player.abos.length && (
              <p className="d26-empty">Kein aktueller Abo-Zeitraum.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
