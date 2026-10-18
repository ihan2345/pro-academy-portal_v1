import "server-only";
import { z } from "zod";
import type { ProfileSession } from "./parent-profile";
import { profileStripeClient } from "./profile-stripe";
import { serviceDb } from "./service-db";
import { assertRole, HttpError } from "./security";
import type { SubscriptionReviewPage } from "../subscription-reviews";

function checked<T>(result: { data: T; error: any }): NonNullable<T> {
  if (result.error)
    throw new HttpError(
      503,
      ["42P01", "PGRST205", "PGRST202"].includes(result.error.code)
        ? "Die Paketwechsel-Prüfung benötigt noch die vorbereitete Datenbankmigration 011."
        : "Abo-Prüfungen konnten nicht geladen werden.",
    );
  return result.data as NonNullable<T>;
}
async function collect(make: () => any): Promise<any[]> {
  const rows: any[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    let q = make().order("id").limit(500);
    if (after) q = q.gt("id", after);
    const batch = checked<any[]>(await q);
    rows.push(...batch);
    if (batch.length < 500) return rows;
    after = batch.at(-1).id;
  }
  throw new HttpError(
    503,
    "Zu viele Zuordnungen für eine vollständige Prüfung.",
  );
}
export async function subscriptionReviews(
  session: ProfileSession,
  offset = 0,
): Promise<SubscriptionReviewPage> {
  assertRole(session.role, "admin");
  offset = z.number().int().min(0).max(100000).parse(offset);
  const db = serviceDb();
  const response = await db
    .from("subscription_assignment_reviews")
    .select(
      "id,signature,created_at,item,subscription_id,previous_item_ids,suggested_player_ids,subscriptions!inner(parent_id,stripe_customer_id,stripe_subscription_id,status,synced_at,stripe_data)",
      { count: "exact" },
    )
    .eq("status", "pending")
    .order("created_at")
    .order("id")
    .range(offset, offset + 24);
  const rows = checked(response) as any[];
  if (!rows.length) return { rows: [], total: response.count ?? 0 };
  const subIds = rows.map((r) => r.subscription_id),
    customerIds = [
      ...new Set(rows.map((r) => r.subscriptions.stripe_customer_id)),
    ];
  const [oldMappings, customerLinks, plans, customers, approvals] =
    await Promise.all([
      collect(() =>
        db
          .from("subscription_players")
          .select(
            "id,subscription_id,stripe_item_id,player_id,players!inner(id,first_name,last_name,archived_at)",
          )
          .in("subscription_id", subIds),
      ),
      collect(() =>
        db
          .from("parent_stripe_customers")
          .select("id,parent_id,stripe_customer_id")
          .in("stripe_customer_id", customerIds),
      ),
      collect(() =>
        db
          .from("plans")
          .select("id,stripe_price_id,name,included_units,generation")
          .eq("active", true),
      ),
      collect(() =>
        db
          .from("stripe_customer_registry")
          .select("id,name,email")
          .in("id", customerIds),
      ),
      collect(() =>
        db
          .from("subscription_legacy_approvals")
          .select("id,subscription_id,stripe_price_id")
          .in("subscription_id", subIds),
      ),
    ]);
  // Read missing customer details only; opening the review never creates links.
  const customerDetails = new Map(customers.map((c) => [c.id, c]));
  await Promise.all(
    customerIds.map(async (id) => {
      if (customerDetails.get(id)?.name && customerDetails.get(id)?.email)
        return;
      try {
        const customer = await profileStripeClient().customers.retrieve(id, {
          timeout: 6000,
          maxNetworkRetries: 0,
        });
        if (!customer.deleted)
          customerDetails.set(id, {
            id,
            name: customer.name,
            email: customer.email,
          });
      } catch {
        /* Keep local details and explicit missing-data notice. */
      }
    }),
  );
  const parentIds = [
    ...new Set(
      [
        ...rows.map((r) => r.subscriptions.parent_id),
        ...customerLinks.map((l) => l.parent_id),
      ].filter(Boolean),
    ),
  ];
  const familyLinks = parentIds.length
    ? await collect(() =>
        db
          .from("parent_players")
          .select(
            "id,parent_id,player_id,players!inner(id,first_name,last_name,archived_at)",
          )
          .in("parent_id", parentIds)
          .is("players.archived_at", null),
      )
    : [];
  const parents = parentIds.length
    ? await collect(() =>
        db.from("parents").select("id,full_name").in("id", parentIds),
      )
    : [];
  const name = (p: any) => `${p.first_name} ${p.last_name}`;
  return {
    total: response.count ?? 0,
    rows: rows.map((r) => {
      const suggestions = oldMappings
        .filter(
          (m) =>
            m.subscription_id === r.subscription_id &&
            r.previous_item_ids.includes(m.stripe_item_id),
        )
        .map((m) => ({
          playerId: m.player_id,
          name:
            name(m.players) + (m.players.archived_at ? " (archiviert)" : ""),
          archived: !!m.players.archived_at,
          previousItemId: m.stripe_item_id,
        }));
      const familyIds = new Set([
        r.subscriptions.parent_id,
        ...customerLinks
          .filter(
            (l) => l.stripe_customer_id === r.subscriptions.stripe_customer_id,
          )
          .map((l) => l.parent_id),
      ]);
      const candidates = [
        ...new Map(
          [
            ...suggestions
              .filter((s) => !s.archived)
              .map((s) => ({ id: s.playerId, name: s.name })),
            ...familyLinks
              .filter((l) => familyIds.has(l.parent_id))
              .map((l) => ({ id: l.player_id, name: name(l.players) })),
          ].map((p) => [p.id, p]),
        ).values(),
      ];
      const plan = plans.find((p) => p.stripe_price_id === r.item.price_id);
      return {
        id: r.id,
        signature: r.signature,
        context: {
          customerId: r.subscriptions.stripe_customer_id,
          customerName:
            customerDetails.get(r.subscriptions.stripe_customer_id)?.name ??
            null,
          customerEmail:
            customerDetails.get(r.subscriptions.stripe_customer_id)?.email ??
            null,
          customerDetailsUnavailable:
            !customerDetails.get(r.subscriptions.stripe_customer_id)?.name ||
            !customerDetails.get(r.subscriptions.stripe_customer_id)?.email,
          subscriptionId: r.subscriptions.stripe_subscription_id,
          status: r.subscriptions.status,
          createdAt: r.created_at,
          syncedAt: r.subscriptions.synced_at,
          itemId: r.item.id,
          priceId: r.item.price_id,
          parents: parents
            .filter((p) => familyIds.has(p.id))
            .map((p) => ({ id: p.id, name: p.full_name })),
        },
        requiresLegacyConfirmation:
          plan?.generation === "legacy" &&
          (!r.subscriptions.stripe_data?.subscription_created_at ||
            Date.parse(r.subscriptions.stripe_data.subscription_created_at) >=
              Date.parse("2026-08-31T22:00:00Z")) &&
          !approvals.some(
            (a) =>
              a.subscription_id === r.subscription_id &&
              a.stripe_price_id === r.item.price_id,
          ),
        product: plan?.name ?? "Tarif noch nicht zugeordnet",
        units: plan?.included_units ?? null,
        startsAt: r.item.starts_at,
        endsAt: r.item.ends_at,
        quantity: r.item.quantity ?? 1,
        suggestions,
        candidates,
      };
    }),
  };
}
export const subscriptionReviewDecision = z
  .object({
    review_id: z.uuid(),
    signature: z.string().regex(/^[a-f0-9]{32}$/),
    player_id: z.uuid(),
    previous_item_id: z.string().min(1).max(200).nullable(),
    confirm_legacy_tariff: z.boolean().optional().default(false),
  })
  .strict();
export async function resolveSubscriptionReview(
  session: ProfileSession,
  input: unknown,
) {
  assertRole(session.role, "admin");
  const decision = subscriptionReviewDecision.parse(input);
  const result = await session.db.rpc("resolve_subscription_assignment", {
    input: decision,
  });
  if (result.error) {
    if (["42883", "PGRST202"].includes(result.error.code))
      throw new HttpError(
        503,
        "Die Paketwechsel-Prüfung benötigt noch die vorbereitete Datenbankmigration 011.",
      );
    throw new HttpError(409, result.error.message);
  }
  return { ok: true };
}
