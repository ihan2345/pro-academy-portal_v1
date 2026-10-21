import "server-only";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { serviceDb } from "@/lib/server/service-db";
import { sessionUser } from "@/lib/server/supabase";
import { assertRole, HttpError } from "@/lib/server/security";
import { readAll } from "@/lib/server/read-all";
import { required } from "@/lib/server/config";
import { trialTokenFamily } from "./tokens";
import {
  type TrialCamp,
  type TrialRow,
  TRIAL_MATCH_MESSAGE,
  trialApplicationSchema,
  trialTeamSchema,
} from "./domain";
export function trialFeatureEnabled() {
  return process.env.TRIAL_TRAINING_ENABLED === "true";
}
export function requireTrials() {
  if (!trialFeatureEnabled())
    throw new HttpError(404, "Probetraining ist noch nicht freigeschaltet.");
}
export function trialResult<T>(r: {
  data: T;
  error: { message: string } | null;
}): T {
  if (r.error)
    throw new HttpError(
      400,
      r.error.message.includes("TRIAL_MATCH")
        ? TRIAL_MATCH_MESSAGE
        : "Die Anfrage konnte nicht verarbeitet werden. Bitte Angaben prüfen oder das Team kontaktieren.",
    );
  return r.data;
}
export async function limitTrial(request: Request) {
  const url = new URL(request.url);
  if (
    process.env.NODE_ENV === "development" &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  )
    return "local-trial";
  const { env } = getCloudflareContext();
  const limiter = (
    env as unknown as {
      CAMP_REQUEST_LIMIT?: {
        limit(input: { key: string }): Promise<{ success: boolean }>;
      };
    }
  ).CAMP_REQUEST_LIMIT;
  const ip = request.headers.get("cf-connecting-ip");
  if (!limiter || !ip)
    throw new HttpError(503, "Bitte versuche es später erneut.");
  const digest = createHash("sha256").update(`trial:${ip}`).digest("hex");
  if (!(await limiter.limit({ key: digest })).success)
    throw new HttpError(429, "Bitte warte eine Minute und versuche es erneut.");
  return digest;
}
export async function applyTrial(body: unknown, rateKey: string) {
  const input = trialApplicationSchema.parse(body);
  trialResult(
    await serviceDb().rpc("create_trial_request", { input, rate_key: rateKey }),
  );
  return { ok: true };
}
export async function trialFamily(token?: string, verified = true) {
  const value = token ?? (await cookies()).get("pa_trial")?.value ?? "";
  const id = trialTokenFamily(value, required("SUPABASE_SERVICE_ROLE_KEY"));
  if (!id)
    throw new HttpError(
      401,
      "Bitte öffne deinen persönlichen Link aus der E-Mail.",
    );
  const { data, error } = await serviceDb()
    .from("trial_families")
    .select(
      "id,parent_id,parent_name,email,email_verified_at,marketing_consent,access_expires_at,stopped_at",
    )
    .eq("id", id)
    .single();
  if (
    error ||
    !data ||
    new Date(data.access_expires_at).getTime() <= Date.now() ||
    data.stopped_at ||
    (verified && !data.email_verified_at)
  )
    throw new HttpError(
      401,
      "Der Zugang ist nicht verfügbar. Bitte kontaktiere das Team.",
    );
  return data;
}
export async function trialSummary() {
  const s = await sessionUser();
  assertRole(s?.role, "team");
  const db = serviceDb();
  const [fresh, review] = await Promise.all([
    db
      .from("trial_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "new"),
    db
      .from("trial_team_overview")
      .select("id", { count: "exact", head: true })
      .not("confirmed_at", "is", null)
      .eq("academy_ready", false)
      .neq("status", "closed"),
  ]);
  if (fresh.error || review.error)
    throw new HttpError(
      503,
      "Probetraining-Aufgaben konnten nicht geladen werden.",
    );
  return { new: fresh.count ?? 0, review: review.count ?? 0 };
}
export async function trialTeamData() {
  const s = await sessionUser();
  assertRole(s?.role, "team");
  const db = serviceDb();
  const [rows, events] = await Promise.all([
    readAll(db, "trial_team_overview", "*"),
    db
      .from("training_events")
      .select("id,title,starts_at,ends_at,locations(name)")
      .eq("status", "scheduled")
      .gt("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(200),
  ]);
  if (events.error)
    throw new HttpError(503, "Termine konnten nicht geladen werden.");
  return {
    rows: rows as unknown as TrialRow[],
    events: events.data.map((e) => ({
      id: e.id,
      title: e.title,
      starts_at: e.starts_at,
    })),
  };
}
export async function manageTrial(body: unknown) {
  const s = await sessionUser();
  assertRole(s?.role, "team");
  const input = trialTeamSchema.parse(body);
  const result = await s!.db.rpc("manage_trial", { input });
  if (result.error) throw new HttpError(400, result.error.message);
  // The request is already persisted; the scheduled runner also retries mail planning.
  const planned = await serviceDb().rpc("plan_trial_notifications");
  if (planned.error)
    throw new HttpError(
      503,
      "Gespeichert. Die Benachrichtigung wird beim nächsten Hintergrundlauf vorbereitet.",
    );
  return { ok: true, id: result.data };
}
export async function trialWelcomeData() {
  const family = await trialFamily();
  const result = await serviceDb()
    .from("trial_team_overview")
    .select(
      "id,player_id,first_name,last_name,status,event_id,confirmed_at,event_title,starts_at,ends_at,event_status,attendance,location_name,address,coach_name,academy_rating,academy_feedback,academy_ready,parent_rating,parent_feedback,subscribed",
    )
    .eq("family_id", family.id)
    .order("created_at");
  if (result.error)
    throw new HttpError(503, "Deine Anfrage konnte nicht geladen werden.");
  return {
    family: {
      name: family.parent_name,
      marketing_consent: family.marketing_consent,
    },
    rows: result.data.map((r) => ({
      ...r,
      academy_feedback:
        r.confirmed_at && r.academy_ready ? r.academy_feedback : null,
      academy_rating:
        r.confirmed_at && r.academy_ready ? r.academy_rating : null,
    })),
  };
}
export async function trialCamps(): Promise<TrialCamp[]> {
  if (process.env.CAMP_DEPLOYMENT_ENABLED !== "true") return [];
  const { data, error } = await serviceDb()
    .from("camps")
    .select("id,title,location,days,payment_mode")
    .eq("status", "open")
    .eq(
      "payment_mode",
      process.env.CAMP_STRIPE_MODE === "live" ? "live" : "test",
    );
  if (error) return [];
  return (data ?? [])
    .flatMap((c) => {
      const dates = (c.days as { starts_at: string }[])
        .map((d) => d.starts_at)
        .sort();
      return dates[0] && Date.parse(dates[0]) > Date.now()
        ? [
            {
              id: c.id,
              title: c.title,
              location: c.location,
              starts_at: dates[0],
            },
          ]
        : [];
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 3);
}
