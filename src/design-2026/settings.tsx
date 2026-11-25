"use client";
// Design 2026: Systemeinstellungen als iOS-Einstellungen. Oben Kacheln mit
// dem Stand auf einen Blick, darunter Chips nach Bereich und gruppierte
// Zeilen. Jede Zeile öffnet ein Detail-Sheet. Daten und Aktionen kommen
// unverändert aus den bisherigen Bausteinen (Funktionen, Spieler-API,
// Einladungswelle); Sicherheitsabfragen bleiben gleich oder werden strenger.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Ban,
  Bot,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Database,
  FileText,
  Inbox,
  MailCheck,
  MailX,
  MonitorPlay,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TriangleAlert,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import {
  FeatureNote,
  featureName,
  useFeatures,
  type Feature,
} from "@/components/platform-features";
import { usePlayerApiShare } from "@/components/player-api-share";
import {
  basisLabel,
  reasons,
  useInvitationWave,
  type Family,
} from "@/components/invitation-wave";
import { ShowcaseSettings } from "@/components/products/showcase-settings";
import "@/components/products/showcase-embed.css";
import { api } from "@/components/team";
import { Sheet } from "./ui";

type ApiState = ReturnType<typeof usePlayerApiShare>;
type WaveState = ReturnType<typeof useInvitationWave>;
type Area = "alle" | "funktionen" | "versand" | "daten" | "einladungen";
const AREA_KEY = "d26-settings-area-v1";

/** Funktionen, die Eltern direkt betreffen: Umschalten nur im Sheet. */
const CAREFUL = new Set(["parent_auto_mail", "product_shop"]);

const featureIcon: Record<string, [typeof Sparkles, string]> = {
  pai: [Sparkles, "purple"],
  pai_mascot: [Bot, "purple"],
  trial_training: [Trophy, "teal"],
  product_shop: [ShoppingBag, "orange"],
  parent_auto_mail: [MailCheck, "blue"],
};
const featureShort: Record<string, string> = {
  pai: "KI-Assistent im Portal",
  pai_mascot: "Figuren von PAiLTON",
  trial_training: "Anfragen, Bereiche und Mails",
  product_shop: "/produkte und neue Käufe",
  parent_auto_mail: "Training, Berichte, Stempelkarten",
};

