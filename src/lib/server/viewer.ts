import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "./service-db";
import { required } from "./config";
import { HttpError } from "./security";

/**
 * Lese-Rolle „Einsicht“ (Release 061).
 *
 * Die Datenbank gibt der Rolle selbst keine Leserechte. Das Portal liest
 * serverseitig mit einem schreibgeschützten Dienstzugang und kürzt Kinder-
 * und Elternnamen auf Initialen + Jahrgang + Kennung, bevor Daten den Browser
 * erreichen. Jede Änderung wird dreifach abgelehnt: im Proxy (alle Nicht-GET-
 * Anfragen), in sessionUser() und im schreibgeschützten Datenbankzugang.
 */
export type Viewer = { clearNames: boolean };

type Store = { method?: string; path?: string; viewer?: Viewer };

/** POST-Anfragen, die nur lesen (z. B. Online-Punkte für eine ID-Liste). */
export const VIEWER_READ_POSTS = ["/api/admin/user-activity"];
const storage = new AsyncLocalStorage<Store>();

export const READ_ONLY_MESSAGE =
  "Nur Lesezugriff: Mit diesem Konto lassen sich keine Änderungen speichern.";

/** Wird von sessionUser() aufgerufen, sobald ein Lese-Konto erkannt ist. */
export function enterViewer(viewer: Viewer) {
  const store = storage.getStore();
  if (store) {
    store.viewer = viewer;
    if (
      store.method &&
      !["GET", "HEAD", "OPTIONS"].includes(store.method) &&
      !VIEWER_READ_POSTS.includes(store.path ?? "")
    )
      throw new HttpError(403, READ_ONLY_MESSAGE);
  }
}

/** Bereiche, die das Lese-Konto nie sieht. */
export function viewerBlockedSection(section: string) {
  return /^(admin\/(einstellungen|funktionen|pai|einladungen|stripe)|pai)(\/|$)/.test(
    section,
  );
}

const READ_RPCS = new Set([
  "camp_occupied_seats",
  "product_context_version",
  "product_family_version",
  "product_shop_enabled",
  "trial_enabled",
  "read_shared_trainings",
  "parent_self_activation_available",
  "parent_email_requires_login",
]);

function denied() {
  const result = {
    data: null,
    error: { message: READ_ONLY_MESSAGE, code: "42501", details: "", hint: "" },
    count: null,
    status: 403,
    statusText: "Forbidden",
  };
  // Kettenaufrufe wie .insert().select().single() bleiben möglich und
  // enden immer im selben Fehler.
  const chain: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then")
        return (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(ok, fail);
      return () => chain;
    },
    apply: () => chain,
  });
  return chain;
}

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);
const STORAGE_WRITES = new Set([
  "upload",
  "update",
  "remove",
  "move",
  "copy",
  "uploadToSignedUrl",
  "createSignedUploadUrl",
]);

const FILE_READS = new Set([
  "download",
  "createSignedUrl",
  "createSignedUrls",
  "getPublicUrl",
]);

/**
 * Dienstzugang, der nur lesen kann. Dateien (z. B. Berichts-PDFs mit
 * Klarnamen) nur, wenn `files` erlaubt ist (Klarnamen-Schalter).
 */
export function readOnlyDb(
  db: SupabaseClient,
  auth: SupabaseClient["auth"],
  files = false,
): SupabaseClient {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "auth") return auth;
      if (prop === "from" || prop === "schema")
        return (...args: unknown[]) => {
          const builder = (target as any)[prop](...args);
          if (prop === "schema") return readOnlyDb(builder, auth, files);
          return new Proxy(builder, {
            get(b, p, r) {
              if (typeof p === "string" && WRITE_METHODS.has(p)) return denied;
              const value = Reflect.get(b, p, r);
              return typeof value === "function" ? value.bind(b) : value;
            },
          });
        };
      if (prop === "rpc")
        return (name: string, ...rest: unknown[]) =>
          READ_RPCS.has(name) ? (target as any).rpc(name, ...rest) : denied();
      if (prop === "storage")
        return new Proxy(target.storage, {
          get(s, p, r) {
            if (p !== "from") return Reflect.get(s, p, r);
            return (bucket: string) =>
              new Proxy(s.from(bucket), {
                get(f, q, rr) {
                  if (
                    typeof q === "string" &&
                    (STORAGE_WRITES.has(q) || (!files && FILE_READS.has(q)))
                  )
                    return denied;
                  const value = Reflect.get(f, q, rr);
                  return typeof value === "function" ? value.bind(f) : value;
                },
              });
          },
        });
      if (prop === "functions" || prop === "channel" || prop === "realtime")
        throw new HttpError(403, READ_ONLY_MESSAGE);
      return Reflect.get(target, prop, receiver);
    },
  });
}

