import "server-only";
import { z } from "zod";
import { sessionUser } from "./supabase";
import { serviceDb } from "./service-db";
import { HttpError } from "./security";
import { campEnabled, campPaymentMode } from "../camps/runtime";
import { calendarDate, monthStart } from "../calendar";
import {
  childAge,
  eventUnit,
  profileCalendar,
  activeMembership,
  familyMembership,
  trainingStats,
  unitPreview,
  PROFILE_WEEK,
  type ParentProfile,
  type ProfileListRow,
  type ProfilePeriod,
  type ProfileUnit,
} from "../parent-profile";
import { profileActivePeriods } from "./profile-subscription-history";
import { compareRevenue, readParentRevenue } from "./profile-revenue";
import type { PortalData } from "../types";

export type ProfileSession = NonNullable<
  Awaited<ReturnType<typeof sessionUser>>
>;
const contacts =
  "id,auth_user_id,full_name,contact_email,phone,city,profile_self_service_updated_at";
function checked<T>(r: { data: T; error: any }): NonNullable<T> {
  if (r.error) {
    if (["42703", "PGRST204", "PGRST202"].includes(r.error.code))
      throw new HttpError(
        503,
        "Elternprofile benötigen die vorbereitete Datenbankmigration. Bestehende Funktionen bleiben verfügbar.",
      );
    throw new HttpError(
      503,
      "Profildaten konnten nicht vollständig geladen werden.",
    );
  }
  return r.data as NonNullable<T>;
}
export async function profileSession() {
  const s = await sessionUser();
  if (!s?.role) throw new HttpError(401, "Bitte melde dich an.");
  return s;
}
export function profileShell(s: ProfileSession): PortalData {
  return {
    trial_access:
      s.trialEnabled && ["trial", "mixed"].includes(s.customerStatus),
    trial_enabled: s.trialEnabled,
    role: s.role!,
    user_name: s.name.split(" ")[0] || "Willkommen",
    email: s.user.email ?? "",
    players: [],
    periods: [],
    events: [],
    reports: [],
    locations: [],
    trainers: [],
    whatsapp: process.env.WHATSAPP_NUMBER ?? "",
    camp_enabled: campEnabled(),
    camp_access: s.customerStatus === "trial" ? "only" : undefined,
  };
}
export async function authorizeProfile(s: ProfileSession, target?: string) {
  if (!s.role) throw new HttpError(401, "Bitte melde dich an.");
  const db = serviceDb();
  let q = db.from("parents").select(contacts).is("archived_at", null);
  if (s.role === "parent") {
    q = q.eq("auth_user_id", s.user.id);
    if (target) q = q.eq("id", z.uuid().parse(target));
  } else if (["admin", "staff"].includes(s.role) && target)
    q = q.eq("id", z.uuid().parse(target));
  else throw new HttpError(403, "Keine Berechtigung für dieses Profil.");
  const parent = checked(await q.maybeSingle());
  if (!parent) throw new HttpError(404, "Profil nicht verfügbar.");
  return parent;
}
/** Bounded, filtered keyset reads. Never return a silently truncated statistic. */
async function collect(make: () => any): Promise<any[]> {
  const rows: any[] = [];
  let after: string | undefined;
  for (let i = 0; i < 20; i++) {
    let q = make().order("id").limit(500);
    if (after) q = q.gt("id", after);
    const batch = checked<any[]>(await q);
    rows.push(...batch);
    if (batch.length < 500) return rows;
    after = batch.at(-1).id;
  }
  throw new HttpError(
    503,
    "Diese Historie ist zu groß für einen vollständigen Profilabruf.",
  );
}
async function periodsFor(ids: string[]) {
  if (!ids.length) return [];
  return collect(() =>
    serviceDb()
      .from("entitlement_periods")
      .select(
        "id,player_id,subscription_id,product_name,starts_at,ends_at,status",
      )
      .in("player_id", ids),
  ) as Promise<ProfilePeriod[]>;
}
async function subscriptionsFor(ids: string[]) {
  if (!ids.length) return [];
  return collect(() =>
    serviceDb()
      .from("subscription_players")
      .select(
        "id,player_id,stripe_item_id,subscriptions!inner(id,stripe_subscription_id,status,stripe_data)",
      )
      .in("player_id", ids),
  );
}
export async function profileList(
  s: ProfileSession,
  search = "",
  offset = 0,
  includeInactive = false,
  sort: "name" | "months" | "newest" | "revenue" = "name",
) {
  if (!s.role || !["staff", "admin"].includes(s.role))
    throw new HttpError(403, "Keine Berechtigung.");
  if (sort === "revenue" && s.role !== "admin")
    throw new HttpError(403, "Finanzdaten sind nur für Admins verfügbar.");
  const db = serviceDb();
  let q = db
    .from("parents")
    .select("id,full_name,contact_email,auth_user_id")
    .is("archived_at", null);
  if (!includeInactive) {
    const active = await collect(() =>
      db
        .from("subscription_players")
        .select(
          "id,player_id,subscriptions!inner(status),players!inner(archived_at)",
        )
        .eq("subscriptions.status", "active")
        .is("players.archived_at", null),
    );
    const players = [...new Set(active.map((a) => a.player_id))];
    if (!players.length) return { rows: [] as ProfileListRow[], more: false };
    const owners = await collect(() =>
      db.from("parent_players").select("id,parent_id").in("player_id", players),
    );
    const parents = [...new Set(owners.map((o) => o.parent_id))];
    if (!parents.length) return { rows: [] as ProfileListRow[], more: false };
    q = q.in("id", parents);
  }
  // PostgREST filter grammar must never be accepted from search input.
  const term = search
    .replace(/[^\p{L}\p{N}@ ._+-]/gu, " ")
    .trim()
    .slice(0, 100);
  if (term) q = q.or(`full_name.ilike.%${term}%,contact_email.ilike.%${term}%`);
  q = q
    .order(sort === "newest" ? "created_at" : "full_name", {
      ascending: sort !== "newest",
    })
    .order("id");
  // Ranking needs every matching family before pagination.
  let parents: any[] = [];
  if (sort === "months" || sort === "revenue") {
    for (let start = 0; ; start += 500) {
      if (start >= 10000)
        throw new HttpError(
          503,
          "Zu viele Profile für eine vollständige Rangliste.",
        );
      const batch = checked(await q.range(start, start + 499));
      parents.push(...batch);
      if (batch.length < 500) break;
    }
  } else parents = checked(await q.range(offset, offset + 25));
  let revenue: Map<string, number | null> | undefined;
  if (sort === "revenue" && parents.length) {
    // Include other parents' mappings to detect shared/ambiguous customers.
    const customerLinks = await collect(() =>
      db
        .from("parent_stripe_customers")
        .select("id,parent_id,stripe_customer_id"),
    );
    revenue = await readParentRevenue(
      s.role,
      parents.map((p) => p.id),
      customerLinks,
    );
    parents.sort((a, b) => compareRevenue(a, b, revenue!));
  }
  const page =
      sort === "months"
        ? parents
        : sort === "revenue"
          ? parents.slice(offset, offset + 25)
          : parents.slice(0, 25),
    ids = page.map((p) => p.id);
  if (!ids.length) return { rows: [] as ProfileListRow[], more: false };
  const links = await collect(() =>
    db
      .from("parent_players")
      .select("id,parent_id,player_id,players!inner(archived_at)")
      .in("parent_id", ids),
  );
  const periods = await periodsFor([...new Set(links.map((l) => l.player_id))]);
  const subscriptions = await subscriptionsFor([
    ...new Set(links.map((l) => l.player_id)),
  ]);
  const now = new Date().toISOString();
  const activePeriods = await profileActivePeriods(subscriptions, periods, now);
  const rows: ProfileListRow[] = page.map((p) => {
    const children = links.filter((l) => l.parent_id === p.id);
    return {
      id: p.id,
      name: p.full_name,
      email: p.contact_email,
      ...(revenue ? { revenue: revenue.get(p.id) ?? null } : {}),
      children: children.filter((l) => !l.players.archived_at).length,
      products: [
        ...new Set(
          periods
            .filter(
              (x) =>
                children.some((c) => c.player_id === x.player_id) &&
                x.status === "active" &&
                x.starts_at <= now &&
                x.ends_at > now,
            )
            .map((x) => x.product_name),
        ),
      ],
      months: familyMembership(
        activePeriods.filter((p) =>
          children.some((c) => c.player_id === p.player_id),
        ),
        now,
      ).months,
    };
  });
  if (sort === "months")
    rows.sort(
      (a, b) =>
        b.months - a.months ||
        a.name.localeCompare(b.name, "de") ||
        a.id.localeCompare(b.id),
    );
  const selected = sort === "months" ? rows.slice(offset, offset + 25) : rows;
  const userIds = parents
    .filter((p) => selected.some((r) => r.id === p.id))
    .map((p) => p.auth_user_id)
    .filter(Boolean);
  if (s.role === "admin" && userIds.length) {
    const result = await db
      .from("user_activity")
      .select("user_id,last_seen_at")
      .in("user_id", userIds);
    if (result.error && !["42P01", "PGRST205"].includes(result.error.code))
      checked(result);
    for (const row of selected) {
      const userId = parents.find((p) => p.id === row.id)?.auth_user_id;
      row.last_seen_at =
        result.data?.find((a) => a.user_id === userId)?.last_seen_at ?? null;
    }
  }
  return {
    rows: selected,
    more:
      sort === "months"
        ? rows.length > offset + 25
        : sort === "revenue"
          ? parents.length > offset + 25
          : parents.length > 25,
  };
}
export async function loadParentProfile(
  s: ProfileSession,
  target?: string,
  allUnits = false,
): Promise<ParentProfile> {
  const parent = await authorizeProfile(s, target),
    db = serviceDb();
  const camps = campEnabled();
  const links = await collect(() =>
    db
      .from("parent_players")
      .select(
        `id,player_id,players!inner(id,first_name,last_name,birth_year,team,gender,club,position,strong_foot,height_cm,development_goals,archived_at${camps ? ",camp_birth_date,camp_age_at_booking,camp_age_recorded_on" : ""})`,
      )
      .eq("parent_id", parent.id),
  );
  const kids = links.map((l) => l.players),
    ids = kids.map((k) => k.id);
  const now = new Date().toISOString(),
    month = monthStart(calendarDate(now));
  const periods = await periodsFor(ids);
  const subscriptions = await subscriptionsFor(ids);
  const activePeriods = await profileActivePeriods(subscriptions, periods, now);
  const participants = ids.length
    ? await collect(() =>
        db
          .from("event_participants")
          .select(
            "id,player_id,status,reason,removed_from_event,training_events!inner(title,starts_at,ends_at,event_type,status,locations(name))",
          )
          .in("player_id", ids),
      )
    : [];
  let backfills: any[] = [],
    backfillsAvailable = true;
  if (ids.length) {
    try {
      backfills = await collect(() =>
        db
          .from("training_backfills")
          .select("id,player_id,title,event_type,occurred_on,duration_minutes")
          .in("player_id", ids),
      );
    } catch {
      backfillsAvailable = false;
    }
  }
  const names = new Map(
    kids.map((k) => [k.id, `${k.first_name} ${k.last_name}`]),
  );
  const units: ProfileUnit[] = participants
    .map((p) => eventUnit(p, names.get(p.player_id) ?? "", now))
    .filter((u): u is ProfileUnit => !!u);
  units.push(
    ...backfills.map((b) => ({
      id: b.id,
      player_id: b.player_id,
      child_name: names.get(b.player_id) ?? "",
      title: b.title,
      event_type: b.event_type,
      starts_at: null,
      ends_at: null,
      day: b.occurred_on,
      status: "attended_manual" as const,
      cancelled: false,
      minutes: b.duration_minutes,
      retrospective: true,
      location: "",
    })),
  );
  let bookings: any[] = [],
    campsAvailable = camps;
  if (camps && ids.length) {
    try {
      bookings = await collect(() =>
        db
          .from("camp_bookings")
          .select(
            "id,player_id,camp_id,attendance_status,camps!inner(payment_mode)",
          )
          .in("player_id", ids)
          .eq("camps.payment_mode", campPaymentMode()),
      );
    } catch {
      campsAvailable = false;
    }
  }
  const children = kids.map((k) => {
    const history = periods.filter((p) => p.player_id === k.id),
      valid = history.filter((p) => p.status === "active");
    return {
      id: k.id,
      name: names.get(k.id)!,
      first_name: k.first_name,
      last_name: k.last_name,
      birth_year: k.birth_year,
      team: k.team,
      gender: k.gender,
      club: k.club,
      position: k.position,
      strong_foot: k.strong_foot,
      height_cm: k.height_cm,
      development_goals: k.development_goals,
      age: childAge(k, calendarDate(now)),
      archived: !!k.archived_at,
      products: [
        ...new Set(
          valid
            .filter((p) => p.starts_at <= now && p.ends_at > now)
            .map((p) => p.product_name),
        ),
      ],
      ...activeMembership(
        activePeriods.filter((p) => p.player_id === k.id),
        now,
      ),
      camps: campsAvailable
        ? new Set(
            bookings
              .filter(
                (b) =>
                  b.player_id === k.id && b.attendance_status === "attended",
              )
              .map((b) => b.camp_id),
          ).size
        : null,
      stats: trainingStats(
        units.filter((u) => u.player_id === k.id),
        month,
      ),
    };
  });
  const visibleIds = new Set(
    children.filter((c) => !c.archived || s.role === "admin").map((c) => c.id),
  );
  const visibleUnits = units.filter((u) => visibleIds.has(u.player_id));
  return {
    id: parent.id,
    name: parent.full_name,
    email: parent.contact_email,
    phone: parent.phone,
    city: parent.city,
    next_edit_at: parent.profile_self_service_updated_at
      ? new Date(
          Date.parse(parent.profile_self_service_updated_at) + PROFILE_WEEK,
        ).toISOString()
      : null,
    role: s.role!,
    children: children.filter((c) => visibleIds.has(c.id)),
    ...familyMembership(activePeriods, now),
    has_subscription_history:
      activeMembership(activePeriods, now).since !== null,
    history_note:
      "Abgeschlossene aktive Abo-Monate werden je Kind einmal gezählt und als Familie addiert. Jeder volle Monat ohne aktives Kinderabo zieht einen Statusmonat ab, höchstens bis null. Der Abzug bleibt nach einem Wiedereinstieg bestehen. Zugeordnete archivierte Kinder behalten ihre belegte Historie.",
    calendar: profileCalendar(visibleUnits, month, now),
    units: allUnits ? visibleUnits : unitPreview(visibleUnits, now),
    month,
    backfills_available: backfillsAvailable,
    camps_available: campsAvailable,
  };
}
export const profileEditSchema = z
  .object({
    phone: z.string().trim().max(50),
    city: z.string().trim().max(120),
  })
  .strict();