const berlin = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function SettingsHub({
  isAdmin,
  notify,
  reportTime,
  setReportTime,
}: {
  isAdmin: boolean;
  notify: (message: string) => void;
  reportTime: string;
  setReportTime: (value: string) => void;
}) {
  const feat = useFeatures({ quiet: true });
  // Ein Zustand je Baustein: Kacheln, Gruppen und Sheets zeigen denselben Stand.
  const apiShare = usePlayerApiShare(notify);
  const wave = useInvitationWave();
  const [area, setAreaState] = useState<Area>("alle");
  const [sheet, setSheet] = useState<
    | { kind: "feature"; key: string }
    | { kind: "time" }
    | { kind: "api" }
    | { kind: "showcase" }
    | { kind: "list"; list: "invite" | "release" | "skipped" }
    | null
  >(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(AREA_KEY) as Area | null;
      if (saved) setAreaState(saved);
    } catch {
      /* Ohne Speicher startet die Seite mit „Alle“. */
    }
  }, []);
  const setArea = (a: Area) => {
    setAreaState(a);
    try {
      localStorage.setItem(AREA_KEY, a);
    } catch {
      /* Wahl gilt dann nur bis zum Neuladen. */
    }
  };
  const features = feat.features ?? [];
  const has = (key: string) => features.some((f) => f.key === key);
  const areas: { id: Area; label: string; count?: number }[] = [
    { id: "alle", label: "Alle" },
    ...(features.length
      ? [
          {
            id: "funktionen" as const,
            label: "Funktionen",
            count: features.filter((f) => f.enabled).length,
          },
        ]
      : []),
    { id: "versand", label: "Berichte & Versand" },
    ...(isAdmin
      ? [
          { id: "daten" as const, label: "Daten & Schnittstellen" },
          ...(wave.hidden
            ? []
            : [{ id: "einladungen" as const, label: "Einladungen" }]),
        ]
      : []),
  ];
  const current = areas.some((a) => a.id === area) ? area : "alle";
  const show = (a: Area) => current === "alle" || current === a;
  const openFeature = features.find(
    (f) => sheet?.kind === "feature" && f.key === sheet.key,
  );

  return (
    <div className="d26-experience d26-settings-hub">
      <SummaryTiles
        isAdmin={isAdmin}
        features={feat.features}
        reportTime={reportTime}
        onArea={setArea}
        onTime={() => setSheet({ kind: "time" })}
        onApi={() => setSheet({ kind: "api" })}
        apiShare={apiShare}
        wave={wave}
      />

      <nav className="d26-chips d26-set-chips" aria-label="Bereich wählen">
        {areas.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`d26-chip ${current === a.id ? "is-active" : ""}`}
            aria-pressed={current === a.id}
            onClick={() => setArea(a.id)}
          >
            {a.label}
            {a.count !== undefined && <em>{a.count} an</em>}
          </button>
        ))}
      </nav>

      {feat.error && (
        <p className="d26-set-alert" role="alert">
          <TriangleAlert size={16} /> {feat.error}
        </p>
      )}

      {show("funktionen") && features.length > 0 && (
        <div className="d26-settings-group">
          <h4>
            Funktionen
            <Link href="/admin/funktionen" className="d26-set-more">
              Eigene Seite <ChevronRight size={14} />
            </Link>
          </h4>
          <div className="d26-settings">
            {features.map((f) => (
              <FeatureRow
                key={f.key}
                feature={f}
                busy={feat.busy}
                locked={f.key === "pai_mascot" && !feat.paiActive}
                onOpen={() => setSheet({ kind: "feature", key: f.key })}
                onToggle={async () => {
                  if (CAREFUL.has(f.key))
                    return setSheet({ kind: "feature", key: f.key });
                  if (await feat.toggle(f))
                    notify(
                      `${featureName(f.key)} ${f.enabled ? "deaktiviert" : "aktiviert"}.`,
                    );
                }}
              />
            ))}
          </div>
          <p className="d26-set-foot">
            Änderungen gelten sofort für alle Benutzer. Mails an Eltern und der
            Shop lassen sich nur im Detail umschalten.
          </p>
        </div>
      )}

      {show("versand") && (
        <div className="d26-settings-group">
          <h4>Berichte & Versand</h4>
          <div className="d26-settings">
            <button
              type="button"
              className="d26-setting d26-set-line"
              onClick={() => setSheet({ kind: "time" })}
            >
              <span className="d26-setting-icon tone-purple">
                <Clock size={17} />
              </span>
              <span className="d26-setting-main">
                <b>PDF-Versandzeit</b>
                <small>Monatsberichte · Europe/Berlin</small>
              </span>
              <span className="d26-set-value">{reportTime} Uhr</span>
              <ChevronRight size={17} className="d26-chevron" />
            </button>
            {features
              .filter((f) => f.key === "parent_auto_mail")
              .map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="d26-setting d26-set-line"
                  onClick={() => setSheet({ kind: "feature", key: f.key })}
                >
                  <span className="d26-setting-icon tone-blue">
                    <MailCheck size={17} />
                  </span>
                  <span className="d26-setting-main">
                    <b>Mails an aktive Eltern</b>
                    <small>
                      {f.enabled
                        ? "Gehen automatisch an alle aktiven Eltern"
                        : "Nur an eingetragene Test-Adressen"}
                    </small>
                  </span>
                  <StatusPill on={f.enabled} />
                  <ChevronRight size={17} className="d26-chevron" />
                </button>
              ))}
            <div
              className="d26-setting d26-set-line is-info"
              data-tip="Eltern können Termine im MVP nicht selbst stornieren."
            >
              <span className="d26-setting-icon tone-grey">
                <Ban size={17} />
              </span>
              <span className="d26-setting-main">
                <b>Elternstornierung</b>
                <small>Abmelden nur über das Team</small>
              </span>
              <span className="d26-set-pill">Im MVP deaktiviert</span>
            </div>
            <div
              className="d26-setting d26-set-line is-info"
              data-tip="SMTP-Zugang, Stripe-Schlüssel und Cron-Secret liegen nur auf dem Server."
            >
              <span className="d26-setting-icon tone-grey">
                <Server size={17} />
              </span>
              <span className="d26-setting-main">
                <b>Versandmodus</b>
                <small>Zugangsdaten nur auf dem Server</small>
              </span>
              <span className="d26-set-pill">Serverkonfiguration</span>
            </div>
          </div>
          <p className="d26-set-foot">
            <ShieldCheck size={13} /> SMTP-Zugangsdaten, Stripe-Schlüssel und
            Cron-Secret werden ausschließlich auf dem Server hinterlegt.
          </p>
        </div>
      )}

      {isAdmin && show("daten") && (
        <DataGroup
          share={apiShare.share}
          error={apiShare.error}
          showcase={has("product_shop")}
          onApi={() => setSheet({ kind: "api" })}
          onShowcase={() => setSheet({ kind: "showcase" })}
        />
      )}

      {isAdmin && show("einladungen") && (
        <WaveGroup
          w={wave}
          onList={(list) => setSheet({ kind: "list", list })}
        />
      )}

      <FeatureSheet
        feature={openFeature}
        busy={feat.busy}
        error={feat.error}
        paiActive={feat.paiActive}
        onClose={() => setSheet(null)}
        onToggle={async (f) => {
          if (await feat.toggle(f)) {
            notify(
              `${featureName(f.key)} ${f.enabled ? "deaktiviert" : "aktiviert"}.`,
            );
          }
        }}
      />
      <TimeSheet
        open={sheet?.kind === "time"}
        value={reportTime}
        onClose={() => setSheet(null)}
        onSaved={(v) => {
          setReportTime(v);
          notify("Versandzeit gespeichert.");
        }}
      />
      {isAdmin && (
        <>
          <ApiSheet
            open={sheet?.kind === "api"}
            api={apiShare}
            onClose={() => setSheet(null)}
          />
          <Sheet
            open={sheet?.kind === "showcase"}
            onClose={() => setSheet(null)}
            eyebrow="Produkt-Shop"
            title="Produktbühne einbetten"
          >
            <div className="d26-set-embed">
              <ShowcaseSettings />
            </div>
          </Sheet>
          <WaveListSheet
            w={wave}
            list={sheet?.kind === "list" ? sheet.list : null}
            onClose={() => setSheet(null)}
          />
        </>
      )}
    </div>
  );
}

