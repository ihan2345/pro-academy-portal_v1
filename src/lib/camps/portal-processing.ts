import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checked } from "@/lib/server/products/context";
import { confirmPayment } from "./service";

async function collect(make: () => any, key = "id") {
  const rows: any[] = [];
  let after: string | undefined;
  for (;;) {
    let q = make().order(key).limit(500);
    if (after) q = q.gt(key, after);
    const batch = checked<any[]>(await q);
    rows.push(...batch);
    if (batch.length < 500) return rows;
    const next = batch.at(-1)?.[key];
    if (!next || next === after)
      throw new Error("Unvollständiger Camp-Abgleich");
    after = next;
  }
}
export async function processPortalCampBookings(
  db: SupabaseClient,
  owner: string,
) {
  const [events, drafts] = await Promise.all([
    collect(
      () =>
        db
          .from("camp_payment_events")
          .select("event_id,session_id")
          .is("payment_link_id", null)
          .is("processed_at", null),
      "event_id",
    ),
    collect(() =>
      db
        .from("camp_bookings")
        .select("id,checkout_session_id,camps!inner(payment_mode)")
        .eq("booking_origin", "portal_checkout")
        .eq("camps.payment_mode", "live")
        .in("status", ["draft", "review"])
        .gt("created_at", new Date(Date.now() - 2 * 86400000).toISOString()),
    ),
  ]);
  const sessions = [
    ...new Set(
      [
        ...events.map((e) => e.session_id),
        ...drafts.map((b) => b.checkout_session_id),
      ].filter(Boolean),
    ),
  ];
  let checkedCount = 0,
    failed = 0;
  for (const session of sessions) {
    if (!checked(await db.rpc("camp_claim_processing", { owner })))
      throw new Error("Camp-Verarbeitung wurde übernommen.");
    try {
      const result = await confirmPayment(session, true);
      if (result.status !== "pending")
        checked(
          await db
            .from("camp_payment_events")
            .update({ processed_at: new Date().toISOString() })
            .eq("session_id", session)
            .is("payment_link_id", null)
            .is("processed_at", null),
        );
      checkedCount++;
    } catch {
      failed++;
    }
  }
  return { checked: checkedCount, failed };
}
