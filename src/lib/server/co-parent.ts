import "server-only";
import { serviceDb } from "./service-db";
import { HttpError } from "./security";

// Never matches a real parent: used when a login has no family.
export const NO_PARENT = "00000000-0000-0000-0000-000000000000";

/** Elternkonto eines Logins: Hauptkonto oder aktives Zweitkonto. */
export async function portalParentId(userId: string) {
  const { data, error } = await serviceDb().rpc("portal_parent_id_for", {
    uid: userId,
  });
  if (error) {
    // Release 051 not installed yet: fall back to the old main-account rule.
    const fallback = await serviceDb()
      .from("parents")
      .select("id")
      .eq("auth_user_id", userId)
      .is("archived_at", null)
      .maybeSingle();
    return (fallback.data?.id as string | undefined) ?? NO_PARENT;
  }
  return (data as string | null) ?? NO_PARENT;
}

export async function isCoParent(userId: string) {
  const { data, error } = await serviceDb().rpc("is_co_parent_for", {
    uid: userId,
  });
  return !error && data === true;
}

export const CO_PARENT_READ_ONLY =
  "Mit dem Zweitkonto kannst du alles ansehen, aber nichts ändern oder buchen. Bitte nutze dafür das Hauptkonto.";

/** Schreibende Elternaktionen nur für das Hauptkonto. */
export async function assertMainParent(userId: string, role?: string | null) {
  if (role === "parent" && (await isCoParent(userId)))
    throw new HttpError(403, CO_PARENT_READ_ONLY);
}