function StatusPill({
  on,
  labels,
}: {
  on: boolean;
  labels?: [string, string];
}) {
  return (
    <span className={`d26-set-pill ${on ? "is-on" : "is-off"}`}>
      <i aria-hidden="true" />
      {on ? (labels?.[0] ?? "An") : (labels?.[1] ?? "Aus")}
    </span>
  );
}

/* ---------- Kacheln ---------- */

function SummaryTiles({
  isAdmin,
  features,
  reportTime,
  onArea,
  onTime,
  onApi,
  apiShare,
  wave,
}: {
  isAdmin: boolean;
  features: Feature[] | null;
  reportTime: string;
  onArea: (a: Area) => void;
  onTime: () => void;
  onApi: () => void;
  apiShare: ApiState;
  wave: WaveState;
}) {
  const on = features?.filter((f) => f.enabled) ?? [];
  return (
    <div className="d26-set-tiles">
      {features && features.length > 0 && (
        <button
          type="button"
          className="d26-card d26-set-tile"
          onClick={() => onArea("funktionen")}
          data-tip={
            on.length
              ? `An: ${on.map((f) => featureName(f.key)).join(", ")}`
              : "Alle Funktionen sind aus."
          }
        >
          <Settings2 size={18} />
          <b>
            {on.length}
            <small>/{features.length}</small>
          </b>
          <span>Funktionen an</span>
          <i className="d26-set-meter" aria-hidden="true">
            <em style={{ width: `${(on.length / features.length) * 100}%` }} />
          </i>
        </button>
      )}
      <button
        type="button"
        className="d26-card d26-set-tile"
        onClick={onTime}
        data-tip="Uhrzeit, zu der die PDF-Berichte verschickt werden. Tippen zum Ändern."
      >
        <Clock size={18} />
        <b>{reportTime}</b>
        <span>PDF-Versand täglich</span>
      </button>
      {features?.some((f) => f.key === "parent_auto_mail") && (
        <ParentMailTile features={features} onArea={onArea} />
      )}
      {isAdmin && <ApiTile api={apiShare} onApi={onApi} />}
      {isAdmin && <WaveTile w={wave} onArea={onArea} />}
    </div>
  );
}

function ParentMailTile({
  features,
  onArea,
}: {
  features: Feature[];
  onArea: (a: Area) => void;
}) {
  const on = features.find((f) => f.key === "parent_auto_mail")?.enabled;
  return (
    <button
      type="button"
      className={`d26-card d26-set-tile ${on ? "is-on" : "is-off"}`}
      onClick={() => onArea("versand")}
      data-tip={
        on
          ? "Training-Mails gehen an alle aktiven Eltern."
          : "Training-Mails gehen nur an Test-Adressen."
      }
    >
      {on ? <MailCheck size={18} /> : <MailX size={18} />}
      <b>{on ? "An" : "Aus"}</b>
      <span>Mails an Eltern</span>
    </button>
  );
}

