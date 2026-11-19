import "server-only";
import { createHmac } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { serviceDb } from "@/lib/server/service-db";
import { sessionUser, sessionDb } from "@/lib/server/supabase";
import { assertRole, HttpError } from "@/lib/server/security";
import { readAll } from "@/lib/server/read-all";
import { required } from "@/lib/server/config";
import { readTrialGrant } from "./tokens";
import { trialFeatureEnabled } from "./feature";
import {
  buildTrialBellEvents,
  TRIAL_BELL_DAYS,
  type TrialBellEvent,
  type TrialBellInput,
  type TrialBellRow,
} from "./bell";
export { trialFeatureEnabled, trialFeatureInstalled } from "./feature";
import {
  type TrialCamp,
  type TrialRow,
  TRIAL_MATCH_MESSAGE,
  trialApplicationSchema,
  trialTeamSchema,
} from "./domain";
export async function requireTrials() {
  if (!(await trialFeatureEnabled()))
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
  const digest = createHmac("sha256", required("SUPABASE_SERVICE_ROLE_KEY"))
    .update(`trial:${new Date().toISOString().slice(0, 10)}:${ip}`)
    .digest("hex");
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
  const grant = token
    ? readTrialGrant(token, required("SUPABASE_SERVICE_ROLE_KEY"), "login")
    : null;
  const session = token ? null : await sessionUser();
  if (token ? !grant : !session?.user || session.role !== "parent")
    throw new HttpError(
      401,
      "Bitte melde dich an oder fordere einen neuen Zugangslink an.",
    );
  let query = serviceDb()
    .from("trial_families")
    .select(
      "id,parent_id,parent_name,email,email_verified_at,marketing_consent,access_expires_at,stopped_at,created_at",
    );
  query = grant
    ? query.eq("id", grant.family).eq("parent_id", grant.parent)
    : query.eq("auth_user_id", session!.user.id);
  const { data, error } = await query.single();
  if (
    error ||
    !data ||
    Date.parse(data.created_at) + 180 * 86400000 <= Date.now() ||
    data.stopped_at ||
    (verified && !data.email_verified_at)
  )
    throw new HttpError(
      401,
      "Der Zugang ist nicht verfügbar. Bitte kontaktiere das Team.",
    );
  return data;
}
export async function trialRatingGrant(token: string) {
  const grant = readTrialGrant(
    token,
    required("SUPABASE_SERVICE_ROLE_KEY"),
    "rating",
  );
  if (!grant)
    throw new HttpError(401, "Bewertungslink ist ungültig oder abgelaufen.");
  const { data, error } = await serviceDb()
    .from("trial_families")
    .select("id,parent_id,email_verified_at,stopped_at,created_at")
    .eq("id", grant.family)
    .eq("parent_id", grant.parent)
    .single();
  if (
    error ||
    !data ||
    !data.email_verified_at ||
    data.stopped_at ||
    Date.parse(data.created_at) + 180 * 86400000 <= Date.now()
  )
    throw new HttpError(401, "Bewertungszugang ist nicht verfügbar.");
  return grant;
}
export async function trialSavedFeedback(
  family: string,
  request: string,
  event: string,
) {
  const { data, error } = await serviceDb()
    .from("trial_team_overview")
    .select(
      "id,event_id,first_name,parent_rating,parent_feedback,comment_submitted_at",
    )
    .eq("family_id", family)
    .eq("id", request)
    .eq("event_id", event)
    .single();
  if (error || !data?.parent_rating)
    throw new HttpError(404, "Bewertung noch nicht gespeichert.");
  return data;
}
export async function trialSummary() {
  const s = await sessionUser();
  assertRole(s?.role, "team");
  const db = serviceDb();
  const [fresh, review, attendance] = await Promise.all([
    db
      .from("trial_team_overview")
      .select("id", { count: "exact", head: true })
      .in("status", ["new", "contacted"])
      .is("converted_at", null),
    db
      .from("trial_team_overview")
      .select("id", { count: "exact", head: true })
      .not("confirmed_at", "is", null)
      .eq("academy_ready", false)
      .neq("status", "closed")
      .is("converted_at", null),
    db
      .from("trial_team_overview")
      .select("id", { count: "exact", head: true })
      .eq("attendance", "planned")
      .eq("event_status", "scheduled")
      .lt("ends_at", new Date().toISOString())
      .neq("status", "closed")
      .is("converted_at", null),
  ]);
  if (fresh.error || review.error || attendance.error)
    throw new HttpError(
      503,
      "Probetraining-Aufgaben konnten nicht geladen werden.",
    );
  return {
    new: fresh.count ?? 0,
    review: (review.count ?? 0) + (attendance.count ?? 0),
  };
}
export async function trialTeamData() {
  const s = await sessionUser();
  assertRole(s?.role, "team");
  const db = serviceDb();
  const [rows, events, staff, admins] = await Promise.all([
    readAll(db, "trial_team_overview", "*"),
    db
      .from("training_events")
      .select("id,title,starts_at,ends_at,locations(name)")
      .eq("status", "scheduled")
      .gt("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(200),
    db.from("staff_profiles").select("id,display_name").eq("active", true),
    db.from("profiles").select("id,full_name").eq("role", "admin"),
  ]);
  if (events.error || staff.error || admins.error)
    throw new HttpError(503, "Termine konnten nicht geladen werden.");
  return {
    rows: rows as unknown as TrialRow[],
    staff: [
      ...(staff.data ?? []),
      ...(admins.data ?? [])
        .filter((a) => !(staff.data ?? []).some((s) => s.id === a.id))
        .map((a) => ({ id: a.id, display_name: a.full_name || "Verwaltung" })),
    ],
    events: events.data.map((e) => ({
      id: e.id,
      title: e.title,
      starts_at: e.starts_at,
    })),
  };
}
/** Bereits stattgefundene Einheiten (letzte 90 Tage) für "rückwirkend eintragen". */
export async function trialPastEvents() {
  const s = await sessionUser();
  assertRole(s?.role, "team");
  const now = Date.now();
  const { data, error } = await serviceDb()
    .from("training_events")
    .select(
      "id,title,starts_at,ends_at,locations(name),staff_profiles(display_name)",
    )
    .eq("status", "scheduled")
    .lte("ends_at", new Date(now).toISOString())
    .gte("starts_at", new Date(now - 90 * 86400000).toISOString())
    .order("starts_at")
    .limit(1000);
  if (error)
    throw new HttpError(503, "Einheiten konnten nicht geladen werden.");
  const one = <T>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : v;
  return {
    events: (data ?? []).map((e) => ({
      id: e.id as string,
      title: e.title as string,
      starts_at: e.starts_at as string,
      ends_at: e.ends_at as string,
      location:
        one(e.locations as unknown as { name: string } | null)?.name ?? "",
      coach:
        one(e.staff_profiles as unknown as { display_name: string } | null)
          ?.display_name ?? "",
    })),
  };
}
export async function manageTrial(body: unknown) {
  const s = await sessionUser();
  assertRole(s?.role, "team");
  const input = trialTeamSchema.parse(body);
  if (input.action === "resend") {
    const { data, error } = await serviceDb()
      .from("trial_team_overview")
      .select("email")
      .eq("id", input.request_id)
      .single();
    if (error || !data) throw new HttpError(404, "Anfrage nicht gefunden.");
    trialResult(
      await serviceDb().rpc("queue_trial_access", {
        email_address: data.email,
      }),
    );
    return { ok: true };
  }
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
      "id,player_id,first_name,last_name,status,event_id,confirmed_at,event_title,starts_at,ends_at,event_status,attendance,location_name,address,coach_name,academy_rating,academy_feedback,academy_ready,parent_rating,parent_feedback,comment_submitted_at,subscribed,converted_at",
    )
    .eq("family_id", family.id)
    .is("converted_at", null)
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

export async function ensureTrialAuth(family: {
  id: string;
  email: string;
  parent_name: string;
}) {
  const db = serviceDb();
  let linked = await db.rpc("trial_link_auth", { family: family.id });
  if (linked.error)
    throw new HttpError(503, "Elternzugang konnte nicht verknüpft werden.");
  if (!linked.data) {
    const created = await db.auth.admin.createUser({
      email: family.email,
      email_confirm: true,
      user_metadata: {
        full_name: family.parent_name,
        trial_family_id: family.id,
      },
    });
    if (
      created.error &&
      !["email_exists", "user_already_exists"].includes(
        created.error.code ?? "",
      )
    )
      throw new HttpError(
        503,
        "Elternzugang konnte nicht erstellt werden. Bitte erneut versuchen.",
      );
    linked = await db.rpc("trial_link_auth", { family: family.id });
    if (linked.error || !linked.data)
      throw new HttpError(503, "Elternzugang konnte nicht verknüpft werden.");
  }
  const link = await db.auth.admin.generateLink({
    type: "magiclink",
    email: family.email,
  });
  if (link.error || !link.data.properties.hashed_token)
    throw new HttpError(503, "Elternanmeldung ist gerade nicht verfügbar.");
  const signed = await (
    await sessionDb()
  ).auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: "magiclink",
  });
  if (signed.error)
    throw new HttpError(
      503,
      "Elternanmeldung konnte nicht abgeschlossen werden.",
    );
  return linked.data as string;
}
/**
 * Probetraining-Ereignisse der letzten 30 Tage für die Glocke. Rein lesend.
 * Fehlt die Spalte aus Release 056 noch, fehlt nur die Abmeldung.
 */
