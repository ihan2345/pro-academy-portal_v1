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
