import "server-only";
import { z } from "zod";
import { serviceDb } from "./service-db";
import { assertRole, HttpError } from "./security";
import {
  describeActivity,
  type ActivityPage,
  type ActivitySummary,
} from "../activities";
import type { ProfileSession } from "./parent-profile";
const stamp = z.string().datetime({ offset: true });
const cursorSchema = z
  .object({ at: stamp, id: z.string().regex(/^[aj]:[0-9a-f-]{36}$/) })
  .strict();
const querySchema = z
  .object({
    window: z.enum(["0", "1", "2", "all", "issues", "week"]).default("0"),
    scope: z.enum(["all", "stripe"]).default("all"),
    limit: z.union([z.literal(3), z.literal(50)]).default(50),
    asOf: stamp.optional(),
    cursor: z.string().max(512).optional(),
  })
  .strict();
const HOUR = 3600000;
function checked<T>(r: { data: T; error: any }) {
  if (r.error)
    throw new HttpError(
      503,
      "Aktivitäten konnten nicht geladen werden. Bitte später erneut versuchen.",
    );
  return r.data;
}
export async function activitySummary(
  session: ProfileSession,
): Promise<ActivitySummary> {
  assertRole(session.role, "team");
  const db = serviceDb(),
    asOf = new Date().toISOString(),
    since = new Date(Date.parse(asOf) - 72 * HOUR).toISOString();
  const [recent, open] = await Promise.all([
    db
      .from("activity_feed")
      .select("id", { count: "exact", head: true })
      .gt("occurred_at", since)
      .lte("occurred_at", asOf),
    db
      .from("activity_feed")
      .select("id", { count: "exact", head: true })
      .eq("is_open", true)
      .lte("occurred_at", asOf),
  ]);
  checked(recent);
  checked(open);
  return { asOf, recent: recent.count ?? 0, open: open.count ?? 0 };
}
export async function activityList(
  session: ProfileSession,
  input: unknown,
): Promise<ActivityPage> {
  assertRole(session.role, "team");
  const parsed = querySchema.parse(input),
    asOf = parsed.asOf ?? new Date().toISOString();
  if (Date.parse(asOf) > Date.now() + 60000)
    throw new HttpError(400, "Ungültiger Zeitpunkt.");
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (parsed.cursor) {
    try {
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(parsed.cursor, "base64url").toString("utf8")),
      );
    } catch {
      throw new HttpError(400, "Ungültige Seitenreferenz.");
    }
  }
  const db = serviceDb();
  const base = (count = false) => {
    let q = db
      .from("activity_feed")
      .select(
        count ? "id" : "id,occurred_at,kind,subject,actor,details,is_open",
        count ? { count: "exact", head: true } : undefined,
      )
      .lte("occurred_at", asOf);
    if (parsed.scope === "stripe")
      q = q.in("kind", [
        "stripe",
        "subscription",
        "assignment",
        "review",
        "period",
        "package",
      ]);
    if (parsed.window === "week")
      q = q.gt(
        "occurred_at",
        new Date(Date.parse(asOf) - 7 * 24 * HOUR).toISOString(),
      );
    else if (parsed.window === "issues") q = q.eq("is_open", true);
    else if (parsed.window !== "all") {
      const n = Number(parsed.window);
      q = q.gt(
        "occurred_at",
        new Date(Date.parse(asOf) - (n + 1) * 24 * HOUR).toISOString(),
      );
      if (n)
        q = q.lte(
          "occurred_at",
          new Date(Date.parse(asOf) - n * 24 * HOUR).toISOString(),
        );
    }
    return q;
  };
  let q = base()
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(parsed.limit + 1);
  if (cursor)
    q = q.or(
      `occurred_at.lt.${cursor.at},and(occurred_at.eq.${cursor.at},id.lt.${cursor.id})`,
    );
  const [response, count] = await Promise.all([q, base(true)]);
  const rows = checked(response) as any[];
  checked(count);
  const batch = rows.slice(0, parsed.limit),
    last = batch.at(-1);
  return {
    rows: batch.map((r) => describeActivity(r, session.role === "admin")),
    total: count.count ?? 0,
    next:
      rows.length > parsed.limit && last
        ? Buffer.from(
            JSON.stringify({ at: last.occurred_at, id: last.id }),
          ).toString("base64url")
        : null,
  };
}
