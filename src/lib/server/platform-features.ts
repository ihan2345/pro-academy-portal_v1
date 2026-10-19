import "server-only";
import { sessionUser } from "./supabase";
import { HttpError } from "./security";
export async function featureManager() {
  const s = await sessionUser();
  if (!s?.role) throw new HttpError(401, "Bitte melde dich an.");
  if (s.role !== "admin") throw new HttpError(403, "Keine Berechtigung.");
  const { data, error } = await s.db.rpc("can_manage_features");
  if (error || data !== true) throw new HttpError(403, "Keine Berechtigung.");
  return s;
}
