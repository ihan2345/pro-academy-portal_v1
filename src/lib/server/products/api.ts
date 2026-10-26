import {
  operationOverview,
  listOrders,
  resumeOrder,
  updateService,
  recheckOrder,
  resolvePaymentReview,
} from "./operations";
import { previewGrantChange, applyGrantChange } from "./grants";
import { productIdSchema } from "@/lib/products/domain";
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { sessionDb, sessionUser } from "../supabase";
import { serviceDb } from "../service-db";
import { assertRole, HttpError, requireOrigin } from "../security";
import { requireProducts, requireProductShop } from "./runtime";
import {
  boundedBody,
  readProductImage,
  uploadProductImage,
  removeProductImage,
  cleanupProductImages,
} from "./images";
import {
  impactProduct,
  listProducts,
  productById,
  productReferences,
  publishProduct,
  saveProduct,
  listFamilies,
} from "./catalog";
import { checked, collect, loadProductContext } from "./context";
import { productSchema } from "@/lib/products/domain";
import { decideProduct } from "@/lib/products/policy";
import { scenarios, simulateProductContext } from "@/lib/products/simulation";
import { validateProductPrice } from "./stripe";
import { checkoutProduct, ownIntent, fulfillCheckout } from "./checkout";
import { receiveProductEvent, processProductEvents } from "./events";
import { previewProductChange, confirmProductChange } from "./changes";
const json = (v: unknown, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function body(request: Request) {
  try {
    return JSON.parse((await boundedBody(request, 65536)).toString());
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "Ungültige Anfrage.");
  }
}
export async function productApi(
  request: NextRequest,
  action: string[],
  admin: boolean,
) {
  try {
    requireProducts();
    const method = request.method,
      path = action.join("/");
    if (!admin && path === "webhook" && method === "POST")
      return json(
        await receiveProductEvent(request, await boundedBody(request, 262144)),
      );
    if (method !== "GET") requireOrigin(request);
    const session = await sessionUser();
    if (!admin && !(action[0] === "image" && session?.role === "admin"))
      await requireProductShop();
    if (!admin && action[0] === "image" && method === "GET")
      return await readProductImage(session, productIdSchema.parse(action[1]));
    if (admin) {
      assertRole(session?.role, "admin");
      const s = session!;
      if (
        action[0] === "payments" &&
        action[2] === "resolve" &&
        method === "POST"
      )
        return json(
          await resolvePaymentReview(
            s,
            productIdSchema.parse(action[1]),
            await body(request),
          ),
        );
      if (
        action[0] === "changes" &&
        action[2] === "reconcile" &&
        method === "POST"
      ) {
        const changeId = productIdSchema.parse(action[1]);
        const { reason } = z
          .object({ reason: z.string().trim().min(5).max(500) })
          .strict()
          .parse(await body(request));
        const change = checked(
          await serviceDb()
            .from("product_change_requests")
            .select("subscription_id")
            .eq("id", changeId)
            .maybeSingle(),
        );
        if (!change) throw new HttpError(404, "Wechsel fehlt.");
        const { reconcileProductChanges } = await import("./changes");
        return json(
          await reconcileProductChanges(change.subscription_id, reason),
        );
      }
      if (path === "operations" && method === "GET")
        return json(await operationOverview(s, request.nextUrl.searchParams));
      if (action[0] === "orders" && action.length === 3 && method === "POST") {
        const orderId = productIdSchema.parse(action[1]);
        if (action[2] === "reconcile")
          return json(await recheckOrder(s, orderId, await body(request)));
        if (action[2] === "cancel")
          return json(await resumeOrder(s, orderId, true));
        if (action[2] === "service")
          return json(await updateService(s, orderId, await body(request)));
      }
      if (!path && method === "GET")
        return json(await listProducts(s, request.nextUrl.searchParams, true));
      if (!path && method === "POST")
        return json(await saveProduct(s, await body(request)), 201);
      if (path === "references" && method === "GET")
        return json(await productReferences(s));
      if (path === "families" && method === "GET")
        return json(await listFamilies(s, request.nextUrl.searchParams));
      if (path === "cleanup-images" && method === "POST")
        return json(await cleanupProductImages(s));
      if (path === "process-events" && method === "POST")
        return json(await processProductEvents());
      if (path === "validate-price" && method === "POST") {
        const v = z
          .object({
            id: z.string(),
            kind: z.enum(["subscription", "camp", "other"]),
            product_id: z.string().optional(),
          })
          .strict()
          .parse(await body(request));
        return json(await validateProductPrice(v.id, v.kind, v.product_id));
      }
      if (path === "preview" && method === "POST") {
        const v = z
          .object({
            id: productIdSchema.optional(),
            data: productSchema,
            scenario: z.enum(
              Object.keys(scenarios) as [
                keyof typeof scenarios,
                ...(keyof typeof scenarios)[],
              ],
            ),
            channel: z.enum([
              "homepage",
              "parents",
              "trials",
              "catalog",
              "admin",
            ]),
            parent_id: productIdSchema.optional(),
            player_id: productIdSchema.optional(),
          })
          .strict()
          .parse(await body(request));
        const id = v.id ?? "00000000-0000-4000-8000-000000000099",
          ctx = v.parent_id
            ? await loadProductContext(s, v.parent_id)
            : simulateProductContext(v.scenario, id);
        return json({
          simulation: !v.parent_id,
          context: ctx,
          decision: decideProduct(
            v.data,
            id,
            ctx,
            v.channel,
            v.player_id ?? ctx.children[0]?.id,
          ),
        });
      }
      const id = productIdSchema.parse(action[0]);
      if (action.length === 1 && method === "GET") {
        const p = await productById(id);
        return json({
          ...p,
          assets: await collect(() =>
            serviceDb()
              .from("catalog_product_assets")
              .select("id,alt,width,height,bytes")
              .eq("product_id", id),
          ),
          grants: await collect(() =>
            serviceDb()
              .from("catalog_product_grants")
              .select("*")
              .eq("product_id", id),
          ),
        });
      }
      if (action.length === 1 && method === "PATCH")
        return json(await saveProduct(s, await body(request), id));
      if (action[1] === "impact" && method === "POST")
        return json(await impactProduct(s, id));
      if (action[1] === "publish" && method === "POST")
        return json(
          await publishProduct(
            s,
            id,
            z
              .object({ token: z.string().max(4096) })
              .strict()
              .parse(await body(request)).token,
          ),
        );
      if (action[1] === "assets" && action.length === 2 && method === "POST")
        return json(await uploadProductImage(s, id, request), 201);
      if (action[1] === "assets" && action.length === 3 && method === "DELETE")
        return json(
          await removeProductImage(s, id, productIdSchema.parse(action[2])),
        );
      if (action[1] === "grants-preview" && method === "POST")
        return json(await previewGrantChange(s, id, await body(request)));
      if (action[1] === "grants" && method === "POST")
        return json(
          await applyGrantChange(
            s,
            id,
            z
              .object({ token: z.string().max(8192) })
              .strict()
              .parse(await body(request)).token,
          ),
        );
    } else {
      if (!path && method === "GET")
        return json(await listProducts(session, request.nextUrl.searchParams));
      if (path === "register" && method === "POST") {
        const v = z
          .object({ email: z.email() })
          .strict()
          .parse(await body(request));
        const key = createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!)
          .update(v.email.toLowerCase())
          .digest("hex");
        if (!checked(await serviceDb().rpc("limit_product_request", { key })))
          throw new HttpError(429, "Bitte später erneut versuchen.");
        const db = await sessionDb();
        const store = await cookies();
        store.set("pa_product_return", "1", {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 3600,
        });
        await db.auth.signInWithOtp({
          email: v.email,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: `${process.env.APP_URL}/auth/callback`,
          },
        });
        return json({
          ok: true,
          message:
            "Wenn möglich, wurde ein Zugangslink an deine Adresse gesendet. Bitte bestätige die Anmeldung.",
        });
      }
      if (path === "prepare" && method === "POST") {
        const v = z
            .object({ full_name: z.string().trim().min(2).max(160) })
            .strict()
            .parse(await body(request)),
          db = await sessionDb();
        const {
          data: { user },
        } = await db.auth.getUser();
        if (!user?.email_confirmed_at)
          throw new HttpError(401, "Bitte zuerst deine E-Mail bestätigen.");
        const r = await db.rpc("prepare_product_parent", v);
        if (r.error)
          throw new HttpError(
            409,
            "Bestehende Familienzuordnung bitte prüfen lassen oder Elternnamen ergänzen.",
          );
        return json({ ok: true });
      }
      if (!session?.user) throw new HttpError(401, "Bitte zuerst anmelden.");
      if (path === "orders" && method === "GET")
        return json(await listOrders(session, request.nextUrl.searchParams));
      if (action[0] === "orders" && action.length === 3 && method === "POST") {
        const orderId = productIdSchema.parse(action[1]);
        if (action[2] === "resume")
          return json(await resumeOrder(session, orderId));
        if (action[2] === "cancel")
          return json(await resumeOrder(session, orderId, true));
      }
      if (path === "accounts" && method === "GET") {
        const ctx = await loadProductContext(session);
        return json({
          accounts: ctx.parent_id
            ? checked(
                await serviceDb()
                  .from("parent_stripe_customers")
                  .select("stripe_customer_id")
                  .eq("parent_id", ctx.parent_id),
              )
            : [],
        });
      }
      if (action[0] === "purchases" && action.length >= 2) {
        const i = await ownIntent(session, action[1]);
        if (action[2] === "reconcile" && method === "POST")
          return json(await fulfillCheckout(i.id));
        if (method === "GET")
          return json({
            id: i.id,
            status: i.status,
            reason: i.reason,
            name: i.product.name,
            expires_at: i.expires_at,
          });
      }
      if (
        action[0] === "changes" &&
        action[2] === "confirm" &&
        method === "POST"
      )
        return json(
          await confirmProductChange(session, productIdSchema.parse(action[1])),
        );
      const id = productIdSchema.parse(action[0]);
      if (action[1] === "access" && method === "GET") {
        const ctx = await loadProductContext(session),
          player = productIdSchema.parse(
            request.nextUrl.searchParams.get("player"),
          );
        if (!ctx.parent_id || !ctx.children.some((c) => c.id === player))
          throw new HttpError(404, "Eigene Kinderzuordnung fehlt.");
        const p = await productById(id);
        const purchases = await collect(() =>
          serviceDb()
            .from("product_purchase_intents")
            .select("id,product")
            .eq("product_id", id)
            .eq("parent_id", ctx.parent_id)
            .eq("player_id", player)
            .eq("status", "fulfilled"),
        );
        const versions =
          p.published?.kind === "other"
            ? p.published
              ? [p.published]
              : []
            : purchases
                .map((x) => x.product)
                .concat(p.published ? [p.published] : []);
        return json({
          product_id: id,
          player_id: player,
          usable: versions.some(
            (v) => decideProduct(v, id, ctx, "catalog", player).usable,
          ),
          checked_at: new Date().toISOString(),
        });
      }
      if (action[1] === "checkout" && method === "POST")
        return json(await checkoutProduct(session, id, await body(request)));
      if (action[1] === "change-preview" && method === "POST")
        return json(
          await previewProductChange(session, id, await body(request)),
        );
    }
    throw new HttpError(405, "Diese Aktion ist nicht verfügbar.");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return json({ error: e.issues.map((i) => i.message).join(" ") }, 400);
    console.error("Product request failed", {
      action: action.slice(0, 2).join("/"),
      message: e instanceof Error ? e.name : "unknown",
    });
    return json(
      {
        error:
          "Produktanfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen.",
      },
      500,
    );
  }
}
