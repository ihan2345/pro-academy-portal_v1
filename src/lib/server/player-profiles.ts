import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { serviceDb } from "./service-db";
import { assertRole, HttpError } from "./security";
import type { ProfileSession } from "./parent-profile";
import { profileActivePeriods } from "./profile-subscription-history";
import { readParentRevenue } from "./profile-revenue";
import {
  activeMembership,
  childAge,
  eventUnit,
  trainingStats,
  type ProfilePeriod,
  type ProfileUnit,
} from "../parent-profile";
import { calendarDate, monthStart } from "../calendar";
import { campEnabled, campPaymentMode } from "../camps/runtime";
import {
  comparePlayerProfiles,
  playerSubscriptionRank,
  type PlayerProfilePage,
  type PlayerProfileSort,
} from "../player-profiles";

export const playerProfileQuery = z.object({
  search: z.string().trim().max(100).default(""),
  sort: z
    .enum(["name", "months", "newest", "revenue", "hours", "subscription"])
    .default("name"),
  cursor: z
    .string()
    .regex(/^[0-9a-f-]{36}:\d+$/)
    .optional(),
});
// A short-lived, user-scoped ordering snapshot keeps scrolling stable without
// recalculating a full ranking or calling Stripe for every ten-card batch.
interface Entry {
  id: string;
  name: string;
  created: string;
  rank?: number | null;
  parents: { id: string; name: string }[];
}
interface Snapshot {
  owner: string;
  query: string;
  expires: number;
  entries: Entry[];
}
const snapshots = new Map<string, Snapshot>();
const lifetime = 5 * 60_000;
async function collect(make: () => any): Promise<any[]> {
  const rows: any[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    let q = make().order("id").limit(500);
    if (after) q = q.gt("id", after);
    const result = await q;
    if (result.error)
      throw new HttpError(
        503,
        "Spielerprofile konnten nicht vollständig geladen werden.",
      );
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
    after = result.data.at(-1).id;
  }
  throw new HttpError(
    503,
    "Zu viele Daten für einen vollständigen Profilabruf.",
  );
}
// Bound IN filters and reuse the exact membership/training rules of the parent profile.
async function membership(ids: string[], now: string) {
  const db = serviceDb();
  const [periods, subscriptions] = await Promise.all([
    collect(() =>
      db
        .from("entitlement_periods")
        .select(
          "id,player_id,subscription_id,product_name,starts_at,ends_at,status",
        )
        .in("player_id", ids),
    ),
    collect(() =>
      db
        .from("subscription_players")
        .select(
          "id,player_id,stripe_item_id,subscriptions!inner(id,stripe_subscription_id,status,stripe_data)",
        )
        .in("player_id", ids),
    ),
  ]);
  const active = await profileActivePeriods(
    subscriptions,
    periods as ProfilePeriod[],
    now,
  );
  return {
    periods,
    values: new Map(
      ids.map((id) => [
        id,
        activeMembership(
          active.filter((p) => p.player_id === id),
          now,
        ),
      ]),
    ),
  };
}
async function training(ids: string[], now: string) {
  const db = serviceDb();
  const participants = await collect(() =>
    db
      .from("event_participants")
      .select(
        "id,player_id,status,reason,removed_from_event,training_events!inner(title,starts_at,ends_at,event_type,status)",
      )
      .in("player_id", ids),
  );
  let backfills: any[] = [],
    available = true;
  try {
    backfills = await collect(() =>
      db
        .from("training_backfills")
        .select("id,player_id,title,event_type,occurred_on,duration_minutes")
        .in("player_id", ids),
    );
  } catch {
    available = false;
  }
  const units = participants
    .map((p) => eventUnit(p, "", now))
    .filter((u): u is ProfileUnit => !!u);
  units.push(
    ...backfills.map((b) => ({
      id: b.id,
      player_id: b.player_id,
      child_name: "",
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
  return {
    available,
    values: new Map(
      ids.map((id) => [
        id,
        trainingStats(
          units.filter((u) => u.player_id === id),
          monthStart(calendarDate(now)),
        ),
      ]),
    ),
  };
}
async function index(
  sort: PlayerProfileSort,
  search: string,
  session: ProfileSession,
): Promise<Entry[]> {
  const db = serviceDb();
  const active = await collect(() =>
    db
      .from("subscription_players")
      .select(
        "id,player_id,subscriptions!inner(status),players!inner(id,first_name,last_name,created_at,archived_at)",
      )
      .eq("subscriptions.status", "active")
      .is("players.archived_at", null),
  );
  const kids = [
    ...new Map(active.map((row) => [row.player_id, row.players])).values(),
  ];
  const entries: Entry[] = [];
  const term = search.toLocaleLowerCase("de-DE");
  for (let start = 0; start < kids.length; start += 100) {
    const batch = kids.slice(start, start + 100);
    const links = await collect(() =>
      db
        .from("parent_players")
        .select(
          "id,player_id,parents!inner(id,full_name,contact_email,archived_at)",
        )
        .in(
          "player_id",
          batch.map((k) => k.id),
        )
        .is("parents.archived_at", null),
    );
    for (const k of batch) {
      const parents = links
        .filter((l) => l.player_id === k.id)
        .map((l) => l.parents);
      const name = `${k.first_name} ${k.last_name}`;
      if (
        term &&
        ![name, ...parents.flatMap((p) => [p.full_name, p.contact_email])].some(
          (v) => v?.toLocaleLowerCase("de-DE").includes(term),
        )
      )
        continue;
      entries.push({
        id: k.id,
        name,
        created: k.created_at,
        parents: parents.map((p) => ({ id: p.id, name: p.full_name })),
      });
    }
  }
  const now = new Date().toISOString();
  if (sort === "subscription") {
    for (let start = 0; start < entries.length; start += 100) {
      const batch = entries.slice(start, start + 100);
      const periods = await collect(() =>
        db
          .from("entitlement_periods")
          .select("id,player_id,product_name,starts_at,ends_at,status")
          .in(
            "player_id",
            batch.map((e) => e.id),
          )
          .eq("status", "active"),
      );
      batch.forEach((e) => {
        e.rank = playerSubscriptionRank(
          periods
            .filter(
              (p) =>
                p.player_id === e.id && p.starts_at <= now && p.ends_at > now,
            )
            .map((p) => p.product_name),
        );
      });
    }
  }
  if (sort === "months" || sort === "hours") {
    for (let start = 0; start < entries.length; start += 100) {
      const batch = entries.slice(start, start + 100),
        ids = batch.map((e) => e.id);
      if (sort === "months") {
        const metrics = await membership(ids, now);
        batch.forEach((e) => {
          e.rank = metrics.values.get(e.id)!.months;
        });
      } else {
        const metrics = await training(ids, now);
        if (!metrics.available)
          throw new HttpError(
            503,
            "Trainingsstunden können ohne vollständige Nachträge nicht zuverlässig sortiert werden.",
          );
        batch.forEach((e) => {
          e.rank = metrics.values.get(e.id)!.all.minutes;
        });
      }
    }
  }
  if (sort === "revenue" && entries.length) {
    const links = await collect(() =>
      db
        .from("parent_stripe_customers")
        .select("id,parent_id,stripe_customer_id"),
    );
    const revenue = await readParentRevenue(
      session.role,
      [...new Set(entries.flatMap((e) => e.parents.map((p) => p.id)))],
      links,
    );
    // Multiple parent accounts are not summed: that could count shared payments twice.
    entries.forEach((e) => {
      e.rank =
        e.parents.length === 1 ? (revenue.get(e.parents[0].id) ?? null) : null;
    });
  }
  return entries.sort((a, b) => comparePlayerProfiles(a, b, sort));
}
async function hydrate(
  entries: Entry[],
  sort: PlayerProfileSort,
): Promise<PlayerProfilePage["rows"]> {
  if (!entries.length) return [];
  const db = serviceDb(),
    ids = entries.map((e) => e.id),
    now = new Date().toISOString();
  const [kids, active, members, stats] = await Promise.all([
    collect(() =>
      db
        .from("players")
        .select("id,first_name,last_name,birth_year,team,archived_at")
        .in("id", ids)
        .is("archived_at", null),
    ),
    collect(() =>
      db
        .from("subscription_players")
        .select("id,player_id,subscriptions!inner(status)")
        .in("player_id", ids)
        .eq("subscriptions.status", "active"),
    ),
    membership(ids, now),
    training(ids, now),
  ]);
  let bookings: any[] = [],
    campsAvailable = campEnabled();
  if (campsAvailable) {
    try {
      bookings = await collect(() =>
        db
          .from("camp_bookings")
          .select(
            "id,player_id,camp_id,attendance_status,camps!inner(payment_mode)",
          )
          .in("player_id", ids)
          .eq("camps.payment_mode", campPaymentMode())
          .eq("attendance_status", "attended"),
      );
    } catch {
      campsAvailable = false;
    }
  }
  return entries.flatMap((entry) => {
    const k = kids.find((k) => k.id === entry.id);
    if (!k || !active.some((a) => a.player_id === entry.id)) return [];
    return [
      {
        ...k,
        name: `${k.first_name} ${k.last_name}`,
        age: childAge(k, calendarDate(now)),
        archived: false,
        products: [
          ...new Set<string>(
            members.periods
              .filter(
                (p) =>
                  p.player_id === k.id &&
                  p.status === "active" &&
                  p.starts_at <= now &&
                  p.ends_at > now,
              )
              .map((p) => p.product_name),
          ),
        ],
        ...members.values.get(k.id)!,
        stats: stats.values.get(k.id)!,
        trainingAvailable: stats.available,
        camps: campsAvailable
          ? new Set(
              bookings
                .filter((b) => b.player_id === k.id)
                .map((b) => b.camp_id),
            ).size
          : null,
        parents: entry.parents,
        ...(sort === "revenue" ? { familyRevenue: entry.rank ?? null } : {}),
      },
    ];
  });
}
export async function playerProfileList(
  session: ProfileSession,
  input: unknown,
): Promise<PlayerProfilePage> {
  assertRole(session.role, "team");
  const query = playerProfileQuery.parse(input);
  if (query.sort === "revenue") assertRole(session.role, "admin");
  const owner = `${session.user.id}:${session.role}`,
    key = JSON.stringify([query.sort, query.search]);
  for (const [id, snapshot] of snapshots)
    if (snapshot.expires < Date.now()) snapshots.delete(id);
  let token: string,
    snapshot: Snapshot,
    offset = 0;
  if (query.cursor) {
    const [id, position] = query.cursor.split(":");
    token = id;
    offset = Number(position);
    const stored = snapshots.get(id);
    if (!stored || stored.owner !== owner || stored.query !== key)
      throw new HttpError(409, "Die Liste ist abgelaufen. Bitte neu laden.");
    snapshot = stored;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset % 10 ||
      offset > snapshot.entries.length
    )
      throw new HttpError(400, "Ungültige Seitenposition.");
  } else {
    token = randomUUID();
    snapshot = {
      owner,
      query: key,
      expires: Date.now() + lifetime,
      entries: await index(query.sort, query.search, session),
    };
    if (snapshots.size >= 32) snapshots.delete(snapshots.keys().next().value!);
    snapshots.set(token, snapshot);
  }
  const rows = await hydrate(
    snapshot.entries.slice(offset, offset + 10),
    query.sort,
  );
  return {
    rows,
    total: snapshot.entries.length,
    next:
      offset + 10 < snapshot.entries.length ? `${token}:${offset + 10}` : null,
  };
}
