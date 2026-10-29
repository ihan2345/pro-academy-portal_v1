"use client";
import { ProductOperations } from "./operations";
import { EffectColorWheel } from "./color-wheel";
import Link from "next/link";
import { localToUtc } from "@/lib/domain";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Eye,
  Globe2,
  ImagePlus,
  Layers3,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import {
  audiences,
  channelLabels,
  kindLabels,
  statusLabels,
  emptyProduct,
  priceLabel,
  type Product,
  type ProductRecord,
  type Rule,
  type Audience,
  type Channel,
  type ProductContext,
} from "@/lib/products/domain";
import { scenarios } from "@/lib/products/simulation";
import {
  ProductCard,
  Hint,
  Toggle,
  SearchSelect,
  productRequest,
} from "./shared";
import { Modal } from "../portal";
const base = "/api/admin/products";
type Details = ProductRecord & { assets?: any[]; grants?: any[] };
function RuleEditor({
  value,
  onChange,
  title,
}: {
  value: Rule;
  onChange: (r: Rule) => void;
  title: string;
}) {
  const [advanced, setAdvanced] = useState(false);
  const simple =
    value.mode === "all" &&
    value.clauses.length === 1 &&
    value.clauses[0].scope === "player" &&
    value.clauses[0].mode === "any" &&
    value.clauses[0].include.length === 1 &&
    value.clauses[0].exclude.length === 0;
  const preset = simple ? value.clauses[0].include[0] : "custom";
  const change = (index: number, patch: Partial<Rule["clauses"][number]>) =>
    onChange({
      ...value,
      clauses: value.clauses.map((c, i) =>
        i === index ? { ...c, ...patch } : c,
      ),
    });
  return (
    <div className="product-rule">
      <label>
        {title}: Vorlage
        <select
          value={
            ["all", "new", "trial", "subscriber", "individual"].includes(preset)
              ? preset
              : "custom"
          }
          onChange={(e) => {
            if (e.target.value === "custom") {
              setAdvanced(true);
              return;
            }
            onChange({
              mode: "all",
              clauses: [
                {
                  scope: "player",
                  mode: "any",
                  include: [e.target.value as Audience],
                  exclude: [],
                },
              ],
            });
          }}
        >
          <option value="all">Alle</option>
          <option value="new">Nur Neukunden</option>
          <option value="trial">Nur Probetraining-Kunden</option>
          <option value="subscriber">Nur Abo-Kunden</option>
          <option value="individual">
            Nur individuell freigegebene Kunden
          </option>
          <option value="custom">Eigene erweiterte Regeln</option>
        </select>
      </label>
      <details
        open={advanced}
        onToggle={(e) => setAdvanced(e.currentTarget.open)}
      >
        <summary>
          Erweiterte Regeln · {value.clauses.length} Regelgruppe(n)
          {!simple ? " · eigene Konfiguration" : ""}
        </summary>
        <div className="product-rule-heading">
          <strong>{title}</strong>
          <Hint>
            ODER: eine Bedingung genügt. UND: alle Bedingungen müssen passen.
            Spielerbedingungen werden für dasselbe Kind geprüft. Ausschlüsse
            haben Vorrang.
          </Hint>
          <select
            aria-label={`${title}: Verknüpfung der Gruppen`}
            value={value.mode}
            onChange={(e) =>
              onChange({ ...value, mode: e.target.value as Rule["mode"] })
            }
          >
            <option value="all">Alle Gruppen (UND)</option>
            <option value="any">Eine Gruppe (ODER)</option>
          </select>
        </div>
        {value.clauses.map((clause, index) => (
          <div key={index} className="product-rule-clause">
            <div className="product-inline-fields">
              <label>
                Bezug
                <select
                  value={clause.scope}
                  onChange={(e) =>
                    change(index, {
                      scope: e.target.value as "family" | "player",
                    })
                  }
                >
                  <option value="player">Ausgewähltes Kind</option>
                  <option value="family">Ganze Familie</option>
                </select>
              </label>
              <label>
                Gruppenlogik
                <select
                  value={clause.mode}
                  onChange={(e) =>
                    change(index, { mode: e.target.value as "any" | "all" })
                  }
                >
                  <option value="any">ODER</option>
                  <option value="all">UND</option>
                </select>
              </label>
              {value.clauses.length > 1 && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Regelgruppe entfernen"
                  onClick={() =>
                    onChange({
                      ...value,
                      clauses: value.clauses.filter((_, i) => i !== index),
                    })
                  }
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <div
              className="product-audiences"
              aria-label={`${title}: Zielgruppen`}
            >
              {(Object.entries(audiences) as [Audience, string][]).map(
                ([key, label]) => (
                  <label
                    key={key}
                    className={clause.include.includes(key) ? "selected" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={clause.include.includes(key)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? key === "all"
                            ? ["all" as Audience]
                            : [
                                ...clause.include.filter((k) => k !== "all"),
                                key,
                              ]
                          : clause.include.filter((k) => k !== key);
                        change(index, {
                          include: next.length ? next : ["all"],
                        });
                      }}
                    />
                    {label}
                  </label>
                ),
              )}
            </div>
            <details>
              <summary>Ausschlüsse ({clause.exclude.length})</summary>
              <div className="product-audiences exclusions">
                {(Object.entries(audiences) as [Audience, string][])
                  .filter(([k]) => k !== "all")
                  .map(([key, label]) => (
                    <label
                      key={key}
                      className={clause.exclude.includes(key) ? "selected" : ""}
                    >
                      <input
                        type="checkbox"
                        checked={clause.exclude.includes(key)}
                        onChange={(e) =>
                          change(index, {
                            exclude: e.target.checked
                              ? [...clause.exclude, key]
                              : clause.exclude.filter((k) => k !== key),
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
              </div>
            </details>
          </div>
        ))}
        <button
          type="button"
          className="text-button"
          disabled={value.clauses.length >= 12}
          onClick={() =>
            onChange({
              ...value,
              clauses: [
                ...value.clauses,
                { scope: "player", mode: "any", include: ["all"], exclude: [] },
              ],
            })
          }
        >
          + Regelgruppe ergänzen
        </button>
      </details>
    </div>
  );
}
function localDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(value))
    .replace(" ", "T");
}
// Parse wall times in the established Academy zone, independently of device zone.
function berlinDate(value: string) {
  if (!value) return null;
  try {
    const [date, time] = value.split("T");
    return new Date(localToUtc(date, time)).toISOString();
  } catch {
    throw new Error(
      "Diese Berliner Uhrzeit ist wegen der Zeitumstellung ungültig oder mehrdeutig. Bitte eine andere Uhrzeit wählen.",
    );
  }
}
export function AdminProducts() {
  const [rows, setRows] = useState<ProductRecord[]>([]),
    [next, setNext] = useState<string | null>(null),
    [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [search, setSearch] = useState(""),
    [kind, setKind] = useState(""),
    [status, setStatus] = useState(""),
    [category, setCategory] = useState(""),
    [channel, setChannel] = useState("");
  const [editing, setEditing] = useState<Details | null>(null),
    [data, setData] = useState<Product | null>(null),
    [refs, setRefs] = useState<any>({ plans: [], offers: [] });
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [impact, setImpact] = useState<any>(null);
  const [priceId, setPriceId] = useState(""),
    [productId, setProductId] = useState(""),
    [scenario, setScenario] = useState<keyof typeof scenarios>("trial"),
    [previewChannel, setPreviewChannel] = useState<Channel>("catalog"),
    [previewPlayer, setPreviewPlayer] = useState(""),
    [preview, setPreview] = useState<any>(null);
  const [families, setFamilies] = useState<any[]>([]),
    [familySearch, setFamilySearch] = useState(""),
    [familyNext, setFamilyNext] = useState<string | null>(null),
    [grantParent, setGrantParent] = useState(""),
    [grantPlayer, setGrantPlayer] = useState(""),
    [grantPurpose, setGrantPurpose] = useState("purchase"),
    [grantReason, setGrantReason] = useState(""),
    [grantExpiry, setGrantExpiry] = useState("");
  const [grantImpact, setGrantImpact] = useState<any>(null);
  const [actualFamily, setActualFamily] = useState("");
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (data?.kind !== "other" && grantPurpose === "usage")
      setGrantPurpose("purchase");
  }, [data?.kind, grantPurpose]);
  const cursor = cursors.at(-1);
  async function list() {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({
        q: search,
        kind,
        status,
        category,
        channel,
      });
      if (cursor) q.set("cursor", cursor);
      const r = await productRequest(`${base}?${q}`);
      setRows(r.rows);
      setNext(r.next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const t = setTimeout(() => void list(), 250);
    return () => clearTimeout(t);
  }, [search, kind, status, category, channel, cursor]);
  useEffect(() => {
    void productRequest(`${base}/references`)
      .then(setRefs)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void productRequest(`${base}/preview`, "POST", {
        id: editing?.id,
        data,
        scenario,
        channel: previewChannel,
        ...(actualFamily ? { parent_id: actualFamily } : {}),
        ...(previewPlayer ? { player_id: previewPlayer } : {}),
      })
        .then((r) => {
          if (!cancelled) setPreview(r);
        })
        .catch((e) => {
          if (!cancelled) setPreview({ error: e.message });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    data,
    scenario,
    previewChannel,
    previewPlayer,
    actualFamily,
    editing?.id,
  ]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  useEffect(() => {
    const t = setTimeout(
      () =>
        void productRequest(
          `${base}/families?q=${encodeURIComponent(familySearch)}`,
        )
          .then((r) => {
            setFamilies(r.rows);
            setFamilyNext(r.next);
          })
          .catch(() => {}),
      250,
    );
    return () => clearTimeout(t);
  }, [familySearch]);
  function updateDate(key: "publish_at" | "expires_at", value: string) {
    try {
      update({ [key]: berlinDate(value) });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function update(patch: Partial<Product>) {
    setData((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    setImpact(null);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(id?: string) {
    await run(async () => {
      const p = id ? await productRequest<Details>(`${base}/${id}`) : null;
      const draft = { ...emptyProduct(), ...p?.draft };
      setEditing(p);
      setData(draft);
      setPriceId(draft.price?.id ?? "");
      setProductId(draft.price?.product_id ?? "");
      setDirty(false);
      setImpact(null);
      setActualFamily("");
      setPreviewPlayer("");
    });
  }
  async function persist() {
    if (!data) throw Error("Produkt fehlt");
    const p = await productRequest<Details>(
      editing ? `${base}/${editing.id}` : base,
      editing ? "PATCH" : "POST",
      { data, ...(editing ? { revision: editing.revision } : {}) },
    );
    setEditing(p);
    setData(p.draft);
    setDirty(false);
    setImpact(null);
    return p;
  }
  async function upload(file: File) {
    await run(async () => {
      const p = editing ?? (await persist());
      const r = await fetch(`${base}/${p.id}/assets`, {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "X-Image-Alt": encodeURIComponent(data?.name ?? ""),
        },
        body: file,
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error);
      update({ asset_ids: [...(data?.asset_ids ?? []), v.id] });
      setNotice(
        "Bild komprimiert und hochgeladen. Entwurf speichern, um es zu übernehmen.",
      );
    });
  }
  function changeFilter(fn: () => void) {
    setCursors([null]);
    fn();
  }
  if (!data)
    return (
      <div className="products-admin">
        <div className="product-heading">
          <div>
            <div className="eyebrow">PROACADEMY VERWALTUNG</div>
            <Link href="/admin/produkte/tarife">
              Tarife & Trainingseinheiten verwalten →
            </Link>
            <h1>
              Produkte<span className="greeting-dot">.</span>
            </h1>
            <p>Ein Katalog. Alle Angebote. Die richtigen Familien.</p>
          </div>
          <button className="primary-button" onClick={() => void open()}>
            <Plus size={18} /> Produkt anlegen
          </button>
        </div>
        <ProductOperations admin />
        <div className="product-summary">
          <div>
            <ShoppingBag size={23} />
            <span>
              <strong>Zentral verwalten</strong>
              <small>Abonnements, Camps und weitere Angebote</small>
            </span>
          </div>
          <div>
            <ShieldCheck size={23} />
            <span>
              <strong>Gezielt freigeben</strong>
              <small>Sichtbarkeit, Kauf und Nutzung getrennt</small>
            </span>
          </div>
          <div>
            <Layers3 size={23} />
            <span>
              <strong>Sicher veröffentlichen</strong>
              <small>Entwurf und veröffentlichte Version</small>
            </span>
          </div>
        </div>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <section className="product-list panel">
          <div className="product-filters">
            <label className="product-search">
              <Search size={18} />
              <input
                type="search"
                aria-label="Produkte durchsuchen"
                placeholder="Produkte durchsuchen …"
                value={search}
                onChange={(e) => changeFilter(() => setSearch(e.target.value))}
              />
            </label>
            <select
              aria-label="Produktart filtern"
              value={kind}
              onChange={(e) => changeFilter(() => setKind(e.target.value))}
            >
              <option value="">Alle Produktarten</option>
              {Object.entries(kindLabels).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
            <select
              aria-label="Status filtern"
              value={status}
              onChange={(e) => changeFilter(() => setStatus(e.target.value))}
            >
              <option value="">Alle Status</option>
              {Object.entries(statusLabels).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              aria-label="Kategorie filtern"
              placeholder="Kategorie"
              value={category}
              onChange={(e) => changeFilter(() => setCategory(e.target.value))}
            />
            <select
              aria-label="Anzeigeort filtern"
              value={channel}
              onChange={(e) => changeFilter(() => setChannel(e.target.value))}
            >
              <option value="">Alle Anzeigeorte</option>
              {Object.entries(channelLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="product-table-heading">
            <span>ANGEBOT</span>
            <span>PREIS & INTERVALL</span>
            <span>VERÖFFENTLICHUNG</span>
          </div>
          {loading ? (
            <div className="product-empty" role="status">
              <LoaderCircle className="product-spin" /> Produkte werden geladen
              …
            </div>
          ) : rows.length ? (
            rows.map((p) => (
              <button
                key={p.id}
                className="product-list-row"
                onClick={() => void open(p.id)}
              >
                <span className={`product-row-icon ${p.kind}`}>
                  <ShoppingBag size={23} />
                </span>
                <span className="product-row-name">
                  <strong>{p.draft.name}</strong>
                  <small>
                    {kindLabels[p.draft.kind]}
                    {p.draft.category ? ` · ${p.draft.category}` : ""}
                  </small>
                </span>
                <span className="product-row-price">
                  {priceLabel(p.draft.price)}
                </span>
                <span>
                  <span className={`product-status ${p.status}`}>
                    {statusLabels[p.status]}
                  </span>
                  {p.published_revision !== p.revision && (
                    <small className="product-draft-note">
                      Entwurf geändert
                    </small>
                  )}
                </span>
                <ChevronRight size={18} />
              </button>
            ))
          ) : (
            <div className="product-empty">
              <ShoppingBag size={36} />
              <h3>
                {search || kind || status
                  ? "Keine passenden Produkte"
                  : "Dein Katalog beginnt hier"}
              </h3>
              <p>Lege dein erstes Produkt an oder passe die Filter an.</p>
              <button className="primary-button" onClick={() => void open()}>
                <Plus size={16} /> Produkt anlegen
              </button>
            </div>
          )}
          <div className="product-pagination">
            <span>
              Seite {cursors.length} · {rows.length} Angebote
            </span>
            <div>
              <button
                className="secondary-button"
                disabled={cursors.length <= 1 || loading}
                onClick={() => setCursors((c) => c.slice(0, -1))}
              >
                Zurück
              </button>
              <button
                className="secondary-button"
                disabled={!next || loading}
                onClick={() => setCursors((c) => [...c, next])}
              >
                Weiter <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </section>
        <p className="product-footnote">
          Änderungen werden zuerst als Entwurf gespeichert. Bestehende Verträge
          und Trainingskontingente bleiben durch Veröffentlichungsänderungen
          erhalten.
        </p>
      </div>
    );
  const previewChildren: ProductContext["children"] =
    preview?.context?.children ?? [];
  return (
    <div className="products-admin">
      <div className="product-editor-top">
        <button
          className="text-button"
          onClick={() => {
            if (
              dirty &&
              !window.confirm("Ungespeicherte Änderungen verwerfen?")
            )
              return;
            setData(null);
            setEditing(null);
            setImpact(null);
            void list();
          }}
        >
          <ArrowLeft size={17} /> Alle Produkte
        </button>
        <span className="product-status draft">
          {dirty
            ? "Ungespeicherter Entwurf"
            : editing
              ? `Revision ${editing.revision}`
              : "Neues Produkt"}
        </span>
      </div>
      <div className="product-heading">
        <div>
          <div className="eyebrow">PRODUKT BEARBEITEN</div>
          <h1>
            {data.name}
            <span className="greeting-dot">.</span>
          </h1>
          <p>Gestalte dein Angebot. Steuere, wer es sehen und kaufen darf.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="product-success">
          <Check size={17} />
          {notice}
        </p>
      )}
      <div className="product-editor-grid">
        <div className="product-editor-fields">
          <section className="product-section panel">
            <div className="product-section-title">
              <span>01</span>
              <div>
                <h2>Das Angebot</h2>
                <p>Ein klarer Name und die passende Produktart.</p>
              </div>
            </div>
            <div className="product-kind-cards">
              {Object.entries(kindLabels).map(([k, label]) => (
                <button
                  type="button"
                  key={k}
                  aria-pressed={data.kind === k}
                  className={data.kind === k ? "selected" : ""}
                  onClick={() => {
                    update({
                      kind: k as Product["kind"],
                      price: null,
                      plan_id: null,
                      camp_offer_id: null,
                    });
                    setPriceId("");
                    setProductId("");
                  }}
                >
                  <ShoppingBag size={23} />
                  <strong>{label}</strong>
                  {data.kind === k && <Check size={16} />}
                </button>
              ))}
            </div>
            <div className="product-inline-fields">
              <label>
                Produktname
                <input
                  value={data.name}
                  maxLength={160}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </label>
              <label>
                Interner Name{" "}
                <Hint>
                  Nur für die Verwaltung. Der fachliche Tarifname bleibt davon
                  getrennt.
                </Hint>
                <input
                  value={data.internal_name}
                  onChange={(e) => update({ internal_name: e.target.value })}
                />
              </label>
            </div>
            <label>
              Kurzbeschreibung
              <textarea
                rows={2}
                maxLength={300}
                value={data.short_description}
                onChange={(e) => update({ short_description: e.target.value })}
              />
              <small>{data.short_description.length}/300 Zeichen</small>
            </label>
            <label>
              Beschreibung
              <textarea
                rows={5}
                value={data.description}
                onChange={(e) => update({ description: e.target.value })}
              />
            </label>
            <div className="product-inline-fields">
              <label>
                Kategorie
                <input
                  value={data.category}
                  onChange={(e) => update({ category: e.target.value })}
                  placeholder="Zum Beispiel Fußballtraining"
                />
              </label>
              <label>
                Priorität (0–10){" "}
                <Hint>
                  Höhere Zahlen erscheinen zuerst. Bei gleicher Priorität steht
                  das zuletzt erstellte Produkt vorne.
                </Hint>
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={1}
                  value={data.priority}
                  onChange={(e) =>
                    update({
                      priority: Math.max(
                        0,
                        Math.min(10, Math.round(Number(e.target.value))),
                      ),
                    })
                  }
                />
              </label>
            </div>
            <EffectColorWheel
              value={data.effect_color}
              onChange={(effect_color) => update({ effect_color })}
            />
            <div className="product-sale-settings">
              <Toggle
                checked={data.sale_enabled}
                label="Aktionspreis"
                hint={
                  data.sale_enabled
                    ? "Ja · Für die ausgewählten Kundenarten"
                    : "Nein · Regulärer Preis"
                }
                onChange={(sale_enabled) => update({ sale_enabled })}
              />
              {data.sale_enabled && (
                <fieldset className="product-sale-audiences">
                  <legend>Für welche Kundenarten gilt der Aktionspreis?</legend>
                  <details className="product-multiselect">
                    <summary>
                      {data.sale_audiences.length
                        ? data.sale_audiences
                            .map((key) => audiences[key])
                            .join(", ")
                        : "Kundenarten auswählen"}
                      <ChevronRight size={16} />
                    </summary>
                    <div className="product-multiselect-options">
                      {(Object.entries(audiences) as [Audience, string][]).map(
                        ([key, label]) => (
                          <label key={key}>
                            <input
                              type="checkbox"
                              checked={data.sale_audiences.includes(key)}
                              onChange={(e) =>
                                update({
                                  sale_audiences: e.target.checked
                                    ? [...data.sale_audiences, key]
                                    : data.sale_audiences.filter(
                                        (a) => a !== key,
                                      ),
                                })
                              }
                            />
                            <span>{label}</span>
                            {data.sale_audiences.includes(key) && (
                              <Check size={15} />
                            )}
                          </label>
                        ),
                      )}
                    </div>
                  </details>
                  <small>
                    Mehrfachauswahl möglich. Kennzeichnet den hinterlegten Preis
                    als Aktionspreis für diese Kundenarten.
                  </small>
                </fieldset>
              )}
            </div>
            <Toggle
              checked={data.featured}
              label="Produkt hervorheben"
              hint="Kennzeichnet das Angebot als Empfehlung."
              onChange={(v) => update({ featured: v })}
            />
            {data.kind === "other" && (
              <Toggle
                label="Mehrfach kaufbar"
                hint="Ein weiterer Kauf ist auch nach einer bestätigten Buchung möglich."
                checked={data.repeatable}
                onChange={(v) => update({ repeatable: v })}
              />
            )}
          </section>
          <section className="product-section panel">
            <div className="product-section-title">
              <span>02</span>
              <div>
                <h2>Bilder</h2>
                <p>Hauptbild und Galerie für dein Angebot.</p>
              </div>
              <Hint>
                JPEG, PNG oder WebP, maximal 8 MiB und 24 Megapixel. Bilder
                werden geprüft, von Metadaten bereinigt und komprimiert. Interne
                Bilder bleiben zugriffsgeschützt.
              </Hint>
            </div>
            <div className="product-gallery">
              {data.asset_ids.map((id, i) => (
                <div key={id} className="product-gallery-item">
                  <img
                    src={`/api/products/image/${id}`}
                    alt={`${data.name} – Bild ${i + 1}`}
                    width={240}
                    height={150}
                  />
                  <span>{i === 0 ? "Hauptbild" : `Bild ${i + 1}`}</span>
                  <div>
                    {i > 0 && (
                      <button
                        type="button"
                        aria-label="Als Hauptbild verwenden"
                        onClick={() =>
                          update({
                            asset_ids: [
                              id,
                              ...data.asset_ids.filter((a) => a !== id),
                            ],
                          })
                        }
                      >
                        <ArrowLeft size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Bild ${i + 1} entfernen`}
                      onClick={() =>
                        update({
                          asset_ids: data.asset_ids.filter((a) => a !== id),
                        })
                      }
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              ))}
              <button
                className="product-upload"
                disabled={busy || data.asset_ids.length >= 20}
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus size={28} />
                <strong>Bild hinzufügen</strong>
                <small>JPEG, PNG, WebP</small>
              </button>
              <input
                ref={fileRef}
                hidden
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
            </div>
            <small>
              Entfernte Bilder bleiben erhalten, solange eine gespeicherte
              Produktversion sie verwendet.
            </small>
          </section>
          <section className="product-section panel">
            <div className="product-section-title">
              <span>03</span>
              <div>
                <h2>Stripe & Leistung</h2>
                <p>Ein geprüfter Preis. Eine eindeutige Zuordnung.</p>
              </div>
              <Hint>
                Preis, Währung und Intervall stammen aus Stripe. Hier sind
                Stripe-Objekte der jeweiligen Serverumgebung erlaubt.
              </Hint>
            </div>
            {(data.kind === "subscription" || data.kind === "camp") && (
              <div className="product-inline-fields">
                {(data.kind === "subscription"
                  ? [
                      ["football_hours", "Fußball-Zeitstunden pro Monat"],
                      [
                        "athletics_hours",
                        "Zusätzliche Athletik-Zeitstunden pro Monat",
                      ],
                    ]
                  : [["camp_hours", "Gesamttrainingsstunden im Camp"]]
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      min="0"
                      max="10000"
                      step="0.25"
                      value={
                        data.training_content?.[
                          key as keyof Product["training_content"]
                        ] ?? ""
                      }
                      onChange={(e) =>
                        update({
                          training_content: {
                            ...(data.training_content ?? {
                              football_hours: null,
                              athletics_hours: null,
                              camp_hours: null,
                            }),
                            [key]:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
                <small>
                  Zusätzliche Zeitangaben zum Angebot. Bestehende
                  Trainingskontingente zählen weiterhin Einheiten; diese Angaben
                  ändern keine erworbenen Ansprüche.
                </small>
              </div>
            )}
            {data.kind === "subscription" && (
              <>
                <Link href="/admin/produkte/tarife">
                  Fachpläne und Trainingseinheiten pflegen →
                </Link>
                <SearchSelect
                  label="Bestehender Fachplan"
                  value={data.plan_id ?? ""}
                  options={refs.plans.map((p: any) => ({
                    value: p.id,
                    label: `${p.name} · ${p.generation} · ${p.included_units} Einheiten${p.athletics_units ? ` (${p.athletics_units} Athletik)` : ""} · ${p.billing_interval}`,
                  }))}
                  onChange={(value) => {
                    const p = refs.plans.find((p: any) => p.id === value);
                    update({ plan_id: value || null, price: null });
                    setPriceId(p?.stripe_price_id ?? "");
                  }}
                />
                <p className="product-muted">
                  Die vorhandenen Kontingent- und Bestandsregeln gelten
                  weiterhin. Ein neuer Anzeigename ändert keinen Fachplan.
                </p>
              </>
            )}
            {data.kind === "camp" && (
              <SearchSelect
                label="Campangebot"
                value={data.camp_offer_id ?? ""}
                options={refs.offers.map((o: any) => ({
                  value: o.id,
                  label: `${o.camps.title} · ${o.kind === "early" ? "Frühbucher" : "Normalangebot"} · ${o.camps.status}`,
                }))}
                onChange={(value) => {
                  const o = refs.offers.find((o: any) => o.id === value);
                  update({ camp_offer_id: value || null, price: null });
                  setPriceId(o?.stripe_price_id ?? "");
                  setProductId(o?.stripe_product_id ?? "");
                }}
              />
            )}
            <div className="product-inline-fields">
              <label>
                Stripe Price-ID
                <input
                  value={priceId}
                  placeholder="price_…"
                  onChange={(e) => {
                    setPriceId(e.target.value);
                    if (data.price) update({ price: null });
                  }}
                />
              </label>
              <label>
                Stripe Product-ID <small>Optionaler Gegencheck</small>
                <input
                  value={productId}
                  placeholder="prod_…"
                  onChange={(e) => {
                    setProductId(e.target.value);
                    if (data.price) update({ price: null });
                  }}
                />
              </label>
            </div>
            <button
              className="secondary-button"
              disabled={busy || !priceId}
              onClick={() =>
                void run(async () => {
                  const price = await productRequest(
                    `${base}/validate-price`,
                    "POST",
                    {
                      id: priceId,
                      kind: data.kind,
                      ...(productId ? { product_id: productId } : {}),
                    },
                  );
                  update({ price });
                  setProductId(price.product_id);
                  setNotice("Stripe-Preis erfolgreich geprüft.");
                })
              }
            >
              <ShieldCheck size={17} /> Preis prüfen
            </button>
            {data.price && (
              <div className="product-price-proof">
                <Check size={20} />
                <div>
                  <strong>{priceLabel(data.price)}</strong>
                  <small>
                    {data.price.product_name} ·{" "}
                    {data.price.source === "fixture"
                      ? "Beispieldaten, nicht verifiziert"
                      : data.price.livemode
                        ? "Stripe-Livemodus · geprüft"
                        : "Stripe-Testmodus · geprüft"}{" "}
                    {new Date(data.price.checked_at).toLocaleString("de-DE")}
                  </small>
                </div>
              </div>
            )}
          </section>
          <section className="product-section panel">
            <div className="product-section-title">
              <span>04</span>
              <div>
                <h2>Zielgruppen & Rechte</h2>
                <p>
                  Sichtbarkeit und Kauf steuern. Nutzungsrechte folgen der
                  Produktart.
                </p>
              </div>
            </div>
            {(
              [
                ["visibility", "Sichtbarkeit"],
                ["purchase", "Kaufberechtigung"],
                ...(data.kind === "other"
                  ? [["usage", "Produktnutzung"] as const]
                  : []),
              ] as const
            ).map(([key, title]) => (
              <RuleEditor
                key={key}
                title={title}
                value={data.rules[key]}
                onChange={(rule) =>
                  update({ rules: { ...data.rules, [key]: rule } })
                }
              />
            ))}
            <p className="product-muted">
              Bei Abos und Camps wird die Nutzung ausschließlich aus gültigen
              Verträgen und bezahlten Buchungen bestimmt. Bereits erworbene Abo-
              und Camprechte bleiben durch die jeweiligen Fachmodelle geschützt.
              Änderungen an der Shopfreigabe ändern keine bestehenden Verträge.
            </p>
            <details className="product-grants">
              <summary>
                Individuelle Freigaben{" "}
                <Hint>
                  Freigaben erfüllen die Zielgruppe „Individuell freigegeben“.
                  Sie überschreiben keine Ausschlüsse, inaktiven Produkte oder
                  fremden Kinderzuordnungen.
                </Hint>
              </summary>
              {!editing ? (
                <p>Speichere das Produkt zuerst als Entwurf.</p>
              ) : (
                <>
                  <label>
                    Familie suchen
                    <input
                      value={familySearch}
                      placeholder="Name der Familie"
                      onChange={(e) => setFamilySearch(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Familie für individuelle Freigabe"
                    value={grantParent}
                    onChange={(e) => {
                      setGrantParent(e.target.value);
                      setActualFamily(e.target.value);
                      setGrantPlayer("");
                      setPreviewPlayer("");
                    }}
                  >
                    <option value="">Familie auswählen</option>
                    {families.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.full_name}
                      </option>
                    ))}
                  </select>
                  {familyNext && (
                    <button
                      className="text-button"
                      onClick={() =>
                        void productRequest(
                          `${base}/families?q=${encodeURIComponent(familySearch)}&after=${familyNext}`,
                        ).then((r) => {
                          setFamilies((f) => [...f, ...r.rows]);
                          setFamilyNext(r.next);
                        })
                      }
                    >
                      Weitere Familien laden
                    </button>
                  )}
                  <div className="product-inline-fields">
                    <label>
                      Bezug
                      <select
                        value={grantPlayer}
                        onChange={(e) => setGrantPlayer(e.target.value)}
                      >
                        <option value="">Ganze Familie</option>
                        {actualFamily === grantParent &&
                          previewChildren.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Recht
                      <select
                        value={grantPurpose}
                        onChange={(e) => setGrantPurpose(e.target.value)}
                      >
                        <option value="visibility">Sichtbarkeit</option>
                        <option value="purchase">Kauf</option>
                        {data.kind === "other" && (
                          <option value="usage">
                            Nutzung nach abgeschlossenem Kauf
                          </option>
                        )}
                      </select>
                    </label>
                  </div>
                  <label>
                    Begründung
                    <input
                      value={grantReason}
                      onChange={(e) => setGrantReason(e.target.value)}
                    />
                  </label>
                  <label>
                    Gültig bis (Europe/Berlin, optional)
                    <input
                      type="datetime-local"
                      value={grantExpiry}
                      onChange={(e) => setGrantExpiry(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={
                      !grantParent || grantReason.trim().length < 3 || busy
                    }
                    onClick={() =>
                      void run(async () => {
                        setGrantImpact(
                          await productRequest(
                            `${base}/${editing.id}/grants-preview`,
                            "POST",
                            {
                              action: "add",
                              data: {
                                parent_id: grantParent,
                                player_id: grantPlayer || null,
                                purpose: grantPurpose,
                                expires_at: berlinDate(grantExpiry),
                                reason: grantReason,
                              },
                            },
                          ),
                        );
                      })
                    }
                  >
                    Freigabe prüfen
                  </button>
                  {editing.grants?.map((g) => (
                    <div className="product-grant-row" key={g.id}>
                      <span>
                        {g.purpose} · {g.reason}
                        <small>
                          {g.player_id ? "Für ein Kind" : "Für die Familie"}
                          {g.expires_at
                            ? ` · bis ${localDate(g.expires_at)}`
                            : ""}
                        </small>
                      </span>
                      <button
                        className="icon-button"
                        aria-label="Freigabe entfernen"
                        onClick={() =>
                          void run(async () => {
                            setGrantImpact(
                              await productRequest(
                                `${base}/${editing.id}/grants-preview`,
                                "POST",
                                { action: "remove", grant_id: g.id },
                              ),
                            );
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </details>
          </section>
          <section className="product-section panel">
            <div className="product-section-title">
              <span>05</span>
              <div>
                <h2>Veröffentlichung</h2>
                <p>Bestimme, wann und wo dein Angebot erscheint.</p>
              </div>
            </div>
            <label>
              Status
              <select
                aria-label="Status"
                value={data.status}
                onChange={(e) =>
                  update({ status: e.target.value as Product["status"] })
                }
              >
                {Object.entries(statusLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {data.status === "exclusive" && (
              <p className="info-note">
                Exklusive Angebote benötigen eine eingeschränkte Sichtbarkeit,
                z. B. „Nur individuell freigegebene Kunden“. Eine offene Auswahl
                „Alle/Besucher“ verhindert die Veröffentlichung.
              </p>
            )}
            <div className="product-channel-list">
              {(Object.entries(channelLabels) as [Channel, string][]).map(
                ([key, label]) => (
                  <Toggle
                    key={key}
                    label={label}
                    checked={data.channels.includes(key)}
                    onChange={(v) =>
                      update({
                        channels: v
                          ? [...data.channels, key]
                          : data.channels.filter((c) => c !== key),
                      })
                    }
                  />
                ),
              )}
            </div>
            <div className="product-inline-fields">
              <label>
                Veröffentlichung (Europe/Berlin)
                <input
                  type="datetime-local"
                  value={localDate(data.publish_at)}
                  onChange={(e) => updateDate("publish_at", e.target.value)}
                />
              </label>
              <label>
                Ablauf (Europe/Berlin)
                <input
                  type="datetime-local"
                  value={localDate(data.expires_at)}
                  onChange={(e) => updateDate("expires_at", e.target.value)}
                />
              </label>
            </div>
            <p className="product-muted">
              Die Homepage-Freigabe bereitet die Produktschnittstelle vor. Die
              separate Academy-Website wird dadurch noch nicht geändert.
            </p>
          </section>
        </div>
        <aside className="product-preview">
          <div className="product-preview-header">
            <Eye size={18} />
            <strong>Live-Vorschau</strong>
            <span>Simulation</span>
          </div>
          <div className="product-preview-controls">
            <label>
              Nutzerzustand
              <select
                value={scenario}
                onChange={(e) => {
                  setScenario(e.target.value as keyof typeof scenarios);
                  setPreviewPlayer("");
                  setActualFamily("");
                }}
              >
                {Object.entries(scenarios).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Anzeigeort
              <select
                value={previewChannel}
                onChange={(e) => setPreviewChannel(e.target.value as Channel)}
              >
                {Object.entries(channelLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {actualFamily && (
              <button
                className="text-button"
                onClick={() => {
                  setActualFamily("");
                  setPreviewPlayer("");
                }}
              >
                Echte Familie verlassen
              </button>
            )}
            {previewChildren.length > 0 && (
              <label>
                Kind
                <select
                  value={previewPlayer || previewChildren[0]?.id}
                  onChange={(e) => setPreviewPlayer(e.target.value)}
                >
                  {previewChildren.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <ProductCard product={data} decision={preview?.decision} preview />
          <details className="product-stage-preview">
            <summary>Produktbühne ansehen</summary>
            <ProductCard
              product={data}
              decision={preview?.decision}
              preview
              stage
            />
          </details>
          <div className="product-preview-result" aria-live="polite">
            {preview?.error ? (
              <p role="alert">{preview.error}</p>
            ) : preview?.decision ? (
              <>
                <div>
                  <span>Sichtbar</span>
                  <b>{preview.decision.visible ? "Ja" : "Nein"}</b>
                </div>
                <div>
                  <span>Kaufbar</span>
                  <b>{preview.decision.purchasable ? "Ja" : "Nein"}</b>
                </div>
                <div>
                  <span>Nutzbar</span>
                  <b>{preview.decision.usable ? "Ja" : "Nein"}</b>
                </div>
                <div>
                  <span>Kaufmodus</span>
                  <b>{preview.decision.label}</b>
                </div>
                <p>
                  {preview.decision.audiences
                    .map((a: Audience) => audiences[a])
                    .join(" · ")}
                </p>
                {preview.decision.reasons.map((r: string) => (
                  <p key={r}>{r}</p>
                ))}
              </>
            ) : (
              <p>Vorschau wird berechnet …</p>
            )}
            <small>
              Dieselbe Berechtigungslogik prüft später den echten Kauf. Eine
              Simulation erzeugt keine Kaufrechte.
            </small>
          </div>
        </aside>
      </div>
      <div className="product-save-bar">
        <div>
          <strong>
            {dirty
              ? "Änderungen noch nicht gespeichert"
              : "Entwurf gespeichert"}
          </strong>
          <small>
            {editing?.published
              ? "Die veröffentlichte Fassung bleibt bis zur Übernahme aktiv."
              : "Das Angebot ist noch nicht veröffentlicht."}
          </small>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await persist();
              setNotice("Entwurf gespeichert.");
            })
          }
        >
          {busy ? <LoaderCircle className="product-spin" size={16} /> : null}{" "}
          Entwurf speichern
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const p = dirty || !editing ? await persist() : editing;
              setImpact(
                await productRequest(`${base}/${p.id}/impact`, "POST", {}),
              );
            })
          }
        >
          <Eye size={17} /> Änderungen prüfen
        </button>
      </div>
      {grantImpact && (
        <Modal
          title="Individuelle Freigabe prüfen"
          close={() => setGrantImpact(null)}
        >
          <p>{grantImpact.note}</p>
          <div className="product-impact-grid">
            <div>
              <strong>
                {grantImpact.visible_before} → {grantImpact.visible_after}
              </strong>
              <span>sichtbare Einträge</span>
            </div>
            <div>
              <strong>
                {grantImpact.buy_before} → {grantImpact.buy_after}
              </strong>
              <span>kaufberechtigte Familie</span>
            </div>
            {data.kind === "other" && (
              <div>
                <strong>
                  {grantImpact.usage_before} → {grantImpact.usage_after}
                </strong>
                <span>Familie mit nutzbarem Kauf</span>
              </div>
            )}
          </div>
          <div className="product-modal-actions">
            <button
              className="secondary-button"
              onClick={() => setGrantImpact(null)}
            >
              Zurück
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await productRequest(
                    `${base}/${editing!.id}/grants`,
                    "POST",
                    { token: grantImpact.token },
                  );
                  setEditing(await productRequest(`${base}/${editing!.id}`));
                  setGrantImpact(null);
                  setGrantReason("");
                  setImpact(null);
                  setNotice("Individuelle Freigabe übernommen.");
                })
              }
            >
              Freigabeänderung übernehmen
            </button>
          </div>
        </Modal>
      )}
      {impact && (
        <Modal
          title="Auswirkungen prüfen"
          className="product-impact-modal"
          close={() => setImpact(null)}
        >
          <p>
            Diese Auswertung stammt aus der lokalen Datenbank und vergleicht den
            veröffentlichten Stand mit deinem gespeicherten Entwurf.
          </p>
          <div className="product-impact-grid">
            <div>
              <strong>{impact.affected}</strong>
              <span>Familien mit geänderter Anzeige oder Berechtigung</span>
            </div>
            <div>
              <strong>
                {impact.before} → {impact.after}
              </strong>
              <span>kaufberechtigte Familien</span>
            </div>
            <div>
              <strong>
                +{impact.gained} / −{impact.lost}
              </strong>
              <span>neu / nicht mehr berechtigt</span>
            </div>
            <div>
              <strong>
                {impact.visible_before} → {impact.visible_after}
              </strong>
              <span>Sichtbarkeitskontexte (Kind × Anzeigeort)</span>
            </div>
          </div>
          <p>
            {impact.permission_changed_families} Familien mit geänderten
            Berechtigungen · {impact.displayed_families_before} →{" "}
            {impact.displayed_families_after} Familien mit sichtbarem Angebot ·{" "}
            {impact.open_orders} offene Kaufaufträge.
          </p>
          <p className="product-muted">{impact.note}</p>
          <small>
            Berechnet: {new Date(impact.checked_at).toLocaleString("de-DE")}
          </small>
          <div className="product-modal-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setImpact(null)}
            >
              Zurück
            </button>
            <button
              className="primary-button"
              disabled={busy || dirty}
              onClick={() =>
                void run(async () => {
                  const p = await productRequest<Details>(
                    `${base}/${editing!.id}/publish`,
                    "POST",
                    { token: impact.token },
                  );
                  setEditing(p);
                  setData(p.draft);
                  setDirty(false);
                  setImpact(null);
                  setNotice(
                    ["draft", "archived"].includes(p.draft.status)
                      ? "Verkauf gesperrt. Bestehende Verträge bleiben erhalten."
                      : "Produktfassung übernommen.",
                  );
                })
              }
            >
              <Check size={17} />{" "}
              {data.status === "archived"
                ? "Archivierung übernehmen"
                : data.status === "draft"
                  ? "Verkauf deaktivieren"
                  : "Fassung veröffentlichen"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
