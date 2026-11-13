import "server-only";
import { serviceDb } from "@/lib/server/service-db";
import { HttpError } from "@/lib/server/security";
import { campCustomerGroup } from "./customers";

type Result = { data: unknown; error: unknown };
/** Stable ordering in each caller prevents truncation at the REST row limit. */
export async function campRows<T>(
  page: (from: number, to: number) => PromiseLike<Result>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await page(from, from + 499);
    if (result.error || !Array.isArray(result.data))
      throw new HttpError(
        503,
        "Camp-Kundenliste konnte nicht vollständig geladen werden.",
      );
    rows.push(...(result.data as T[]));
    if (result.data.length < 500) return rows;
  }
}
async function related<T>(
  ids: (string | null | undefined)[],
  page: (ids: string[], from: number, to: number) => PromiseLike<Result>,
) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const rows: T[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    const batch = unique.slice(i, i + 200);
    rows.push(...(await campRows<T>((from, to) => page(batch, from, to))));
  }
  return rows;
}
type Identity = {
  parent_id?: string | null;
  player_id?: string | null;
  product_intent_id?: string | null;
  created_at: string;
};
export async function classifyCampCustomers<T extends Identity>(
  bookings: T[],
  db = serviceDb(),
) {
  const now = new Date().toISOString();
  const [parents, intents, mappings, periods] = await Promise.all([
    related<{ id: string; created_at: string }>(
      bookings.map((b) => b.parent_id),
      (ids, from, to) =>
        db
          .from("parents")
          .select("id,created_at")
          .in("id", ids)
          .order("id")
          .range(from, to),
    ),
    related<{
      id: string;
      created_at: string;
      product: {
        booking_option_selected?: boolean;
        booking_option?: { title: string };
      };
    }>(
      bookings.map((b) => b.product_intent_id),
      (ids, from, to) =>
        db
          .from("product_purchase_intents")
          .select("id,created_at,product")
          .in("id", ids)
          .order("id")
          .range(from, to),
    ),
    related<{ player_id: string }>(
      bookings.map((b) => b.player_id),
      (ids, from, to) =>
        db
          .from("subscription_players")
          .select("player_id,subscriptions!inner(status)")
          .in("player_id", ids)
          .eq("subscriptions.status", "active")
          .order("subscription_id")
          .order("stripe_item_id")
          .order("player_id")
          .range(from, to),
    ),
    related<{ player_id: string }>(
      bookings.map((b) => b.player_id),
      (ids, from, to) =>
        db
          .from("entitlement_periods")
          .select("id,player_id,subscriptions!inner(status)")
          .in("player_id", ids)
          .eq("status", "active")
          .eq("subscriptions.status", "active")
          .lte("starts_at", now)
          .gt("ends_at", now)
          .order("id")
          .range(from, to),
    ),
  ]);
  const parentMap = new Map(parents.map((p) => [p.id, p]));
  const intentMap = new Map(intents.map((i) => [i.id, i]));
  const active = new Set([...mappings, ...periods].map((m) => m.player_id));
  return bookings.map((b) => {
    const intent = intentMap.get(b.product_intent_id ?? "");
    return {
      ...b,
      customer_group: campCustomerGroup({
        activeSubscription: active.has(b.player_id ?? ""),
        parentCreatedAt: parentMap.get(b.parent_id ?? "")?.created_at,
        bookingStartedAt: intent?.created_at ?? b.created_at,
      }),
      option_title: intent?.product?.booking_option_selected
        ? (intent.product.booking_option?.title ?? "")
        : "",
    };
  });
}
