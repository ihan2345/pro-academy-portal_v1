import { assertRole } from "./security";
import { serviceDb } from "./service-db";
import type { PortalAccessEvent } from "@/lib/portal-events";

/** Tage, die die Glocke unter „Portal“ zurückblickt. */
export const PORTAL_BELL_DAYS = 14;

/**
 * Einladungen, Annahmen, Anmeldungen und „gerade aktiv“ für die Glocke.
 * Nur Admins (das Lese-Konto bekommt die Antwort gekürzt über viewerRoute).
 * Eigene Anmeldungen blendet die Glocke aus. Fehlt Release 064 noch, ist die
 * Liste leer und `ready` false.
 */
export async function portalAccessEvents(session: {
  role?: string | null;
  user: { id: string };
}): Promise<{ ready: boolean; rows: PortalAccessEvent[] }> {
  assertRole(session.role ?? undefined, "admin");
  const { data, error } = await serviceDb().rpc("portal_access_events", {
    days: PORTAL_BELL_DAYS,
  });
  if (error) return { ready: false, rows: [] };
  const rows = ((data ?? []) as PortalAccessEvent[])
    .filter((r) => r.user_id !== session.user.id || r.kind.startsWith("invite"))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 1500);
  return { ready: true, rows };
}
