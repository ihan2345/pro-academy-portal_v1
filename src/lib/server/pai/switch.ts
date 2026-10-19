import "server-only";
import { serviceDb } from "../service-db";

/** Uncached authoritative switch; unavailable or missing data fails closed. */
export async function paiEnabled() {
  try {
    const { data, error } = await serviceDb()
      .from("platform_features")
      .select("enabled")
      .eq("key", "pai")
      .single();
    return !error && data?.enabled === true;
  } catch {
    return false;
  }
}

/** Read both flags together; the child is never effectively enabled without pAi. */
export async function paiVisibility() {
  try {
    const { data, error } = await serviceDb()
      .from("platform_features")
      .select("key,enabled")
      .in("key", ["pai", "pai_mascot"]);
    if (error || !data) return { pai: false, mascot: false };
    const pai = data.some((row) => row.key === "pai" && row.enabled === true);
    return {
      pai,
      mascot:
        pai &&
        data.some((row) => row.key === "pai_mascot" && row.enabled === true),
    };
  } catch {
    return { pai: false, mascot: false };
  }
}
