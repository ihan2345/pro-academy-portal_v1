import "server-only";
import { serviceDb } from "./service-db";
import { readAll } from "./read-all";
import {
  profileActivePeriods,
  type ProfileSubscriptionLink,
} from "./profile-subscription-history";
import { type ProfilePeriod } from "../parent-profile";
import { exportActiveMonths, type ExportPlayer } from "../player-export";
import { required } from "./config";

export async function loadPlayerExport(
  playerId?: string,
): Promise<ExportPlayer[]> {
  const db = serviceDb();
  const [players, parents, links, periods, subscriptions] = await Promise.all([
    readAll(
      db,
      "players",
      "id,first_name,last_name,birth_year,gender,club,position,strong_foot,height_cm,development_goals,archived_at",
    ),
    readAll(db, "parents", "id,full_name"),
    readAll(db, "parent_players", "id,parent_id,player_id"),
    readAll(
      db,
      "entitlement_periods",
      "id,player_id,subscription_id,product_name,starts_at,ends_at,status",
    ),
    readAll(
      db,
      "subscription_players",
      "id,player_id,stripe_item_id,subscriptions!inner(id,stripe_subscription_id,status,stripe_data)",
    ),
  ]);
  const now = new Date().toISOString();
  const active = await profileActivePeriods(
    subscriptions.filter(
      (p) => !playerId || p.player_id === playerId,
    ) as ProfileSubscriptionLink[],
    periods.filter(
      (p) => !playerId || p.player_id === playerId,
    ) as ProfilePeriod[],
    now,
  );
  const parentNames = new Map(
    parents.map((p) => [p.id, p.full_name as string]),
  );
  return players
    .filter((p) => !playerId || p.id === playerId)
    .map((p) => ({
      id: p.id,
      spielername: `${p.first_name} ${p.last_name}`.trim(),
      elternteile: [
        ...new Set(
          links
            .filter((l) => l.player_id === p.id)
            .map((l) => parentNames.get(l.parent_id))
            .filter((name): name is string => !!name),
        ),
      ].sort((a, b) => a.localeCompare(b, "de")),
      geburtsjahr: p.birth_year ?? null,
      geschlecht: p.gender ?? null,
      verein: p.club ?? null,
      position: p.position ?? null,
      fuss: p.strong_foot ?? null,
      groesse_cm: p.height_cm ?? null,
      entwicklungsziele: p.development_goals ?? null,
      archiviert: !!p.archived_at,
      abos: periods
        .filter(
          (q) =>
            q.player_id === p.id &&
            q.status === "active" &&
            Date.parse(q.starts_at) <= Date.parse(now) &&
            Date.parse(q.ends_at) > Date.parse(now),
        )
        .map((q) => ({ art: q.product_name, von: q.starts_at, bis: q.ends_at }))
        .sort(
          (a, b) => a.von.localeCompare(b.von) || a.art.localeCompare(b.art),
        ),
      aktive_monate: exportActiveMonths(
        active.filter((q) => q.player_id === p.id),
        now,
      ),
      profil_link: new URL(`/admin/spieler/${p.id}`, required("APP_URL")).href,
    }))
    .sort(
      (a, b) =>
        a.spielername.localeCompare(b.spielername, "de") ||
        a.id.localeCompare(b.id),
    );
}
