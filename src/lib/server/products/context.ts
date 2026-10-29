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
  snapshot?: FamilyContextSnapshot,
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
  const now = snapshot?.now ?? Date.now();
  if (!parentOverride && session?.role !== "parent") return context;
  let q = db.from("parents").select("id,auth_user_id").is("archived_at", null);
  q = parentOverride
    ? q.eq("id", parentOverride)
    : q.eq("auth_user_id", session!.user.id);
  const parent = snapshot?.parent ?? checked(await q.maybeSingle());
  if (!parent) return context;
  context.parent_id = parent.id;
  context.auth_id = parent.auth_user_id;
  context.role = "parent";
  const [links, families, purchases, grants] = snapshot
    ? [snapshot.links, snapshot.families, snapshot.purchases, snapshot.grants]
    : await Promise.all([
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
  const trial =
    snapshot?.trial ??
    (families.length
      ? await collect(() =>
          db
            .from("trial_players")
            .select("id,family_id,first_name,last_name,birth_date,converted_at")
            .in(
              "family_id",
              families.map((f) => f.id),
            ),
        )
      : []);
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
      Date.parse(f.created_at) + 180 * 86400000 > now;
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
    const [mappings, periods, bookings] = snapshot
      ? [snapshot.mappings, snapshot.periods, snapshot.bookings]
      : await Promise.all([
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
    const plans =
      snapshot?.plans ??
      (prices.length
        ? await collect(() =>
            db.from("plans").select("*").in("stripe_price_id", prices),
          )
        : []);
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
            Date.parse(p.starts_at) <= now &&
            Date.parse(p.ends_at) > now,
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
    .filter((g) => !g.expires_at || Date.parse(g.expires_at) > now)
    .map((g) => ({
      product_id: g.product_id,
      purpose: g.purpose,
      player_id: g.player_id,
    }));
  return context;
}

type ContextParent = { id: string; auth_user_id: string | null };
type FamilyContextSnapshot = {
  parent: ContextParent;
  now: number;
  links: any[];
  families: any[];
  purchases: any[];
  grants: any[];
  trial: any[];
  mappings: any[];
  periods: any[];
  bookings: any[];
  plans: any[];
};

// Bound IN-list size independently of row pagination and preserve the single-family
// loader's ID order, including when rows span multiple chunks/pages.
async function collectByIds(make: () => any, column: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows: any[] = [];
  for (let i = 0; i < unique.length; i += 100)
    rows.push(
      ...(await collect(() => make().in(column, unique.slice(i, i + 100)))),
    );
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

/** Same context assembly and policy as individual reads, with shared batch reads. */
export async function loadProductContexts(
  session: ProfileSession,
  parents: ContextParent[],
  db: SupabaseClient = serviceDb(),
  now = Date.now(),
): Promise<ProductContext[]> {
  requireProducts();
  if (session.role !== "admin") throw new HttpError(403, "Keine Berechtigung.");
  if (!parents.length) return [];
  const parentIds = parents.map((p) => p.id);
  const authIds = parents.flatMap((p) =>
    p.auth_user_id ? [p.auth_user_id] : [],
  );
  const [links, families, purchases, parentGrants, authGrants] =
    await Promise.all([
      collectByIds(
        () =>
          db
            .from("parent_players")
            .select(
              "id,parent_id,players!inner(id,first_name,last_name,camp_birth_date,archived_at)",
            ),
        "parent_id",
        parentIds,
      ),
      collectByIds(
        () =>
          db
            .from("trial_families")
            .select("id,parent_id,created_at,stopped_at"),
        "parent_id",
        parentIds,
      ),
      collectByIds(
        () =>
          db
            .from("product_purchases")
            .select(
              "id,parent_id,product_id,player_id,status,product_purchase_intents!inner(product,camp_booking_id)",
            ),
        "parent_id",
        parentIds,
      ),
      collectByIds(
        () => db.from("catalog_product_grants").select("*"),
        "parent_id",
        parentIds,
      ),
      collectByIds(
        () => db.from("catalog_product_grants").select("*"),
        "auth_id",
        authIds,
      ),
    ]);
  const grants = [
    ...new Map([...parentGrants, ...authGrants].map((g) => [g.id, g])).values(),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const trial = await collectByIds(
    () =>
      db
        .from("trial_players")
        .select("id,family_id,first_name,last_name,birth_date,converted_at"),
    "family_id",
    families.map((f) => f.id),
  );
  const playerIds = [
    ...new Set([
      ...links.filter((l) => !l.players.archived_at).map((l) => l.players.id),
      ...trial.map((t) => t.id),
    ]),
  ];
  const [mappings, periods, bookings] = await Promise.all([
    collectByIds(
      () =>
        db
          .from("subscription_players")
          .select(
            "id,player_id,stripe_item_id,subscriptions!inner(id,stripe_subscription_id,stripe_customer_id,status,needs_review,stripe_data)",
          ),
      "player_id",
      playerIds,
    ),
    collectByIds(
      () =>
        db
          .from("entitlement_periods")
          .select(
            "id,player_id,subscription_id,stripe_item_id,stripe_price_id,status,starts_at,ends_at",
          ),
      "player_id",
      playerIds,
    ),
    collectByIds(
      () =>
        db
          .from("camp_bookings")
          .select("id,parent_id,player_id,camp_id,status")
          .in("parent_id", parentIds),
      "player_id",
      playerIds,
    ),
  ]);
  const prices = mappings.flatMap((m) =>
    (m.subscriptions.stripe_data.items ?? [])
      .filter((i: any) => i.id === m.stripe_item_id)
      .map((i: any) => i.price_id),
  );
  const plans = await collectByIds(
    () => db.from("plans").select("*"),
    "stripe_price_id",
    prices,
  );
  return Promise.all(
    parents.map((parent) => {
      const familyLinks = links.filter((l) => l.parent_id === parent.id);
      const familyTrials = families.filter((f) => f.parent_id === parent.id);
      const familyTrialIds = new Set(familyTrials.map((f) => f.id));
      const trialChildren = trial.filter((t) =>
        familyTrialIds.has(t.family_id),
      );
      const children = new Set([
        ...familyLinks
          .filter((l) => !l.players.archived_at)
          .map((l) => l.players.id),
        ...trialChildren.map((t) => t.id),
      ]);
      return loadProductContext(session, parent.id, db, {
        parent,
        now,
        links: familyLinks,
        families: familyTrials,
        purchases: purchases.filter((p) => p.parent_id === parent.id),
        grants: grants.filter(
          (g) =>
            g.parent_id === parent.id ||
            (!!parent.auth_user_id && g.auth_id === parent.auth_user_id),
        ),
        trial: trialChildren,
        mappings: mappings.filter((m) => children.has(m.player_id)),
        periods: periods.filter((p) => children.has(p.player_id)),
        bookings: bookings.filter(
          (b) => b.parent_id === parent.id && children.has(b.player_id),
        ),
        plans,
      });
    }),
  );
}
