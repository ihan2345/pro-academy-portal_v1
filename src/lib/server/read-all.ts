import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Use a stable unique order and respect PostgREST's default 1,000-row ceiling. */
export async function readAll(
  db: SupabaseClient,
  table: string,
  columns: string,
) {
  const rows: Record<string, any>[] = [];
  let after: string | undefined;
  for (;;) {
    let query = db.from(table).select(columns).order("id").limit(500);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 500) return rows;
    const next = rows.at(-1)?.id;
    if (typeof next !== "string" || next === after)
      throw new Error("Unvollständige Kunden- oder Trainingsliste");
    after = next;
  }
}
