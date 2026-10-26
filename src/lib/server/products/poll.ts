import "server-only";
import { serviceDb } from "../service-db";
import { checked } from "./context";
import { productStripe } from "./stripe";
import { enqueueProductEvent, productEventTypes } from "./events";
import { requireProductPayments } from "./runtime";
export async function pollProductEvents() {
  requireProductPayments();
  const db = serviceDb(),
    stripe = productStripe(),
    now = Math.floor(Date.now() / 1000);
  const previous = checked(
    await db
      .from("system_settings")
      .select("value")
      .eq("key", "product_event_poll")
      .maybeSingle(),
  )?.value;
  const since = Math.max(
    now - 29 * 86400,
    Number(previous?.through ?? now - 300) - 300,
  );
  let imported = 0;
  // Persist the watermark only after complete pagination. Overlap and the unique
  // event ID handle concurrent workers, delayed delivery and restart safely.
  for await (const event of stripe.events.list({
    created: { gte: since, lte: now },
    types: productEventTypes,
    limit: 100,
  })) {
    await enqueueProductEvent(event);
    imported++;
  }
  checked(
    await db
      .from("system_settings")
      .upsert(
        {
          key: "product_event_poll",
          value: {
            through: now,
            checked_at: new Date().toISOString(),
            imported,
          },
        },
        { onConflict: "key" },
      )
      .select("key"),
  );
  return { imported };
}
export async function productWorkerHeartbeat(error: boolean) {
  checked(
    await serviceDb()
      .from("system_settings")
      .upsert(
        {
          key: "product_worker_health",
          value: { at: new Date().toISOString(), ok: !error },
        },
        { onConflict: "key" },
      )
      .select("key"),
  );
}