function ApiTile({
  api: { share, error },
  onApi,
}: {
  api: ApiState;
  onApi: () => void;
}) {
  return (
    <button
      type="button"
      className={`d26-card d26-set-tile ${share?.enabled ? "is-on" : "is-off"}`}
      onClick={onApi}
      data-tip="JSON-Export aller Kinder über einen geheimen Link."
    >
      <Database size={18} />
      <b>{share ? (share.enabled ? "Aktiv" : "Aus") : error ? "–" : "…"}</b>
      <span>Spieler-API</span>
    </button>
  );
}

function WaveTile({ w, onArea }: { w: WaveState; onArea: (a: Area) => void }) {
  if (w.hidden) return null;
  return (
    <button
      type="button"
      className="d26-card d26-set-tile"
      onClick={() => onArea("einladungen")}
      data-tip={
        w.data
          ? `${w.data.accepted} angenommen · ${w.data.skipped.length} ausgeschlossen`
          : "Einladungswelle wird geladen."
      }
    >
      <UserPlus size={18} />
      <b>{w.data ? w.invite : "…"}</b>
      <span>bereit zur Einladung</span>
    </button>
  );
}

/* ---------- Funktionen ---------- */

function FeatureRow({
  feature: f,
  busy,
  locked,
  onOpen,
  onToggle,
}: {
  feature: Feature;
  busy: boolean;
  locked: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const [Icon, tone] = featureIcon[f.key] ?? [Settings2, "grey"];
  return (
    <div
      className="d26-setting d26-set-line d26-set-row"
      data-feature={f.key}
      onClick={onOpen}
    >
      <span className={`d26-setting-icon tone-${tone}`}>
        <Icon size={17} />
      </span>
      <span className="d26-setting-main">
        <b>{featureName(f.key)}</b>
        <small>
          {locked
            ? "Zuerst PAiLTON aktivieren"
            : (featureShort[f.key] ?? "Globale Funktion")}
        </small>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={f.enabled}
        aria-label={`${featureName(f.key)} ${f.enabled ? "ausschalten" : "einschalten"}`}
        className={`d26-switch ${f.enabled ? "is-on" : ""}`}
        disabled={busy || locked}
        data-tip={
          CAREFUL.has(f.key)
            ? "Öffnet die Details zum sicheren Umschalten"
            : `Geändert ${berlin(f.updated_at)}`
        }
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <i />
      </button>
      <button
        type="button"
        className="d26-set-open"
        aria-label={`Details zu ${featureName(f.key)}`}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}

function FeatureSheet({
  feature: f,
  busy,
  error,
  paiActive,
  onClose,
  onToggle,
}: {
  feature?: Feature;
  busy: boolean;
  error: string;
  paiActive: boolean;
  onClose: () => void;
  onToggle: (f: Feature) => void;
}) {
  const [Icon, tone] = (f && featureIcon[f.key]) ?? [Settings2, "grey"];
  const locked = f?.key === "pai_mascot" && !paiActive;
  const careful = f && CAREFUL.has(f.key);
  return (
    <Sheet
      open={!!f}
      onClose={onClose}
      eyebrow="Funktion"
      title={f ? featureName(f.key) : ""}
      footer={
        f && (
          <button
            type="button"
            className={`d26-btn ${f.enabled ? "" : "is-primary"}`}
            disabled={busy || locked}
            onClick={() => onToggle(f)}
          >
            {busy
              ? "Wird gespeichert …"
              : f.enabled
                ? "Deaktivieren"
                : careful && f.key === "parent_auto_mail"
                  ? "Aktivieren · Mails an alle aktiven Eltern"
                  : "Aktivieren"}
          </button>
        )
      }
    >
      {f && (
        <>
          <div className={`d26-set-hero tone-${tone}`}>
            <span className="d26-setting-icon">
              <Icon size={22} />
            </span>
            <div>
              <StatusPill
                on={f.enabled}
                labels={["Aktiviert", "Deaktiviert"]}
              />
              <small>Zuletzt geändert {berlin(f.updated_at)} (Berlin)</small>
            </div>
          </div>
          {error && (
            <p className="d26-set-alert" role="alert">
              <TriangleAlert size={16} /> {error}
            </p>
          )}
          <div className="d26-set-note">
            <FeatureNote feature={f} paiActive={paiActive} />
            {![
              "product_shop",
              "parent_auto_mail",
              "trial_training",
              "pai_mascot",
            ].includes(f.key) && (
              <p className="muted">
                Änderungen gelten sofort für alle Benutzer.
              </p>
            )}
          </div>
          {f.key === "pai" && f.enabled && (
            <div className="d26-set-links">
              <Link href="/pai">PAiLTON öffnen</Link>
              <Link href="/admin/pai">PAiLTON verwalten</Link>
            </div>
          )}
          {careful && (
            <p className="d26-set-foot">
              <ShieldCheck size={13} /> Dieser Schalter betrifft Eltern direkt
              und lässt sich deshalb nur hier umschalten.
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}

/* ---------- Berichte ---------- */

function TimeSheet({
  open,
  value,
  onClose,
  onSaved,
}: {
  open: boolean;
  value: string;
  onClose: () => void;
  onSaved: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setDraft(value);
      setError("");
    }
  }, [open, value]);
  async function save() {
    if (!/^\d{2}:\d{2}$/.test(draft)) return setError("Bitte Uhrzeit wählen.");
    setBusy(true);
    setError("");
    try {
      await api("admin/system_settings", {
        key: "report_send_time",
        value: draft,
      });
      onSaved(draft);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow="Berichte & Versand"
      title="PDF-Versandzeit"
      footer={
        <button
          type="button"
          className="d26-btn is-primary"
          disabled={busy || draft === value}
          onClick={() => void save()}
        >
          {busy ? "Wird gespeichert …" : `Auf ${draft} Uhr speichern`}
        </button>
      }
    >
      <p className="muted">
        Zu dieser Uhrzeit (Europe/Berlin) werden fertige PDF-Berichte
        verschickt.
      </p>
      <label className="d26-set-time">
        <Clock size={20} />
        <input
          type="time"
          required
          aria-label="Versandzeit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <div className="d26-chips d26-set-chips" aria-label="Schnellauswahl">
        {["07:00", "08:00", "12:00", "17:00", "19:00"].map((t) => (
          <button
            key={t}
            type="button"
            className={`d26-chip ${draft === t ? "is-active" : ""}`}
            onClick={() => setDraft(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <p className="d26-set-alert" role="alert">
          <TriangleAlert size={16} /> {error}
        </p>
      )}
    </Sheet>
  );
}

/* ---------- Daten & Schnittstellen ---------- */

function DataGroup({
  share,
  error,
  showcase,
  onApi,
  onShowcase,
}: {
  share: ApiState["share"];
  error: string;
  showcase: boolean;
  onApi: () => void;
  onShowcase: () => void;
}) {
  return (
    <div className="d26-settings-group">
      <h4>Daten & Schnittstellen</h4>
      <div className="d26-settings">
        <button
          type="button"
          className="d26-setting d26-set-line"
          onClick={onApi}
        >
          <span className="d26-setting-icon tone-teal">
            <Database size={17} />
          </span>
          <span className="d26-setting-main">
            <b>Spieler-API</b>
            <small>
              {error
                ? "Nicht verfügbar"
                : "JSON-Export aller Kinder über geheimen Link"}
            </small>
          </span>
          {share ? (
            <StatusPill on={share.enabled} labels={["Aktiv", "Aus"]} />
          ) : (
            <span />
          )}
          <ChevronRight size={17} className="d26-chevron" />
        </button>
        {showcase && (
          <button
            type="button"
            className="d26-setting d26-set-line"
            onClick={onShowcase}
          >
            <span className="d26-setting-icon tone-orange">
              <MonitorPlay size={17} />
            </span>
            <span className="d26-setting-main">
              <b>Produktbühne einbetten</b>
              <small>Shop als Section auf der Website</small>
            </span>
            <span />
            <ChevronRight size={17} className="d26-chevron" />
          </button>
        )}
      </div>
    </div>
  );
}

const API_FIELDS = [
  "Spielername",
  "Elternteile",
  "Geburtsjahr",
  "Geschlecht",
  "Verein",
  "Position",
  "Starker Fuß",
  "Größe",
  "Entwicklungsziele",
  "Aktuelle Abos mit Zeitraum",
  "Aktive Monate",
  "Profil-Link",
];

function ApiSheet({
  open,
  api: { share, busy, error, change, copy },
  onClose,
}: {
  open: boolean;
  api: ApiState;
  onClose: () => void;
}) {
  const [ask, setAsk] = useState<"rotate" | "disable" | null>(null);
  useEffect(() => {
    if (!open) setAsk(null);
  }, [open]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow="Daten & Schnittstellen"
      title="Spieler-API"
      footer={
        share &&
        !share.enabled && (
          <button
            type="button"
            className="d26-btn is-primary"
            disabled={busy}
            onClick={() => void change("create")}
          >
            {busy ? "Wird erstellt …" : "Export-Link erstellen"}
          </button>
        )
      }
    >
      <div className="d26-set-hero tone-teal">
        <span className="d26-setting-icon">
          <Database size={22} />
        </span>
        <div>
          {share ? (
            <StatusPill on={share.enabled} labels={["Aktiv", "Deaktiviert"]} />
          ) : (
            <span className="d26-set-pill">
              {error ? "Nicht verfügbar" : "Wird geladen …"}
            </span>
          )}
          <small>
            Alle Kinder, auch archivierte, unabhängig vom Abo-Status. Jeder
            Abruf liefert den aktuellen Stand als JSON.
          </small>
        </div>
      </div>
      {error && (
        <p className="d26-set-alert" role="alert">
          <TriangleAlert size={16} /> {error}
        </p>
      )}
      {share?.enabled && share.url && (
        <>
          <h4>Export-Link</h4>
          <div className="d26-set-link">
            <input
              readOnly
              aria-label="Export-Link"
              value={share.url}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="d26-btn is-primary"
              disabled={busy}
              onClick={() => void copy()}
            >
              <Copy size={15} /> Kopieren
            </button>
          </div>
          <p className="d26-set-foot">
            <ShieldCheck size={13} /> Wer diesen Link besitzt, kann die
            Spielerdaten abrufen. Nur an vorgesehene Empfänger weitergeben.
          </p>
          {ask ? (
            <div className="d26-set-confirm" role="group">
              <p>
                {ask === "rotate"
                  ? "Neuen Link erstellen? Der bisherige Link wird sofort ungültig."
                  : "Spieler-API deaktivieren? Weitere Abrufe werden gesperrt."}
              </p>
              <div>
                <button
                  type="button"
                  className="d26-btn"
                  onClick={() => setAsk(null)}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  className="d26-btn is-danger"
                  disabled={busy}
                  onClick={async () => {
                    await change(ask);
                    setAsk(null);
                  }}
                >
                  {ask === "rotate" ? "Link erneuern" : "Deaktivieren"}
                </button>
              </div>
            </div>
          ) : (
            <div className="d26-set-actions">
              <button
                type="button"
                className="d26-btn"
                disabled={busy}
                onClick={() => setAsk("rotate")}
              >
                <RefreshCw size={15} /> Link erneuern
              </button>
              <button
                type="button"
                className="d26-btn"
                disabled={busy}
                onClick={() => setAsk("disable")}
              >
                <Ban size={15} /> Deaktivieren
              </button>
            </div>
          )}
        </>
      )}
      <h4>Enthalten</h4>
      <div className="d26-set-tags">
        {API_FIELDS.map((f) => (
          <span key={f}>{f}</span>
        ))}
      </div>
      <p className="muted">
        Aktive Monate: volle Abo-Monate plus ein Restmonat ab zehn aktiven
        Tagen. Pausen zählen nicht, Überschneidungen nicht doppelt. Profil-Links
        öffnen die Spielerkarte nach Admin-Anmeldung.
      </p>
    </Sheet>
  );
}

/* ---------- Einladungswelle ---------- */

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

function WaveGroup({
  w,
  onList,
}: {
  w: WaveState;
  onList: (list: "invite" | "release" | "skipped") => void;
}) {
  if (w.hidden) return null;
  const d = w.data;
  const created = w.sent,
    sentMails = d?.wave_jobs.sent ?? 0,
    accepted = d?.accepted ?? 0;
  const stats: {
    id?: "invite" | "release" | "skipped";
    n: number;
    label: string;
    tip: string;
    tone: string;
    icon: typeof Send;
  }[] = d
    ? [
        {
          id: "invite",
          n: w.invite,
          label: "Bekommen eine Einladung",
          tip: "Familien mit laufendem Abo oder aktuellem Camp, noch nicht verbunden. Tippen für die Liste.",
          tone: "purple",
          icon: Send,
        },
        {
          id: "release",
          n: w.releases,
          label: "Werden freigegeben",
          tip: "Schon verbunden, bekommen künftig Familienmails, aber keine Einladungsmail.",
          tone: "lime",
          icon: Users,
        },
        {
          id: "skipped",
          n: d.skipped.length,
          label: "Ausgeschlossen",
          tip: "Bitte von Hand klären (doppelt, ungültig, Team-Konto, schon eingeladen).",
          tone: "amber",
          icon: TriangleAlert,
        },
        {
          n: d.old_held_invitations,
          label: "Alte gesperrte Mails",
          tip: "Werden bei den Empfängern verworfen, nicht nachgeschickt.",
          tone: "grey",
          icon: Inbox,
        },
      ]
    : [];
  return (
    <div className="d26-settings-group" data-section="invitation-wave">
      <h4>Einladungswelle</h4>
      <section className="d26-card d26-wave">
        <p className="d26-wave-intro">
          Lädt alle Familien mit laufendem Abo und alle Familien des aktuellen
          Camps ins Elternportal ein, die noch nicht verbunden sind. Die
          Einladung ist 14 Tage gültig. Training-Mails, Selbstaktivierung und
          alle anderen Schalter bleiben unverändert. Zurückgehaltene alte Mails
          werden nicht nachgeschickt.
        </p>
        {w.error && (
          <p className="d26-set-alert" role="alert">
            <TriangleAlert size={16} /> {w.error}
          </p>
        )}
        {w.info && (
          <p className="d26-set-ok" role="status">
            <Check size={16} /> {w.info}
          </p>
        )}
        {!d && !w.error && <p className="muted">Wird geladen …</p>}
        {d && !d.delivery_enabled && (
          <p className="d26-set-alert" role="alert">
            <TriangleAlert size={16} /> Der Hauptschalter für Elternmails ist
            aus. Die Welle kann nicht starten.
          </p>
        )}
        {d && (
          <>
            <div className="d26-wave-stats">
              {stats.map((s) =>
                s.id && s.n > 0 ? (
                  <button
                    key={s.label}
                    type="button"
                    className={`d26-wave-stat tone-${s.tone}`}
                    data-tip={s.tip}
                    onClick={() => onList(s.id!)}
                  >
                    <s.icon size={16} />
                    <b>{s.n}</b>
                    <span>{s.label}</span>
                    <ChevronRight size={14} className="d26-chevron" />
                  </button>
                ) : (
                  <div
                    key={s.label}
                    className={`d26-wave-stat tone-${s.tone} is-static`}
                    data-tip={s.tip}
                  >
                    <s.icon size={16} />
                    <b>{s.n}</b>
                    <span>{s.label}</span>
                  </div>
                ),
              )}
            </div>
            {created > 0 && (
              <div
                className="d26-wave-progress"
                data-tip={`${created} erstellt · ${sentMails} verschickt · ${accepted} angenommen`}
              >
                <div className="d26-wave-progress-head">
                  <b>Bisherige Wellen</b>
                  <small>
                    {created} erstellt · {sentMails} verschickt · {accepted}{" "}
                    angenommen
                  </small>
                </div>
                <i>
                  <em
                    className="is-sent"
                    style={{ width: `${(sentMails / created) * 100}%` }}
                  />
                  <em
                    className="is-accepted"
                    style={{
                      width: `${(Math.min(accepted, created) / created) * 100}%`,
                    }}
                  />
                </i>
              </div>
            )}
            <ol className="d26-wave-steps">
              <li>
                <span className="d26-wave-step">1</span>
                <div>
                  <b>Testeinladung</b>
                  <small>
                    Geht nur an deine eigene Adresse. Der Knopf in der Mail
                    führt zur Anmeldung.
                  </small>
                </div>
                <button
                  type="button"
                  className="d26-btn"
                  disabled={w.busy || !d.delivery_enabled}
                  onClick={() => void w.test()}
                >
                  Testeinladung an mich
                </button>
              </li>
              <li>
                <span className="d26-wave-step is-final">2</span>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void w.start();
                  }}
                >
                  <div>
                    <b>Welle starten</b>
                    <small>
                      Kann nicht zurückgenommen werden. Zur Bestätigung die Zahl
                      der Empfänger ({w.invite}) eintragen.
                    </small>
                  </div>
                  <div className="d26-wave-confirm">
                    <input
                      inputMode="numeric"
                      aria-label="Anzahl der Empfänger bestätigen"
                      value={w.confirm}
                      onChange={(e) => w.setConfirm(e.target.value)}
                      placeholder={String(w.invite)}
                    />
                    <button
                      className="d26-btn is-danger"
                      disabled={!w.canStart}
                    >
                      Welle starten
                    </button>
                  </div>
                </form>
              </li>
            </ol>
          </>
        )}
      </section>
    </div>
  );
}

function WaveListSheet({
  w,
  list,
  onClose,
}: {
  w: WaveState;
  list: "invite" | "release" | "skipped" | null;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("alle");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    setSearch("");
    setFilter("alle");
    setOpen(null);
  }, [list]);
  const rows: Family[] = useMemo(
    () =>
      !w.data || !list
        ? []
        : list === "invite"
          ? w.data.invite
          : list === "release"
            ? w.data.release_holds
            : w.data.skipped,
    [w.data, list],
  );
  const key = (f: Family) =>
    list === "skipped" ? (f.reason ?? "sonstiges") : f.basis;
  const label = (k: string) =>
    list === "skipped" ? (reasons[k] ?? k) : basisLabel(k);
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((f) => {
      const k = list === "skipped" ? (f.reason ?? "sonstiges") : f.basis;
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return [...m.entries()];
  }, [rows, list]);
  const term = search.trim().toLocaleLowerCase("de-DE");
  const visible = rows.filter(
    (f) =>
      (filter === "alle" || key(f) === filter) &&
      (!term ||
        `${f.name} ${f.email}`.toLocaleLowerCase("de-DE").includes(term)),
  );
  const title =
    list === "invite"
      ? "Bekommen eine Einladung"
      : list === "release"
        ? "Werden freigegeben"
        : "Ausgeschlossen";
  return (
    <Sheet
      open={!!list}
      onClose={onClose}
      eyebrow={`Einladungswelle · ${rows.length} Familien`}
      title={title}
      wide
    >
      <label className="d26-archive-search">
        <Search size={16} aria-hidden="true" />
        <input
          aria-label="Familien durchsuchen"
          placeholder="Name oder E-Mail"
          value={search}
          maxLength={100}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {groups.length > 1 && (
        <div className="d26-chips d26-set-chips" aria-label="Filtern">
          <button
            type="button"
            className={`d26-chip ${filter === "alle" ? "is-active" : ""}`}
            onClick={() => setFilter("alle")}
          >
            Alle <em>{rows.length}</em>
          </button>
          {groups.map(([k, n]) => (
            <button
              key={k}
              type="button"
              className={`d26-chip ${filter === k ? "is-active" : ""}`}
              onClick={() => setFilter(k)}
            >
              {label(k)} <em>{n}</em>
            </button>
          ))}
        </div>
      )}
      <p className="d26-archive-count" role="status">
        {visible.length} von {rows.length} Familien
      </p>
      <div className="d26-settings d26-wave-list">
        {visible.map((f) => {
          const expanded = open === f.parent_id;
          return (
            <div key={f.parent_id} className="d26-wave-family">
              <button
                type="button"
                className="d26-setting d26-set-line"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : f.parent_id)}
              >
                <span
                  className={`d26-wave-avatar is-${list === "skipped" ? "skipped" : f.basis}`}
                >
                  {initials(f.name)}
                </span>
                <span className="d26-setting-main">
                  <b>{f.name}</b>
                  <small>{f.email}</small>
                </span>
                <span
                  className={`d26-set-pill is-${list === "skipped" ? "warn" : f.basis}`}
                >
                  {label(key(f))}
                </span>
                <ChevronRight
                  size={17}
                  className={`d26-chevron ${expanded ? "is-open" : ""}`}
                />
              </button>
              {expanded && (
                <dl className="d26-wave-detail">
                  <div>
                    <dt>E-Mail</dt>
                    <dd>
                      <a href={`mailto:${f.email}`}>{f.email}</a>
                    </dd>
                  </div>
                  <div>
                    <dt>Grundlage</dt>
                    <dd>{basisLabel(f.basis)}</dd>
                  </div>
                  {f.reason && (
                    <div>
                      <dt>Grund</dt>
                      <dd>{reasons[f.reason] ?? f.reason}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Was passiert</dt>
                    <dd>
                      {list === "invite"
                        ? "Bekommt beim Start eine Einladungsmail (14 Tage gültig)."
                        : list === "release"
                          ? "Keine Einladungsmail. Wird für Familienmails freigegeben."
                          : "Wird nicht eingeladen. Bitte Adresse oder Konto von Hand prüfen."}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          );
        })}
        {!visible.length && (
          <p className="d26-empty">
            <FileText size={16} /> Niemand in dieser Auswahl.
          </p>
        )}
      </div>
    </Sheet>
  );
}
