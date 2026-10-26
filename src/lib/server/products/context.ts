import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ProductContext,
  ProductChild,
  Membership,
} from "@/lib/products/domain";
import { visitorContext } from "@/lib/products/domain";
import type { ProfileSession } from "../parent-profile";
import { serviceDb } from "../service-db";
import { HttpError } from "../security";
import { requireProducts } from "./runtime";
export function checked<T = any>(r: { data: any; error: any }): T {
  if (r.error)
    throw new HttpError(
      503,
      "Produktdaten konnten nicht vollständig geladen werden.",
    );
  return r.data as T;
}

export async function collect(make: () => any): Promise<any[]> {
  const rows: any[] = [];
  let after: string | undefined;
  for (;;) {
    let q = make().order("id").limit(500);
    if (after) q = q.gt("id", after);
    const batch = checked<any[]>(await q);
    rows.push(...batch);
    if (batch.length < 500) return rows;
    const next = batch.at(-1)?.id;
    if (!next || next === after)
      throw new HttpError(503, "Unvollständige Produktdaten.");
    after = next;
  }
}
export async function loadProductContext(
  session: ProfileSession | null,
  parentOverride?: string,
  db: SupabaseClient = serviceDb(),
): Promise<ProductContext> {
  requireProducts();
  if (!session?.user && !parentOverride) return visitorContext();
  if (parentOverride && session?.role !== "admin")
    throw new HttpError(403, "Keine Berechtigung.");
  const context: ProductContext = {
    ...visitorContext(),
    auth_id: session?.user.id ?? null,
    role: session?.role ?? null,
  };
  if (!parentOverride && session?.role !== "parent") return context;
  let q = db.from("parents").select("id,auth_user_id").is("archived_at", null);
  q = parentOverride
    ? q.eq("id", parentOverride)
    : q.eq("auth_user_id", session!.user.id);
  const parent = checked(await q.maybeSingle());
  if (!parent) return context;
  context.parent_id = parent.id;
  context.auth_id = parent.auth_user_id;
  context.role = "parent";
  const [links, families, purchases, grants] = await Promise.all([
    collect(() =>
      db
        .from("parent_players")
        .select(
          "id,players!inner(id,first_name,last_name,camp_birth_date,archived_at)",
        )
        .eq("parent_id", parent.id),
    ),
    collect(() =>
      db
        .from("trial_families")
        .select("id,created_at,stopped_at")
        .eq("parent_id", parent.id),
    ),
    collect(() =>
      db
        .from("product_purchases")
        .select(
          "id,product_id,player_id,status,product_purchase_intents!inner(product,camp_booking_id)",
        )
        .eq("parent_id", parent.id),
    ),
    collect(() =>
      db
        .from("catalog_product_grants")
        .select("*")
        .or(
          `parent_id.eq.${parent.id}${parent.auth_user_id ? `,auth_id.eq.${parent.auth_user_id}` : ""}`,
        ),
    ),
  ]);
  const trial = families.length
    ? await collect(() =>
        db
          .from("trial_players")
          .select("id,family_id,first_name,last_name,birth_date,converted_at")
          .in(
            "family_id",
            families.map((f) => f.id),
          ),
      )
    : [];
  const children = new Map<string, ProductChild>();
  for (const { players: c } of links)
    if (!c.archived_at)
      children.set(c.id, {
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        first_name: c.first_name,
        last_name: c.last_name,
        birth_date: c.camp_birth_date,
        trial: false,
        former_trial: false,
        memberships: [],
        camp_ids: [],
        purchases: [],
      });
  for (const c of trial) {
    const f = families.find((f) => f.id === c.family_id)!;
    const active =
      !c.converted_at &&
      !f.stopped_at &&
      Date.parse(f.created_at) + 180 * 86400000 > Date.now();
    const old = children.get(c.id);
    children.set(c.id, {
      ...(old ?? {
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        first_name: c.first_name,
        last_name: c.last_name,
        birth_date: c.birth_date,
        memberships: [],
        camp_ids: [],
        purchases: [],
      }),
      trial: active,
      former_trial: !active && !c.converted_at,
    });
  }
  const ids = [...children.keys()];
  if (ids.length) {
    const [mappings, periods, bookings] = await Promise.all([
      collect(() =>
        db
          .from("subscription_players")
          .select(
            "id,player_id,stripe_item_id,subscriptions!inner(id,stripe_subscription_id,stripe_customer_id,status,needs_review,stripe_data)",
          )
          .in("player_id", ids),
      ),
      collect(() =>
        db
          .from("entitlement_periods")
          .select(
            "id,player_id,subscription_id,stripe_item_id,stripe_price_id,status,starts_at,ends_at",
          )
          .in("player_id", ids),
      ),
      collect(() =>
        db
          .from("camp_bookings")
          .select("id,player_id,camp_id,status")
          .eq("parent_id", parent.id)
          .in("player_id", ids),
      ),
    ]);
    const prices = [
      ...new Set(
        mappings.flatMap((m) =>
          (m.subscriptions.stripe_data.items ?? [])
            .filter((i: any) => i.id === m.stripe_item_id)
            .map((i: any) => i.price_id),
        ),
      ),
    ];
    const plans = prices.length
      ? await collect(() =>
          db.from("plans").select("*").in("stripe_price_id", prices),
        )
      : [];
    for (const m of mappings) {
      const s = m.subscriptions,
        item = (s.stripe_data.items ?? []).find(
          (i: any) => i.id === m.stripe_item_id,
        ),
        plan = plans.find((p) => p.stripe_price_id === item?.price_id);
      const current =
        periods.some(
          (p) =>
            p.player_id === m.player_id &&
            p.subscription_id === s.id &&
            p.stripe_item_id === m.stripe_item_id &&
            p.stripe_price_id === item?.price_id &&
            ["active", "trialing"].includes(p.status) &&
            Date.parse(p.starts_at) <= Date.now() &&
            Date.parse(p.ends_at) > Date.now(),
        ) && ["active", "trialing"].includes(s.status);
      const member: Membership = {
        subscription_id: s.id,
        stripe_subscription_id: s.stripe_subscription_id,
        item_id: m.stripe_item_id,
        price_id: item?.price_id ?? "",
        status: s.status,
        review: s.needs_review,
        current,
        plan: plan?.name ?? "Unbekannt",
        units: plan?.included_units ?? 0,
        athletics: plan?.athletics_units ?? 0,
        interval: plan?.billing_interval ?? "month",
        ends_at: item?.ends_at ?? null,
        cancel_at_period_end: s.stripe_data.cancel_at_period_end === true,
        cancel_at: s.stripe_data.cancel_at ?? null,
      };
      children.get(m.player_id)!.memberships.push(member);
    }
    for (const b of bookings)
      if (b.status === "paid")
        children.get(b.player_id)?.camp_ids.push(b.camp_id);
    for (const p of purchases)
      if (
        p.status === "active" &&
        (p.product_purchase_intents.product.kind !== "camp" ||
          bookings.some(
            (b) =>
              b.id === p.product_purchase_intents.camp_booking_id &&
              b.status === "paid",
          ))
      )
        children.get(p.player_id)?.purchases.push(p.product_id);
  }
  context.children = [...children.values()];
  context.grants = grants
    .filter((g) => !g.expires_at || Date.parse(g.expires_at) > Date.now())
    .map((g) => ({
      product_id: g.product_id,
      purpose: g.purpose,
      player_id: g.player_id,
    }));
  return context;
}
