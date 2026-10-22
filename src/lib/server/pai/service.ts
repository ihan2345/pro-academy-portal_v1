import { paiEnabled } from "./switch";
import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { sessionUser } from "../supabase";
import { serviceDb } from "../service-db";
import { HttpError } from "../security";
import { authorizeProfile, type ProfileSession } from "../parent-profile";
import { profileActivePeriods } from "../profile-subscription-history";
import { familyMembership, familyStatus } from "../../parent-profile";
import {
  allowance,
  berlinWindow,
  configSchema,
  planGroup,
  type PaiStatus,
} from "../../pai/domain";

export async function paiSession() {
  const s = await sessionUser();
  if (!s?.role) throw new HttpError(401, "Bitte melde dich an.");
  if (s.customerStatus === "trial")
    throw new HttpError(403, "pAi wird nach der Abo-Übernahme freigeschaltet.");
  return s;
}
export function runtimeReady() {
  const production = process.env.APP_MODE === "production";
  if (production)
    return (
      process.env.PAI_PRODUCTION_CONFIRMED === "true" &&
      !!process.env.PAI_PRODUCTION_API_KEY &&
      process.env.PAI_PRODUCTION_API_KEY !== process.env.PAI_TEST_API_KEY
    );
  try {
    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname,
      ) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(process.env.APP_URL ?? "").hostname,
      ) &&
      !!process.env.PAI_TEST_API_KEY
    );
  } catch {
    return false;
  }
}
export function providerKey() {
  if (!runtimeReady())
    throw new HttpError(
      503,
      "pAi ist noch nicht für diese Umgebung eingerichtet.",
    );
  return process.env.APP_MODE === "production"
    ? process.env.PAI_PRODUCTION_API_KEY!
    : process.env.PAI_TEST_API_KEY!;
}
export function checked<T>(result: {
  data: T;
  error: unknown;
}): NonNullable<T> {
  if (result.error || result.data === null)
    throw new HttpError(
      503,
      "pAi-Daten sind nicht verfügbar. Bitte Einrichtung prüfen.",
    );
  return result.data as NonNullable<T>;
}
export async function configuration() {
  const row = checked(
    await serviceDb()
      .from("pai_config")
      .select("version,value")
      .eq("singleton", true)
      .single(),
  );
  return {
    version: row.version as number,
    config: configSchema.parse(row.value),
  };
}
export async function enabled(s: ProfileSession) {
  if (s.customerStatus === "trial" || !(await paiEnabled())) return false;
  if (s.role !== "parent") return true;
  return checked(await s.db.rpc("pai_preference")) === true;
}
/** Catalog price is authoritative; names from the prompt or historical display snapshots are never used. */
export async function activePlans(s: ProfileSession, childIds: string[]) {
  if (!childIds.length) return [];
  const links = checked(
    await serviceDb()
      .from("subscription_players")
      .select(
        "player_id,stripe_item_id,subscriptions!inner(status,needs_review,stripe_data)",
      )
      .in("player_id", childIds)
      .limit(501),
  ) as any[];
  if (links.length > 500)
    throw new HttpError(
      503,
      "Zu viele Abozuordnungen für eine vollständige Berechnung.",
    );
  const active = links.filter((l) => l.subscriptions.status === "active");
  const prices = active.map((l) => {
    const item = l.subscriptions.stripe_data?.items?.find(
      (i: any) => i.id === l.stripe_item_id,
    );
    return l.subscriptions.needs_review ? null : item?.price_id;
  });
  const ids = [...new Set(prices.filter(Boolean))];
  const catalog = ids.length
    ? checked(
        await s.db
          .from("plans")
          .select("name,stripe_price_id")
          .in("stripe_price_id", ids),
      )
    : [];
  return prices.map((p) => {
    const plan = catalog.find((x) => x.stripe_price_id === p);
    return plan ? planGroup(plan.name) : null;
  });
}
async function familyChildren(s: ProfileSession, parentId?: string) {
  const parent = await authorizeProfile(s, parentId),
    db = serviceDb();
  const links = checked(
    await db
      .from("parent_players")
      .select("player_id,players!inner(archived_at)")
      .eq("parent_id", parent.id)
      .limit(101),
  ) as any[];
  if (links.length > 100)
    throw new HttpError(503, "Familienzuordnung zu groß.");
  const ids = links.map((l) => l.player_id),
    activeIds = links
      .filter((l) => !l.players.archived_at)
      .map((l) => l.player_id);
  return { ids, activeIds };
}
/** Minimal projection of the same authoritative membership pipeline as the profile. */
export async function membership(s: ProfileSession, parentId?: string) {
  const { ids, activeIds } = await familyChildren(s, parentId),
    db = serviceDb();
  async function collect(table: string, columns: string) {
    if (!ids.length) return [];
    const rows: any[] = [];
    for (let page = 0; page < 20; page++) {
      const batch = checked(
        await db
          .from(table)
          .select(columns)
          .in("player_id", ids)
          .order("id")
          .range(page * 500, page * 500 + 499),
      );
      rows.push(...batch);
      if (batch.length < 500) return rows;
    }
    throw new HttpError(
      503,
      "Mitgliedschaftshistorie nicht vollständig abrufbar.",
    );
  }
  const periods = await collect(
    "entitlement_periods",
    "id,player_id,subscription_id,product_name,starts_at,ends_at,status",
  );
  const subscriptions = await collect(
    "subscription_players",
    "id,player_id,stripe_item_id,subscriptions!inner(id,stripe_subscription_id,status,stripe_data)",
  );
  const now = new Date().toISOString();
  const history = await profileActivePeriods(subscriptions, periods, now);
  const metrics = familyMembership(history, now);
  return {
    ...metrics,
    badge: familyStatus(metrics.months),
    activeIds,
    explanation:
      "Abgeschlossene aktive Abo-Monate je Kind, als Familie addiert. Jeder volle Monat ohne aktives Kinderabo zieht einen Statusmonat ab, höchstens bis null. Zugeordnete archivierte Kinder behalten ihre belegte Historie.",
  };
}
export async function context(s: ProfileSession, targetUser?: string) {
  // Target inspection is admin-only and never changes the actor session for tools.
  if (targetUser && s.role !== "admin")
    throw new HttpError(403, "Keine Berechtigung.");
  const uid = targetUser ?? s.user.id;
  const db = serviceDb();
  const profile = targetUser
    ? checked(await db.from("profiles").select("role").eq("id", uid).single())
    : { role: s.role };
  const { config, version } = await configuration();
  let badgeKnown = true;
  let months = 0,
    groups: ReturnType<typeof planGroup>[] = [];
  if (profile.role === "parent") {
    const parent = checked(
      await db
        .from("parents")
        .select("id")
        .eq("auth_user_id", uid)
        .is("archived_at", null)
        .single(),
    );
    const children = await familyChildren(s, parent.id);
    groups = await activePlans(s, children.activeIds);
    try {
      months = (await membership(s, parent.id)).months;
    } catch (error) {
      // Monthly allowance is independent of badge history. Never invent a badge.
      if (groups.length && !groups.includes(null)) throw error;
      badgeKnown = false;
    }
  }
  const standard = allowance(profile.role, months, groups, config);
  if (!badgeKnown) standard.badge = null;
  const overrides = checked(
    await db
      .from("pai_overrides")
      .select("limit_value,period_kind,expires_at")
      .eq("user_id", uid)
      .eq("active", true),
  );
  const override = overrides.find(
    (o) => !o.expires_at || Date.parse(o.expires_at) > Date.now(),
  );
  const kind = override?.period_kind ?? standard.kind;
  const window = berlinWindow(kind);
  const [completed, pending] = await Promise.all([
    db
      .from("pai_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .gte("created_at", window.start)
      .eq("status", "completed"),
    db
      .from("pai_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .gte("created_at", window.start)
      .eq("status", "reserved")
      .gt("lease_until", new Date().toISOString()),
  ]);
  if (completed.error || pending.error)
    throw new HttpError(503, "Nutzung derzeit nicht verfügbar.");
  const used = completed.count ?? 0,
    reserved = pending.count ?? 0;
  const maximum = override?.limit_value ?? standard.standard;
  const status: PaiStatus = {
    ...standard,
    kind,
    enabled: targetUser ? true : await enabled(s),
    available: config.enabled && runtimeReady(),
    limit: maximum,
    used,
    reserved,
    remaining: Math.max(0, maximum - used - reserved),
    reset: window.reset,
    override: !!override,
    retentionDays: config.retentionDays,
  };
  return { config, version, status, start: berlinWindow(standard.kind).start };
}
export const chatSchema = z
  .object({ id: z.uuid(), message: z.string().trim().min(1).max(4000) })
  .strict();
export function fingerprint(message: string) {
  return createHash("sha256").update(message).digest("hex");
}
export async function history(s: ProfileSession) {
  const cleanup = await serviceDb().rpc("pai_cleanup");
  if (cleanup.error)
    throw new HttpError(503, "Verlauf derzeit nicht verfügbar.");
  return checked(
    await serviceDb()
      .from("pai_requests")
      .select("id,prompt,answer,created_at")
      .eq("user_id", s.user.id)
      .eq("status", "completed")
      .gt("expires_at", new Date().toISOString())
      .not("answer", "is", null)
      .order("created_at", { ascending: false })
      .limit(30),
  ).reverse();
}
export async function deleteHistory(s: ProfileSession) {
  const result = await serviceDb()
    .from("pai_requests")
    .update({
      prompt: null,
      answer: null,
      expires_at: new Date().toISOString(),
    })
    .eq("user_id", s.user.id);
  if (result.error)
    throw new HttpError(503, "Verlauf konnte nicht gelöscht werden.");
}