export async function editParentProfile(
  s: ProfileSession,
  target: string,
  input: unknown,
) {
  if (s.role !== "admin" && s.role !== "parent")
    throw new HttpError(403, "Keine Berechtigung.");
  const parent = await authorizeProfile(s, target),
    data = profileEditSchema.parse(input);
  const result = await s.db.rpc("update_parent_profile", {
    target: parent.id,
    new_phone: data.phone,
    new_city: data.city,
  });
  if (result.error)
    throw new HttpError(
      result.error.code === "P0001" ? 429 : 400,
      result.error.code === "P0001"
        ? "Erneut bearbeitbar nach sieben Tagen."
        : "Kontaktangaben konnten nicht gespeichert werden. Bitte Migration und Berechtigung prüfen.",
    );
  return { ok: true, next_edit_at: result.data };
}
export async function archiveProfileChild(
  s: ProfileSession,
  target: string,
  child: string,
) {
  if (s.role !== "admin")
    throw new HttpError(403, "Nur Admins dürfen Kinder archivieren.");
  const parent = await authorizeProfile(s, target);
  const link = checked(
    await s.db
      .from("parent_players")
      .select("player_id")
      .eq("parent_id", parent.id)
      .eq("player_id", z.uuid().parse(child))
      .maybeSingle(),
  );
  if (!link) throw new HttpError(404, "Kind nicht verfügbar.");
  checked(
    await s.db
      .from("players")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", link.player_id)
      .is("archived_at", null),
  );
  return { ok: true };
}

