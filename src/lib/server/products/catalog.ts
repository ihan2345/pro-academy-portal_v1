import { productLiveMode } from "./runtime";
import { productIdSchema } from "@/lib/products/domain";
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  channelLabels,
  productSchema,
  type Channel,
  type Product,
  type ProductRecord,
  type ProductContext,
} from "@/lib/products/domain";
import { decideProduct } from "@/lib/products/policy";
import type { ProfileSession } from "../parent-profile";
import { serviceDb } from "../service-db";
import { assertRole, HttpError } from "../security";
import {
  checked,
  collect,
  loadProductContext,
  loadProductContexts,
} from "./context";
import { requireProducts } from "./runtime";
import { verifyStoredPrice } from "./stripe";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const secret = () => {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Lokale Produktkonfiguration fehlt");
  return s;
};
export async function productById(id: string): Promise<ProductRecord> {
  requireProducts();
  productIdSchema.parse(id);
  const p = checked(
    await serviceDb()
      .from("catalog_products")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!p) throw new HttpError(404, "Produkt nicht gefunden.");
  return p as ProductRecord;
}
export function parseCursor(value?: string | null) {
  if (!value) return null;
  try {
    return z
      .object({
        sort: z.number().int(),
        created: z.iso.datetime({ offset: true }),
        id: productIdSchema,
        filter: z.string(),
      })
      .strict()
      .parse(JSON.parse(Buffer.from(value, "base64url").toString()));
  } catch {
    throw new HttpError(400, "Ungültige Produktseite.");
  }
}
export async function listProducts(
  session: ProfileSession | null,
  params: URLSearchParams,
  admin = false,
) {
  requireProducts();
  if (admin) assertRole(session?.role, "admin");
  const q = z
      .string()
      .trim()
      .max(160)
      .parse(params.get("q") ?? ""),
    kind = z
      .enum(["", "subscription", "camp", "other"])
      .parse(params.get("kind") ?? ""),
    status = z
      .enum([
        "",
        "draft",
        "active",
        "internal",
        "exclusive",
        "sold_out",
        "archived",
      ])
      .parse(params.get("status") ?? ""),
    category = z
      .string()
      .max(80)
      .parse(params.get("category") ?? "");
  const channel = z
    .enum(Object.keys(channelLabels) as [Channel, ...Channel[]])
    .parse(params.get("channel") || "catalog");
  const fingerprint = hash({
      q,
      kind,
      status,
      category,
      channel,
      admin,
      order: "priority-newest",
      player: params.get("player"),
      new_child: params.get("new_child") === "true",
    }),
    cursor = parseCursor(params.get("cursor"));
  if (cursor && cursor.filter !== fingerprint)
    throw new HttpError(400, "Filter geändert. Bitte erste Seite laden.");
  const ctx = admin ? null : await loadProductContext(session),
    player = params.get("player") || undefined;
  const evaluationCtx: ProductContext | null =
    ctx && params.get("new_child") === "true" && ctx.role === "parent"
      ? {
          ...ctx,
          children: [
            ...ctx.children,
            {
              id: "00000000-0000-4000-8000-000000000098",
              name: "Neues Kind",
              first_name: "",
              last_name: "",
              birth_date: null,
              trial: false,
              former_trial: false,
              memberships: [],
              camp_ids: [],
              purchases: [],
              reserved: true,
            },
          ],
        }
      : ctx;
  const evaluationPlayer =
    evaluationCtx !== ctx ? "00000000-0000-4000-8000-000000000098" : player;
  if (player) productIdSchema.parse(player);
  let after = cursor,
    exhausted = false;
  const rows: any[] = [];
  const size = 24;
  do {
    const sortColumn = admin ? "priority" : "published_priority";
    let query = serviceDb()
      .from("catalog_products")
      .select("*")
      .order(sortColumn, { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(size + 1);
    if (q)
      query = query.textSearch(
        admin ? "search_document" : "published_search_document",
        q,
        {
          type: "websearch",
          config: "simple",
        },
      );
    if (kind) query = query.eq(admin ? "kind" : "published->>kind", kind);
    if (status) query = query.eq("status", status);
    if (category)
      query = query.eq(admin ? "category" : "published->>category", category);
    if (admin && params.get("channel"))
      query = query.contains("draft", { channels: [channel] });
    if (!admin) query = query.not("published", "is", null);
    if (after)
      query = query.or(
        `${sortColumn}.lt.${after.sort},and(${sortColumn}.eq.${after.sort},created_at.lt.${after.created}),and(${sortColumn}.eq.${after.sort},created_at.eq.${after.created},id.lt.${after.id})`,
      );
    const batch = checked<any[]>(await query);
    exhausted = batch.length <= size;
    for (const p of batch.slice(0, size)) {
      after = {
        sort: p[sortColumn],
        created: p.created_at,
        id: p.id,
        filter: fingerprint,
      };
      if (admin) rows.push(p);
      else if (p.published) {
        const decision = decideProduct(
          p.published,
          p.id,
          evaluationCtx!,
          channel,
          evaluationPlayer,
        );
        if (decision.visible) rows.push(publicProduct(p, decision));
      }
      if (rows.length >= size) {
        exhausted = batch.length <= size && p.id === batch.at(-1)?.id;
        break;
      }
    }
    if (admin || rows.length >= size || batch.length <= size) break;
  } while (true);
  return {
    rows,
    next:
      exhausted || !after
        ? null
        : Buffer.from(JSON.stringify(after)).toString("base64url"),
    context: admin ? undefined : ctx,
    payments_enabled: process.env.PRODUCT_PAYMENTS_ENABLED === "true",
  };
}
export function publicProduct(
  p: ProductRecord,
  decision: ReturnType<typeof decideProduct>,
) {
  const v = p.published!;
  return {
    id: p.id,
    revision: p.published_revision,
    name: v.name,
    kind: v.kind,
    description: v.description,
    short_description: v.short_description,
    category: v.category,
    price: v.price,
    featured: v.featured,
    effect_color: v.effect_color ?? "#8B53FE",
    sale_enabled: v.sale_enabled ?? false,
    sale_audiences: v.sale_audiences ?? [],
    asset_ids: v.asset_ids,
    training_content: v.training_content,
    decision,
  };
}
export async function saveProduct(
  session: ProfileSession,
  raw: unknown,
  id?: string,
) {
  requireProducts();
  assertRole(session.role, "admin");
  const input = z
    .object({
      data: productSchema,
      revision: z.number().int().positive().optional(),
    })
    .strict()
    .parse(raw);
  if (id) productIdSchema.parse(id);
  const r = await session.db.rpc("save_catalog_product", {
    input: { ...input, id },
  });
  if (r.error)
    throw new HttpError(
      409,
      "Produkt konnte nicht gespeichert werden. Prüfe die Angaben oder lade den aktuellen Stand neu.",
    );
  return productById(r.data);
}
export async function productReferences(session: ProfileSession) {
  requireProducts();
  assertRole(session.role, "admin");
  const db = serviceDb();
  const [plans, offers, families] = await Promise.all([
    collect(() =>
      db
        .from("plans")
        .select(
          "id,name,stripe_price_id,included_units,athletics_units,generation,billing_interval,active,is_camp",
        )
        .eq("active", true)
        .or("is_camp.is.null,is_camp.eq.false"),
    ),
    collect(() =>
      db
        .from("camp_offers")
        .select(
          "id,kind,camp_id,stripe_price_id,stripe_product_id,amount,currency,camps!inner(title,status,payment_mode)",
        )
        .eq("camps.payment_mode", productLiveMode() ? "live" : "test"),
    ),
    // Searchable family options are paginated separately, never silently truncated.
    Promise.resolve([]),
  ]);
  return { plans, offers, families };
}
export async function impactProduct(session: ProfileSession, id: string) {
  requireProducts();
  assertRole(session.role, "admin");
  const db = serviceDb(),
    p = await productById(id);
  const beforeVersion = checked(await db.rpc("product_context_version"));
  const counts = {
    before: 0,
    after: 0,
    gained: 0,
    lost: 0,
    affected: 0,
    visible_before: 0,
    visible_after: 0,
    displayed_families_before: 0,
    displayed_families_after: 0,
    permission_changed_families: 0,
    open_orders: 0,
  };
  let after: string | undefined;
  const now = Date.now();
  const presentationChanged = hash(p.published) !== hash(p.draft);
  counts.open_orders = (
    await collect(() =>
      db
        .from("product_purchase_intents")
        .select("id")
        .eq("product_id", id)
        .in("status", ["reserved", "checkout", "paid", "review"]),
    )
  ).length;
  for (;;) {
    let query = db
      .from("parents")
      .select("id,auth_user_id")
      .is("archived_at", null)
      .order("id")
      .limit(100);
    if (after) query = query.gt("id", after);
    const batch = checked<any[]>(await query);
    const contexts = await loadProductContexts(session, batch, db, now);
    for (const ctx of contexts) {
      let b = false,
        a = false,
        changed = false,
        visibleBefore = false,
        visibleAfter = false;
      for (const child of ctx.children.length ? ctx.children : [undefined])
        for (const channel of Object.keys(channelLabels) as Channel[]) {
          if (channel === "admin") continue;
          const old = p.published
              ? decideProduct(p.published, p.id, ctx, channel, child?.id, now)
              : null,
            next = decideProduct(p.draft, p.id, ctx, channel, child?.id, now);
          b ||= !!old?.purchasable;
          a ||= next.purchasable;
          if (old?.visible) {
            counts.visible_before++;
            visibleBefore = true;
          }
          if (next.visible) {
            counts.visible_after++;
            visibleAfter = true;
          }
          changed ||=
            !!old?.visible !== next.visible ||
            !!old?.purchasable !== next.purchasable ||
            !!old?.usable !== next.usable;
        }
      if (b) counts.before++;
      if (a) counts.after++;
      if (!b && a) counts.gained++;
      if (b && !a) counts.lost++;
      if (visibleBefore) counts.displayed_families_before++;
      if (visibleAfter) counts.displayed_families_after++;
      if (changed) counts.permission_changed_families++;
      if (changed || (presentationChanged && (visibleBefore || visibleAfter)))
        counts.affected++;
    }
    if (batch.length < 100) break;
    after = batch.at(-1)!.id;
  }
  if (beforeVersion !== checked(await db.rpc("product_context_version")))
    throw new HttpError(
      409,
      "Familien haben sich während der Berechnung geändert. Bitte erneut prüfen.",
    );
  const evidence = {
    id,
    revision: p.revision,
    draft_hash: hash(p.draft),
    context_version: beforeVersion,
    at: now,
  };
  const payload = Buffer.from(JSON.stringify(evidence)).toString("base64url"),
    signature = createHmac("sha256", secret()).update(payload).digest("hex");
  return {
    ...counts,
    complete: true,
    checked_at: new Date(now).toISOString(),
    token: `${payload}.${signature}`,
    note: "Ausgewertet: bekannte, nicht archivierte Familien. Sichtbare Einträge zählen Produkt × Kanal × Kind/Familienkontext. Öffentliche Besucherreichweite ist nicht bestimmbar.",
  };
}
export async function publishProduct(
  session: ProfileSession,
  id: string,
  token: string,
) {
  requireProducts();
  assertRole(session.role, "admin");
  const p = await productById(id);
  let evidence: any;
  try {
    const [payload, signature] = token.split(".");
    const expected = createHmac("sha256", secret()).update(payload).digest();
    const supplied = Buffer.from(signature, "hex");
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      throw new Error();
    evidence = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      evidence.id !== id ||
      evidence.revision !== p.revision ||
      evidence.draft_hash !== hash(p.draft) ||
      Date.now() - evidence.at > 300000 ||
      evidence.at > Date.now()
    )
      throw new Error();
  } catch {
    throw new HttpError(
      409,
      "Änderungsvorschau ist ungültig oder abgelaufen. Bitte erneut berechnen.",
    );
  }
  if (["active", "internal", "exclusive", "sold_out"].includes(p.draft.status))
    await verifyStoredPrice(p.draft);
  const r = await serviceDb().rpc("publish_catalog_product", {
    input: { ...evidence, actor_id: session.user.id },
  });
  if (r.error)
    throw new HttpError(
      409,
      "Veröffentlichung nicht möglich. Preis, Fachzuordnung, Bilder und Aktualität der Vorschau prüfen.",
    );
  return productById(id);
}
export async function listFamilies(
  session: ProfileSession,
  params: URLSearchParams,
) {
  assertRole(session.role, "admin");
  const search = z
    .string()
    .max(100)
    .parse(params.get("q") ?? "")
    .replace(/[%_,().]/g, "");
  let q = serviceDb()
    .from("parents")
    .select("id,full_name")
    .is("archived_at", null)
    .order("id")
    .limit(31);
  if (search) q = q.ilike("full_name", `%${search}%`);
  if (params.get("after"))
    q = q.gt("id", productIdSchema.parse(params.get("after")));
  const batch = checked<any[]>(await q);
  return {
    rows: batch.slice(0, 30),
    next: batch.length > 30 ? batch[29].id : null,
  };
}
