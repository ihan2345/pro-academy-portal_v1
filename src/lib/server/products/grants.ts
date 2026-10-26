import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { productIdSchema } from "@/lib/products/domain";
import { decideProduct } from "@/lib/products/policy";
import type { ProfileSession } from "../parent-profile";
import { HttpError, assertRole } from "../security";
import { serviceDb } from "../service-db";
import { checked, loadProductContext } from "./context";
import { productById } from "./catalog";
const grantSchema = z
  .object({
    parent_id: productIdSchema,
    player_id: productIdSchema.nullable(),
    purpose: z.enum(["visibility", "purchase", "usage"]),
    expires_at: z.iso.datetime().nullable(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const changeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), data: grantSchema }).strict(),
  z.object({ action: z.literal("remove"), grant_id: productIdSchema }).strict(),
]);
export async function previewGrantChange(
  session: ProfileSession,
  productId: string,
  raw: unknown,
) {
  assertRole(session.role, "admin");
  const change = changeSchema.parse(raw),
    db = serviceDb(),
    product = await productById(productId),
    version = checked(await db.rpc("product_context_version"));
  let data: z.infer<typeof grantSchema>;
  if (change.action === "remove") {
    const grant = checked(
      await db
        .from("catalog_product_grants")
        .select("*")
        .eq("id", change.grant_id)
        .eq("product_id", productId)
        .maybeSingle(),
    );
    if (!grant) throw new HttpError(404, "Freigabe nicht gefunden.");
    data = grantSchema.parse({
      parent_id: grant.parent_id,
      player_id: grant.player_id,
      purpose: grant.purpose,
      expires_at: grant.expires_at,
      reason: grant.reason,
    });
  } else data = change.data;
  if (
    change.action === "add" &&
    data.purpose === "usage" &&
    (product.published?.kind ?? product.draft.kind) !== "other"
  )
    throw new HttpError(
      400,
      "Abo- und Campnutzung folgt den bestehenden Vertrags-/Buchungsrechten. Individuelle Nutzungsregeln gelten nur für sonstige Produkte nach dem Kauf.",
    );
  const before = await loadProductContext(session, data.parent_id);
  if (
    !before.parent_id ||
    (data.player_id && !before.children.some((c) => c.id === data.player_id))
  )
    throw new HttpError(400, "Familien-/Kindzuordnung passt nicht.");
  const after = structuredClone(before);
  if (
    change.action === "add" &&
    (!data.expires_at || Date.parse(data.expires_at) > Date.now())
  )
    after.grants.push({
      product_id: productId,
      purpose: data.purpose,
      player_id: data.player_id,
    });
  if (change.action === "remove") {
    // Reload all remaining matching grants so overlapping approvals remain effective.
    const remaining = checked<any[]>(
      await db
        .from("catalog_product_grants")
        .select("*")
        .eq("product_id", productId)
        .eq("parent_id", data.parent_id)
        .neq("id", change.grant_id),
    );
    after.grants = after.grants
      .filter((g) => g.product_id !== productId)
      .concat(
        remaining
          .filter((g) => !g.expires_at || Date.parse(g.expires_at) > Date.now())
          .map((g) => ({
            product_id: productId,
            purpose: g.purpose,
            player_id: g.player_id,
          })),
      );
  }
  let visibleBefore = 0,
    visibleAfter = 0,
    buyBefore = false,
    buyAfter = false,
    usageBefore = false,
    usageAfter = false;
  if (product.published)
    for (const child of before.children.length ? before.children : [undefined])
      for (const channel of product.published.channels) {
        const b = decideProduct(
            product.published,
            productId,
            before,
            channel,
            child?.id,
          ),
          a = decideProduct(
            product.published,
            productId,
            after,
            channel,
            child?.id,
          );
        visibleBefore += Number(b.visible);
        visibleAfter += Number(a.visible);
        buyBefore ||= b.purchasable;
        buyAfter ||= a.purchasable;
        usageBefore ||= b.usable;
        usageAfter ||= a.usable;
      }
  if (version !== checked(await db.rpc("product_context_version")))
    throw new HttpError(409, "Familiendaten geändert. Bitte erneut prüfen.");
  const evidence = {
    product_id: productId,
    revision: product.revision,
    context_version: version,
    change,
    at: Date.now(),
  };
  const payload = Buffer.from(JSON.stringify(evidence)).toString("base64url"),
    signature = createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!)
      .update(payload)
      .digest("hex");
  return {
    token: `${payload}.${signature}`,
    family_count: 1,
    visible_before: visibleBefore,
    visible_after: visibleAfter,
    buy_before: Number(buyBefore),
    buy_after: Number(buyAfter),
    usage_before: Number(usageBefore),
    usage_after: Number(usageAfter),
    note: "Berechnet für die ausgewählte, tatsächlich vorhandene Familie. Die Freigabe überschreibt keine Ausschlüsse oder Verkaufssperren.",
  };
}
export async function applyGrantChange(
  session: ProfileSession,
  productId: string,
  token: string,
) {
  assertRole(session.role, "admin");
  let evidence: any;
  try {
    const [payload, signature] = token.split("."),
      expected = createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!)
        .update(payload)
        .digest(),
      provided = Buffer.from(signature, "hex");
    if (
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    )
      throw Error();
    evidence = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      evidence.product_id !== productId ||
      Date.now() - evidence.at > 300000 ||
      evidence.at > Date.now()
    )
      throw Error();
    changeSchema.parse(evidence.change);
  } catch {
    throw new HttpError(409, "Freigabevorschau ungültig oder abgelaufen.");
  }
  const r = await serviceDb().rpc("apply_product_grant_change", {
    input: { ...evidence, actor_id: session.user.id },
  });
  if (r.error)
    throw new HttpError(
      409,
      "Produkt oder Familiendaten wurden geändert. Bitte Freigabe erneut prüfen.",
    );
  return { ok: true };
}