export async function trialBellData(): Promise<{ rows: TrialBellEvent[] }> {
  const s = await sessionUser();
  assertRole(s?.role, "team");
  const db = serviceDb();
  const now = Date.now();
  const since = new Date(now - TRIAL_BELL_DAYS * 86400000).toISOString();
  const cols =
    "id,family_id,first_name,last_name,parent_name,status,created_at,scheduled_at,confirmed_at,feedback_at,converted_at,converted_player_id,event_title,starts_at,attendance";
  const [rows, feedback, mails, requestAudits, attendanceAudits, families] =
    await Promise.all([
      db
        .from("trial_team_overview")
        .select(cols)
        .or(
          [
            "created_at",
            "scheduled_at",
            "confirmed_at",
            "feedback_at",
            "converted_at",
          ]
            .map((c) => `${c}.gte.${since}`)
            .join(","),
        )
        .limit(500),
      db
        .from("trial_feedback")
        .select("request_id,rating,feedback,created_at,comment_submitted_at")
        .eq("author_type", "parent")
        .or(`created_at.gte.${since},comment_submitted_at.gte.${since}`)
        .limit(500),
      db
        .from("notification_jobs")
        .select("id,kind,status,updated_at,payload")
        .in("kind", ["trial_feedback", "trial_day7", "trial_day14"])
        .in("status", ["sent", "failed", "uncertain"])
        .gte("updated_at", since)
        .limit(500),
      db
        .from("audit_log")
        .select("id,table_name,record_id,created_at,old_value,new_value")
        .eq("table_name", "trial_requests")
        .eq("new_value->>status", "closed")
        .gte("created_at", since)
        .limit(500),
      db
        .from("audit_log")
        .select("id,table_name,record_id,created_at,old_value,new_value")
        .eq("table_name", "event_participants")
        .not("new_value->>trial_request_id", "is", null)
        .in("new_value->>status", ["absent", "excused"])
        .gte("created_at", since)
        .limit(500),
      db
        .from("trial_families")
        .select("id,parent_name,marketing_stopped_at")
        .gte("marketing_stopped_at", since)
        .limit(200),
    ]);
  if (rows.error)
    throw new HttpError(
      503,
      "Probetraining-Ereignisse konnten nicht geladen werden.",
    );
  const list = (rows.data ?? []) as TrialBellRow[];
  const mailRows = (
    mails.error ? [] : (mails.data ?? [])
  ) as TrialBellInput["mails"];
  const feedbackRows = (
    feedback.error ? [] : (feedback.data ?? [])
  ) as TrialBellInput["feedback"];
  const audits = [
    ...(requestAudits.error ? [] : (requestAudits.data ?? [])),
    ...(attendanceAudits.error ? [] : (attendanceAudits.data ?? [])),
  ] as TrialBellInput["audits"];
  const familyRows = (
    families.error ? [] : (families.data ?? [])
  ) as TrialBellInput["families"];
  // Ereignisse zu Anfragen außerhalb des Zeitfensters brauchen trotzdem Namen.
  const known = new Set(list.map((r) => r.id));
  const missing = new Set<string>();
  const missingFamilies = new Set<string>();
  for (const f of feedbackRows)
    if (!known.has(f.request_id)) missing.add(f.request_id);
  for (const m of mailRows) {
    if (m.payload?.request_id && !known.has(m.payload.request_id))
      missing.add(m.payload.request_id);
    if (m.payload?.family_id) missingFamilies.add(m.payload.family_id);
  }
  for (const a of audits) {
    const rid =
      a.table_name === "trial_requests"
        ? a.record_id
        : String(a.new_value?.trial_request_id ?? "");
    if (rid && !known.has(rid)) missing.add(rid);
  }
  for (const f of familyRows) missingFamilies.add(f.id);
  const uuid = /^[0-9a-f-]{36}$/i;
  const ids = [...missing].filter((x) => uuid.test(x)).slice(0, 200);
  const fids = [...missingFamilies].filter((x) => uuid.test(x)).slice(0, 200);
  if (ids.length || fids.length) {
    const more = await db
      .from("trial_team_overview")
      .select(cols)
      .or(
        [
          ids.length ? `id.in.(${ids.join(",")})` : "",
          fids.length ? `family_id.in.(${fids.join(",")})` : "",
        ]
          .filter(Boolean)
          .join(","),
      )
      .limit(500);
    if (!more.error)
      for (const r of (more.data ?? []) as TrialBellRow[])
        if (!known.has(r.id)) {
          known.add(r.id);
          list.push(r);
        }
  }
  return {
    rows: buildTrialBellEvents(
      {
        rows: list,
        feedback: feedbackRows,
        mails: mailRows,
        audits,
        families: familyRows,
      },
      now,
    ),
  };
}
