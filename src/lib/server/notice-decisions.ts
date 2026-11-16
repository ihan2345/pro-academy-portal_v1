import "server-only";
import { z } from "zod";
import { assertRole, HttpError } from "./security";
import { serviceDb } from "./service-db";
import type { ProfileSession } from "./parent-profile";
import type { NoticeDecision } from "../notice-decisions";

/** Tabelle aus Release 050 fehlt noch: dann merkt sich der Browser lokal. */
function missing(error: any) {
  return (
    error?.code === "PGRST205" ||
    error?.code === "42P01" ||
    /notice_decisions/.test(String(error?.message ?? ""))
  );
}
const keySchema = z
  .string()
  .min(3)
  .max(300)
  .regex(/^[a-z][a-z-]*:[\w:.@-]+$/i);

export async function readNoticeDecisions(
  session: ProfileSession,
): Promise<{ available: boolean; rows: NoticeDecision[] }> {
  assertRole(session.role, "team");
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  const r = await serviceDb()
    .from("notice_decisions")
    .select("key,state,remind_at,updated_at")
    .gt("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (r.error) {
    if (missing(r.error)) return { available: false, rows: [] };
    throw new HttpError(503, "Markierungen konnten nicht geladen werden.");
  }
  return { available: true, rows: (r.data ?? []) as NoticeDecision[] };
}

/** Schlüssel, die gerade ausgeblendet sind (erledigt, ignoriert, zurückgestellt). */
export async function hiddenNoticeKeys(keys: string[]) {
  const hidden = new Set<string>();
  if (!keys.length) return hidden;
  const now = Date.now();
  const db = serviceDb();
  for (let n = 0; n < keys.length; n += 100) {
    const r = await db
      .from("notice_decisions")
      .select("key,state,remind_at")
      .in("key", keys.slice(n, n + 100));
    if (r.error) return new Set<string>();
    for (const d of r.data ?? [])
      if (
        d.state !== "snoozed" ||
        (d.remind_at && Date.parse(d.remind_at) > now)
      )
        hidden.add(d.key);
  }
  return hidden;
}

export async function decideNotice(session: ProfileSession, input: unknown) {
  assertRole(session.role, "team");
  const { key, state, remindAt } = z
    .object({
      key: keySchema,
      state: z.enum(["done", "ignored", "snoozed", "open"]),
      remindAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict()
    .parse(input);
  if (state === "snoozed") {
    const at = remindAt ? Date.parse(remindAt) : NaN;
    if (!(at > Date.now() && at < Date.now() + 90 * 86400000))
      throw new HttpError(400, "Ungültiger Erinnerungszeitpunkt.");
  }
  const db = serviceDb();
  const result =
    state === "open"
      ? await db.from("notice_decisions").delete().eq("key", key)
      : await db.from("notice_decisions").upsert(
          {
            key,
            state,
            remind_at: state === "snoozed" ? remindAt : null,
            actor_id: z.uuid().parse(session.user.id),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" },
        );
  if (result.error) {
    if (missing(result.error))
      throw new HttpError(
        503,
        "Gemeinsames Merken ist noch nicht eingerichtet (Release 050).",
      );
    throw new HttpError(503, "Markierung konnte nicht gespeichert werden.");
  }
  return { ok: true, key, state };
}