export const profileChildSchema = z
  .object({
    child_id: z.uuid(),
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100),
    birth_year: z.number().int().min(1990).max(2100).nullable(),
    team: z.string().trim().max(40),
    gender: z.enum(["männlich", "weiblich", "divers"]).nullable().optional(),
    club: z
      .string()
      .trim()
      .max(120)
      .transform((v) => v || null)
      .nullable()
      .optional(),
    position: z
      .string()
      .trim()
      .max(80)
      .transform((v) => v || null)
      .nullable()
      .optional(),
    strong_foot: z.enum(["rechts", "links", "beidfüßig"]).nullable().optional(),
    height_cm: z.number().int().min(50).max(250).nullable().optional(),
    development_goals: z
      .string()
      .trim()
      .max(2000)
      .transform((v) => v || null)
      .nullable()
      .optional(),
  })
  .strict();
export async function changeProfileChild(
  s: ProfileSession,
  target: string,
  action: "unlink" | "child",
  input: unknown,
) {
  if (s.role !== "admin" && !(s.role === "parent" && action === "child"))
    throw new HttpError(403, "Keine Berechtigung für diese Änderung.");
  const data =
    action === "child"
      ? profileChildSchema.parse(input)
      : z.object({ child_id: z.uuid() }).strict().parse(input);
  const parent = await authorizeProfile(s, target);
  const link = checked(
    await s.db
      .from("parent_players")
      .select("id,player_id")
      .eq("parent_id", parent.id)
      .eq("player_id", data.child_id)
      .maybeSingle(),
  );
  if (!link) throw new HttpError(404, "Kind nicht verfügbar.");
  if (action === "unlink") {
    const result = await s.db.rpc("unlink_parent_player", {
      link: link.id,
      unlink_reason:
        "Im Elternprofil bestätigt: Kind vom Elternteil lösen und für neue Verknüpfung freigeben.",
    });
    if (result.error)
      throw new HttpError(400, "Verknüpfung konnte nicht gelöst werden.");
  } else {
    const { child_id, ...fields } = profileChildSchema.parse(data);
    if (s.role === "parent") {
      const result = await s.db.rpc("update_own_child_profile_details", {
        target_parent: parent.id,
        target_child: child_id,
        new_first_name: fields.first_name,
        new_last_name: fields.last_name,
        new_birth_year: fields.birth_year,
        new_team: fields.team,
        details: {
          gender: fields.gender,
          club: fields.club,
          position: fields.position,
          strong_foot: fields.strong_foot,
          height_cm: fields.height_cm,
          development_goals: fields.development_goals,
        },
      });
      if (result.error)
        throw new HttpError(
          400,
          "Kinderdaten konnten nicht gespeichert werden. Bitte Berechtigung und Daten prüfen.",
        );
    } else
      checked(await s.db.from("players").update(fields).eq("id", child_id));
  }
  return { ok: true };
}
