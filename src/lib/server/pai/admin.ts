import "server-only";
import type { ProfileSession } from "../parent-profile";
import { HttpError } from "../security";
import { serviceDb } from "../service-db";
import { configuration, checked } from "./service";
import { berlinWindow } from "../../pai/domain";
export async function adminSummary(s: ProfileSession, search = "", offset = 0) {
  if (s.role !== "admin") throw new HttpError(403, "Nur für Admins.");
  const db = serviceDb(),
    { config, version } = await configuration();
  const month = berlinWindow("month").start,
    day = berlinWindow("day").start;
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  // Paginated metadata only; never fetch prompt/answer into admin responses.
  const usage: any[] = [];
  for (let page = 0; page < 100; page++) {
    const rows = checked(
      await db
        .from("pai_requests")
        .select(
          "id,user_id,role,status,created_at,cost_usd,reserve_usd,input_tokens,output_tokens,error_code,lease_until",
        )
        .gte("created_at", since < month ? since : month)
        .order("id")
        .range(page * 500, page * 500 + 499),
    );
    usage.push(...rows);
    if (rows.length < 500) break;
    if (page === 99)
      throw new HttpError(503, "Nutzungsbericht zu groß. Zeitraum eingrenzen.");
  }
  const monthly = usage.filter((r) => r.created_at >= month),
    spent = monthly.reduce((n, r) => n + Number(r.cost_usd), 0),
    reserved = monthly.reduce((n, r) => n + Number(r.reserve_usd), 0);
  let query = db
    .from("profiles")
    .select("id,full_name,role")
    .order("full_name")
    .order("id")
    .range(offset, offset + 24);
  const term = search.replace(/[^\p{L}\p{N} -]/gu, "").slice(0, 80);
  if (term) query = query.ilike("full_name", `%${term}%`);
  const users = checked(await query);
  const overrides = users.length
    ? checked(
        await db
          .from("pai_overrides")
          .select("*")
          .in(
            "user_id",
            users.map((u) => u.id),
          ),
      )
    : [];
  return {
    config,
    version,
    spent,
    reserved,
    remaining: Math.max(0, config.budgetUsd - spent - reserved),
    warning:
      config.budgetUsd === 0
        ? 100
        : Math.floor(((spent + reserved) / config.budgetUsd) * 100),
    today: usage.filter((r) => r.created_at >= day && r.status === "completed")
      .length,
    month: monthly.filter((r) => r.status === "completed").length,
    activeUsers: new Set(
      monthly.filter((r) => r.status === "completed").map((r) => r.user_id),
    ).size,
    tokens: monthly.reduce((n, r) => n + r.input_tokens + r.output_tokens, 0),
    errors: monthly.filter((r) => r.status === "failed").length,
    roles: ["parent", "staff", "admin"].map((role) => ({
      role,
      questions: monthly.filter(
        (r) => r.role === role && r.status === "completed",
      ).length,
    })),
    users: users.map((u) => {
      const rows = usage.filter((r) => r.user_id === u.id);
      return {
        ...u,
        override: overrides.find((o) => o.user_id === u.id) ?? null,
        today: rows.filter(
          (r) => r.created_at >= day && r.status === "completed",
        ).length,
        last30: rows.filter(
          (r) => r.created_at >= since && r.status === "completed",
        ).length,
        cost: rows.reduce((n, r) => n + Number(r.cost_usd), 0),
        last:
          rows
            .map((r) => r.created_at)
            .sort()
            .at(-1) ?? null,
      };
    }),
    more: users.length === 25,
  };
}