/* ------------------------------------------------------------------ */
/* Namen kürzen                                                         */
/* ------------------------------------------------------------------ */

type Dictionary = {
  replace: Map<string, string>;
  pattern: RegExp | null;
  keep: Set<string>;
  ids: Map<string, { initials: string; year?: number }>;
};
let cache: { at: number; dictionary: Promise<Dictionary> } | null = null;

export function tag(value: string, length = 3) {
  return createHmac("sha256", required("SUPABASE_SERVICE_ROLE_KEY"))
    .update(`viewer:${value}`)
    .digest("hex")
    .slice(0, length)
    .toUpperCase();
}

const letter = (s: string) => {
  const m = /\p{L}/u.exec(s);
  return m ? m[0].toUpperCase() : "";
};
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const first = letter(parts[0]);
  const last = parts.length > 1 ? letter(parts.at(-1)!) : "";
  return [first, last]
    .filter(Boolean)
    .map((l) => `${l}.`)
    .join(" ");
}
export function pseudonym(name: string, key: string, year?: number | null) {
  return [initials(name), year ? String(year) : null, `#${tag(key)}`]
    .filter(Boolean)
    .join(" · ");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function buildDictionary(): Promise<Dictionary> {
  const db = serviceDb();
  const [players, trials, parents, staff, admins] = await Promise.all([
    db.from("players").select("id,first_name,last_name,birth_year"),
    db.from("trial_players").select("id,first_name,last_name,birth_date"),
    db.from("parents").select("id,full_name"),
    db.from("staff_profiles").select("display_name"),
    db.from("profiles").select("full_name,role").neq("role", "parent"),
  ]);
  const keep = new Set<string>();
  for (const s of staff.data ?? []) {
    keep.add(String(s.display_name ?? "").trim());
    for (const t of String(s.display_name ?? "").split(/\s+/)) keep.add(t);
  }
  for (const a of admins.data ?? []) {
    keep.add(String(a.full_name ?? "").trim());
    for (const t of String(a.full_name ?? "").split(/\s+/)) keep.add(t);
  }
  const replace = new Map<string, string>(),
    tokens = new Map<string, string>(),
    ids = new Map<string, { initials: string; year?: number }>();
  const addPerson = (id: string, full: string, year?: number) => {
    const name = full.replace(/\s+/g, " ").trim();
    if (!name || keep.has(name)) return;
    const value = pseudonym(name, id, year);
    if (!replace.has(name)) replace.set(name, value);
    ids.set(id, { initials: initials(name), year });
    for (const t of name.split(/[\s]+/))
      if (t.length >= 3 && /^\p{Lu}/u.test(t) && !keep.has(t))
        tokens.set(t, `${letter(t)}.`);
  };
  for (const p of players.data ?? [])
    addPerson(
      p.id,
      `${p.first_name ?? ""} ${p.last_name ?? ""}`,
      Number(p.birth_year) || undefined,
    );
  for (const p of trials.error ? [] : (trials.data ?? []))
    addPerson(
      p.id,
      `${p.first_name ?? ""} ${p.last_name ?? ""}`,
      Number(String(p.birth_date ?? "").slice(0, 4)) || undefined,
    );
  for (const p of parents.data ?? [])
    addPerson(p.id, String(p.full_name ?? ""));
  for (const [t, v] of tokens) if (!replace.has(t)) replace.set(t, v);
  const keys = [...replace.keys()].sort((a, b) => b.length - a.length);
  return {
    replace,
    keep,
    ids,
    pattern: keys.length
      ? new RegExp(
          `(?<![\\p{L}\\p{N}])(?:${keys.map(escape).join("|")})(?![\\p{L}\\p{N}])`,
          "gu",
        )
      : null,
  };
}

async function dictionary() {
  if (!cache || Date.now() - cache.at > 60_000) {
    const dictionary = buildDictionary();
    cache = { at: Date.now(), dictionary };
    dictionary.catch(() => (cache = null));
  }
  return cache.dictionary;
}

const DROP = new Set([
  "contact_email",
  "billing_email",
  "email",
  "emails",
  "recipient",
  "recipient_email",
  "parent_email",
  "guest_email",
  "customer_email",
  "phone",
  "phone_number",
  "mobile",
  "telephone",
  "street",
  "address_line1",
  "address_line2",
  "postal_code",
  "zip",
  "house_number",
  "photo_url",
  "avatar_url",
  "note",
  "notes",
  "internal_note",
  "private_note",
  "parent_note",
  "admin_note",
  "comment",
  "feedback",
  "reason",
  "cancellation_reason",
  "cancellation_comment",
  "cancellation_feedback",
  "cancellation_details",
  "failure_reason",
  "failure_message",
  "decline_reason",
  "decline_code",
  "development_goals",
  "entwicklungsziele",
  "notiz",
  "notizen",
  "telefon",
  "adresse",
  "user_metadata",
  "raw_user_meta_data",
]);
const NAME_KEY =
  /^(full_name|(parent|player|child|kid|customer|buyer|recipient|guest|family|sender|holder|guardian|member|participant|subject|account)_?name)$/i;
const PERSON_CONTAINER =
  /^(parent|parents|parent_data|child|children|child_data|guardian|customer|recipient|buyer|family|player|players|sender|member|participant|guest|subject|account)$/i;
const PERSON_HINT = [
  "first_name",
  "last_name",
  "full_name",
  "contact_email",
  "email",
  "phone",
  "parent_id",
  "player_id",
  "auth_user_id",
];
const STRIPE_ID =
  /\b(cus|sub|pi|in|ch|si|cs|pm|seti|py|re|ii|il|src|card|ba|acct|evt|txn)_[A-Za-z0-9]{6,}\b/g;
const EMAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[A-Za-z]{2,}/g;

function maskString(value: string, d: Dictionary) {
  let out = value
    .replace(EMAIL, "•••@•••")
    .replace(STRIPE_ID, (m) => `${m.split("_")[0]}_${tag(m, 6)}`);
  if (d.pattern) out = out.replace(d.pattern, (m) => d.replace.get(m) ?? m);
  return out;
}
function maskName(value: string, d: Dictionary) {
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || d.keep.has(name)) return value;
  return d.replace.get(name) ?? pseudonym(name, name);
}
function blank(value: unknown) {
  if (typeof value === "string") return "";
  if (Array.isArray(value)) return [];
  if (value && typeof value === "object") return null;
  return value;
}

