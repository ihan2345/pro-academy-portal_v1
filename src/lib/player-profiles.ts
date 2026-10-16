import type { ProfileChild } from "./parent-profile";

export type PlayerProfileSort =
  "name" | "months" | "newest" | "revenue" | "hours" | "subscription";
export interface PlayerProfileCard extends ProfileChild {
  parents: { id: string; name: string }[];
  familyRevenue?: number | null;
  trainingAvailable: boolean;
}
export interface PlayerProfilePage {
  rows: PlayerProfileCard[];
  next: string | null;
  total: number;
}
export function comparePlayerProfiles(
  a: { id: string; name: string; created: string; rank?: number | null },
  b: { id: string; name: string; created: string; rank?: number | null },
  sort: PlayerProfileSort,
) {
  const tie = a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id);
  if (sort === "name") return tie;
  if (sort === "newest") return b.created.localeCompare(a.created) || tie;
  if (a.rank == null && b.rank != null) return 1;
  if (a.rank != null && b.rank == null) return -1;
  return (b.rank ?? 0) - (a.rank ?? 0) || tie;
}

/** Highest active tier wins for children with multiple subscriptions. */
export function playerSubscriptionRank(products: string[]): number {
  const names = products
    .join(" ")
    .toLowerCase()
    .replace(/[\s&_-]+/g, "");
  if (
    names.includes("nextlevel") ||
    /(^|[^a-z])pro([^a-z]|$)/i.test(products.join(" "))
  )
    return 3;
  if (names.includes("gamechanger")) return 2;
  if (names.includes("firsttouch")) return 1;
  return 0;
}
