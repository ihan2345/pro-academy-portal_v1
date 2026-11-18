import "server-only";
import { serviceDb } from "./service-db";
import { readAll } from "./read-all";
import { assertRole } from "./security";
import type { ProfileSession } from "./parent-profile";
import { membership, training } from "./player-profiles";
import { childAge } from "../parent-profile";
import { calendarDate } from "../calendar";
import { campEnabled, campPaymentMode } from "../camps/runtime";
import {
  archiveStatus,
  type ArchivePage,
  type ArchivePlayer,
} from "../player-archive";

/**
 * Archiv aller jemals erfassten Spieler, unabhängig von Abo, Camp,
 * Probetraining oder Archivierung. Nur lesend, für Admin und Team.
 */
export async function playerArchive(
  session: ProfileSession,
): Promise<ArchivePage> {
  assertRole(session.role, "team");
  const db = serviceDb(),
    now = new Date().toISOString(),
    today = calendarDate(now);
  const [players, links, parents, subscriptions] = await Promise.all([
    readAll(
      db,
      "players",
      "id,first_name,last_name,birth_year,camp_birth_date,team,archived_at,created_at",
    ),
    readAll(db, "parent_players", "id,parent_id,player_id"),
    readAll(db, "parents", "id,full_name,archived_at"),
    readAll(db, "subscription_players", "id,player_id,subscriptions(status)"),
  ]);
  let bookings: Record<string, any>[] = [],
    campsAvailable = campEnabled();
  if (campsAvailable) {
    try {
      const mode = campPaymentMode();
      bookings = (
        await readAll(
          db,
          "camp_bookings",
          "id,player_id,camp_id,status,attendance_status,camps(payment_mode)",
        )
      ).filter(
        (b) =>
          b.player_id &&
          b.status === "paid" &&
          !["absent", "excused"].includes(b.attendance_status) &&
          (b.camps?.payment_mode ?? mode) === mode,
      );
    } catch {
      campsAvailable = false;
    }
  }
  let trials: Record<string, any>[] = [];
  try {
    trials = await readAll(db, "trial_requests", "id,player_id,status");
  } catch {
    /* Probetraining noch nicht eingespielt. */
  }

  const ids = players.map((p) => p.id as string);
  const periods: Record<string, any>[] = [];
  const months = new Map<string, { months: number; since: string | null }>();
  const stats = new Map<string, { count: number; minutes: number }>();
  let trainingAvailable = true;
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100);
    const [m, t] = await Promise.all([
      membership(batch, now),
      training(batch, now),
    ]);
    periods.push(...m.periods);
    m.values.forEach((v, k) => months.set(k, v));
    t.values.forEach((v, k) => stats.set(k, v.all));
    trainingAvailable &&= t.available;
  }

  const parentNames = new Map(
    parents.map((p) => [p.id as string, p.full_name as string]),
  );
  const rows: ArchivePlayer[] = players.map((p) => {
    const id = p.id as string;
    const own = periods.filter((x) => x.player_id === id);
    const products = p.archived_at
      ? []
      : [
          ...new Set<string>(
            own
              .filter(
                (x) =>
                  x.status === "active" &&
                  x.starts_at <= now &&
                  x.ends_at > now,
              )
              .map((x) => x.product_name),
          ),
        ];
    const activeSubscription =
      !p.archived_at &&
      subscriptions.some(
        (s) => s.player_id === id && s.subscriptions?.status === "active",
      );
    const camps = new Set(
      bookings.filter((b) => b.player_id === id).map((b) => b.camp_id),
    ).size;
    const trial = trials.find((t) => t.player_id === id)?.status ?? null;
    const status = archiveStatus({
      activeSubscription,
      hadSubscription:
        own.length > 0 || subscriptions.some((s) => s.player_id === id),
      camps,
      trial: !!trial,
    });
    const stat = stats.get(id) ?? { count: 0, minutes: 0 };
    const member = months.get(id) ?? { months: 0, since: null };
    return {
      id,
      first_name: p.first_name,
      last_name: p.last_name,
      name: `${p.first_name} ${p.last_name}`.trim(),
      age: childAge(p, today),
      team: p.team ?? "",
      archived: !!p.archived_at,
      created: p.created_at,
      status,
      products: status === "abo" ? products : [],
      formerProducts: [...new Set<string>(own.map((x) => x.product_name))],
      months: member.months,
      since: member.since,
      trainings: stat.count,
      minutes: stat.minutes,
      camps: campsAvailable ? camps : null,
      trial,
      parents: [
        ...new Map(
          links
            .filter((l) => l.player_id === id && parentNames.has(l.parent_id))
            .map((l) => [
              l.parent_id as string,
              {
                id: l.parent_id as string,
                name: parentNames.get(l.parent_id)!,
              },
            ]),
        ).values(),
      ],
    };
  });
  rows.sort(
    (a, b) => a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id),
  );
  return { rows, trainingAvailable };
}