function walk(value: unknown, d: Dictionary, key: string, depth: number): any {
  if (typeof value === "string") return maskString(value, d);
  if (Array.isArray(value)) return value.map((v) => walk(v, d, key, depth + 1));
  if (!value || typeof value !== "object") return value;
  const o = value as Record<string, unknown>;
  const person = PERSON_CONTAINER.test(key) || PERSON_HINT.some((k) => k in o);
  const personId = String(
    o.player_id ?? o.trial_player_id ?? o.parent_id ?? o.id ?? "",
  );
  const first = typeof o.first_name === "string" ? o.first_name : "";
  const last = typeof o.last_name === "string" ? o.last_name : "";
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (depth === 0 && ["email", "user_name", "role"].includes(k)) {
      out[k] = v;
      continue;
    }
    if (DROP.has(k)) out[k] = v == null ? v : blank(v);
    else if (k === "address" && person) out[k] = v == null ? v : blank(v);
    else if (/^stripe_[a-z_]*id$/.test(k) && typeof v === "string" && v)
      out[k] = `${v.split("_")[0]}_${tag(v, 6)}`;
    else if (k === "birth_date" && typeof v === "string")
      out[k] = v.slice(0, 4);
    else if (k === "first_name" && typeof v === "string")
      out[k] = v ? `${letter(v)}.` : v;
    else if (k === "last_name" && typeof v === "string")
      out[k] =
        `${v ? `${letter(v)}. · ` : ""}#${tag(personId || `${first} ${last}`)}`;
    else if (
      typeof v === "string" &&
      (NAME_KEY.test(k) || (k === "name" && person))
    )
      out[k] = maskName(v, d);
    else out[k] = walk(v, d, k, depth + 1);
  }
  return out;
}

/** Kürzt Namen und blendet Kontakt-, Zahlungs- und Freitextdaten aus. */
export async function maskForViewer<T>(
  viewer: Viewer | undefined | null,
  data: T,
): Promise<T> {
  if (!viewer || viewer.clearNames) return data;
  return walk(data, await dictionary(), "", 0) as T;
}

async function maskResponse(response: Response, viewer: Viewer) {
  if (response.status >= 300 && response.status < 400) return response;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    if (response.status >= 400) return response;
    return Response.json(
      { error: "Für den Lesezugriff nicht verfügbar." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const body = await response.json();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(await maskForViewer(viewer, body)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Hülle für alle API-Routen: merkt sich die Anfragemethode für sessionUser()
 * und kürzt Antworten an Lese-Konten. Antworten ohne JSON (Exporte, PDFs,
 * Protokolle) bekommen Lese-Konten ohne Klarnamen gar nicht.
 */
export function viewerRoute<A extends unknown[]>(
  handler: (...args: A) => Promise<Response> | Response,
) {
  return async (...args: A): Promise<Response> => {
    const request = args[0] as Request | undefined;
    const store: Store = {
      method: request?.method?.toUpperCase(),
      path: request?.url ? new URL(request.url).pathname : undefined,
    };
    const response = await storage.run(store, () => handler(...args));
    const viewer = store.viewer;
    if (!viewer || viewer.clearNames) return response;
    return maskResponse(response, viewer);
  };
}
