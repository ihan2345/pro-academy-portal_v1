import "server-only";
import { z } from "zod";
import { serviceDb } from "./service-db";
import { assertRole, HttpError } from "./security";
import type { ProfileSession } from "./parent-profile";
import {
  stripeEventTitle,
  type StripeActivityPage,
  type StripeActivity,
} from "../stripe-activities";
const schema = z
  .object({
    window: z.enum(["all", "week"]).default("all"),
    limit: z.union([z.literal(3), z.literal(50)]).default(3),
    asOf: z.string().datetime({ offset: true }),
    cursor: z.string().max(512).optional(),
  })
  .strict();
const cursorSchema = z
  .object({ at: z.number().int().nonnegative(), id: z.uuid() })
  .strict();
const id = (v: any): string | null =>
  typeof v === "string" ? v : typeof v?.id === "string" ? v.id : null;
function checked(r: any): any[] {
  if (r.error)
    throw new HttpError(503, "Stripe-Ereignisse konnten nicht geladen werden.");
  return r.data ?? [];
}
async function collect(make: () => any) {
  const all: any[] = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const rows = checked(
      await make()
        .order("id")
        .range(offset, offset + 499),
    );
    all.push(...rows);
    if (rows.length < 500) return all;
  }
  throw new HttpError(
    503,
    "Zuordnungen konnten nicht vollständig geladen werden.",
  );
}
export async function stripeActivities(
  session: ProfileSession,
  input: unknown,
): Promise<StripeActivityPage> {
  assertRole(session.role, "admin");
  const params = schema.parse(input);
  const asOf = Math.floor(Date.parse(params.asOf) / 1000);
  if (asOf > Date.now() / 1000 + 60)
    throw new HttpError(400, "Ungültiger Zeitpunkt.");
  const db = serviceDb();
  let q = db
    .from("stripe_webhook_events")
    .select("id,stripe_event_id,type,payload,stripe_created,status")
    .lte("stripe_created", asOf)
    .order("stripe_created", { ascending: false })
    .order("id", { ascending: false })
    .limit(params.limit + 1);
  if (params.window === "week") q = q.gt("stripe_created", asOf - 7 * 86400);
  if (params.cursor) {
    let cursor;
    try {
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(params.cursor, "base64url").toString("utf8")),
      );
    } catch {
      throw new HttpError(400, "Ungültige Seitenreferenz.");
    }
    q = q.or(
      `stripe_created.lt.${cursor.at},and(stripe_created.eq.${cursor.at},id.lt.${cursor.id})`,
    );
  }
  const fetched = checked(await q),
    rows = fetched.slice(0, params.limit);
  if (!rows.length) return { rows: [], next: null };
  const events = rows.map((r) => {
    const object = r.payload?.data?.object ?? {};
    return {
      r,
      object,
      customerId:
        r.type === "customer.updated" ? id(object) : id(object.customer),
      subscriptionId: r.type.startsWith("customer.subscription.")
        ? id(object)
        : (id(object.subscription) ??
          id(object.parent?.subscription_details?.subscription)),
    };
  });
  const customerIds = [
    ...new Set(events.map((e) => e.customerId).filter(Boolean)),
  ] as string[];
  const subscriptionIds = [
    ...new Set(events.map((e) => e.subscriptionId).filter(Boolean)),
  ] as string[];
  const [customers, subs, links] = await Promise.all([
    customerIds.length
      ? collect(() =>
          db
            .from("stripe_customer_registry")
            .select("id,name")
            .in("id", customerIds),
        )
      : [],
    subscriptionIds.length
      ? collect(() =>
          db
            .from("subscriptions")
            .select("id,stripe_subscription_id,status,stripe_data")
            .in("stripe_subscription_id", subscriptionIds),
        )
      : [],
    customerIds.length
      ? collect(() =>
          db
            .from("parent_stripe_customers")
            .select("id,stripe_customer_id")
            .in("stripe_customer_id", customerIds),
        )
      : [],
  ]);
  const localIds = subs.map((s) => s.id);
  const [mappings, reviews] = localIds.length
    ? await Promise.all([
        collect(() =>
          db
            .from("subscription_players")
            .select(
              "id,subscription_id,stripe_item_id,players(first_name,last_name,archived_at)",
            )
            .in("subscription_id", localIds),
        ),
        collect(() =>
          db
            .from("subscription_assignment_reviews")
            .select("id,subscription_id")
            .in("subscription_id", localIds)
            .eq("status", "pending"),
        ),
      ])
    : [[], []];
  const result: StripeActivity[] = events.map(
    ({ r, object, customerId, subscriptionId }) => {
      const sub = subs.find((s) => s.stripe_subscription_id === subscriptionId);
      const items: any[] = sub?.stripe_data?.items ?? [];
      const assigned = mappings.filter(
        (m) =>
          m.subscription_id === sub?.id &&
          items.some((i) => i.id === m.stripe_item_id) &&
          m.players &&
          !m.players.archived_at,
      );
      const complete =
        items.length > 0 &&
        items.every(
          (i) =>
            Number(i.quantity ?? 1) === 1 &&
            assigned.some((m) => m.stripe_item_id === i.id),
        );
      const assignment: StripeActivity["assignment"] = subscriptionId
        ? complete
          ? "assigned"
          : assigned.length
            ? "partial"
            : "unassigned"
        : r.type === "customer.updated"
          ? links.some((l) => l.stripe_customer_id === customerId)
            ? "assigned"
            : "unassigned"
          : "not_applicable";
      const pendingReview = reviews.some(
        (review) => review.subscription_id === sub?.id,
      );
      const failed = r.status === "failed";
      const missing =
        (assignment === "unassigned" || assignment === "partial") &&
        !!subscriptionId &&
        (!sub || ["active", "trialing"].includes(sub.status));
      const actionRequired =
        failed || pendingReview || (missing && r.status === "processed");
      return {
        id: r.stripe_event_id,
        at: new Date(r.stripe_created * 1000).toISOString(),
        title: stripeEventTitle(
          r.type,
          object,
          r.payload?.data?.previous_attributes,
        ),
        customer:
          customers.find((c) => c.id === customerId)?.name ||
          object.customer_details?.name ||
          object.customer_name ||
          (r.type === "customer.updated" ? object.name : null) ||
          customerId ||
          "Kunde nicht angegeben",
        subscriptionId,
        assignment,
        children: [
          ...new Set(
            assigned.map(
              (m) => `${m.players.first_name} ${m.players.last_name}`,
            ),
          ),
        ] as string[],
        actionRequired,
        actionLabel: failed
          ? "Verarbeitung prüfen"
          : pendingReview
            ? "Zuordnung / Tarif prüfen"
            : actionRequired
              ? "Kind zuordnen"
              : null,
        href: failed
          ? "/admin/protokolle"
          : pendingReview
            ? "/admin"
            : actionRequired && customerId
              ? `/admin/stripe?customer=${encodeURIComponent(customerId)}`
              : null,
      };
    },
  );
  const last = rows.at(-1);
  return {
    rows: result,
    next:
      fetched.length > params.limit
        ? Buffer.from(
            JSON.stringify({ at: last.stripe_created, id: last.id }),
          ).toString("base64url")
        : null,
  };
}
