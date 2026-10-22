import "server-only";
import { serviceDb } from "../server/service-db";
import { readAll } from "../server/read-all";
import { HttpError } from "../server/security";

export async function trialCampChildren(parentId?: string): Promise<any[]> {
  if (process.env.TRIAL_TRAINING_ENABLED !== "true") return [];
  const db = serviceDb();
  if (parentId) {
    const r = await db
      .from("trial_camp_children")
      .select("*")
      .eq("parent_id", parentId);
    if (r.error)
      throw new HttpError(
        503,
        "Probetraining-Kinder konnten nicht für die Campbuchung geladen werden.",
      );
    return r.data ?? [];
  }
  return readAll(db, "trial_camp_children", "*");
}
export async function includeTrialCampFamilies<
  T extends { id: string; parent_players?: any[] },
>(families: T[]): Promise<T[]> {
  const trials = await trialCampChildren();
  return families.map((f) => ({
    ...f,
    parent_players: [
      ...new Map(
        [
          ...(f.parent_players ?? []),
          ...trials
            .filter((t) => t.parent_id === f.id)
            .map((players) => ({ players })),
        ].map((link) => [link.players.id, link]),
      ).values(),
    ],
  }));
}
