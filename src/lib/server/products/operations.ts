import { productLiveMode } from "./runtime";
import "server-only";
import { z } from "zod";
import { productIdSchema } from "@/lib/products/domain";
import type { ProfileSession } from "../parent-profile";
import { assertRole, HttpError } from "../security";
import { serviceDb } from "../service-db";
import { checked, collect, loadProductContext } from "./context";
import { ownIntent, fulfillCheckout } from "./checkout";
import { productStripe, productStripeKey } from "./stripe";
import { productById } from "./catalog";
import { decideProduct } from "@/lib/products/policy";
export async function processingStatus() {
  const db = serviceDb();
  const rows = checked<any[]>(
    await db
      .from("system_settings")
      .select("key,value")
      .in("key", ["product_worker_health", "product_event_poll"]),
  );
  const heartbeat = rows.find((r) => r.key === "product_worker_health")?.value;
  const poll = rows.find((r) => r.key === "product_event_poll")?.value;
  return {
    test_key: /^(sk|rk)_test_/.test(productStripeKey()),
    stripe_connected: (productLiveMode()
      ? /^(sk|rk)_live_/
      : /^(sk|rk)_test_/
    ).test(productStripeKey()),
    livemode: productLiveMode(),
    payments_enabled: process.env.PRODUCT_PAYMENTS_ENABLED === "true",
    worker_active:
      !!heartbeat?.ok &&
      Date.now() - Date.parse(heartbeat.at) <
        (productLiveMode() ? 12 * 60000 : 60000),
    last_processed_at: heartbeat?.at ?? null,
    last_poll_at: poll?.checked_at ?? null,
    webhook_configured: !!(
      process.env.PRODUCT_STRIPE_WEBHOOK_SECRET ||
      (productLiveMode() ? process.env.STRIPE_WEBHOOK_SECRET : "")
    )?.startsWith("whsec_"),
  };
}
export async function listOrders(
  session: ProfileSession,
  params: URLSearchParams,
  admin = false,
) {
  if (admin) assertRole(session.role, "admin");
  const cursor = params.get("after");
  if (cursor) productIdSchema.parse(cursor);
  let q = serviceDb()
    .from("product_purchase_intents")
    .select(
      "id,product,player_data,player_id,parent_id,status,reason,created_at,expires_at,parents(full_name),product_purchases(id,service_status,service_note)",
    )
    .order("id", { ascending: false })
    .limit(31);
  if (!admin) q = q.eq("auth_id", session.user.id);
  if (cursor) q = q.lt("id", cursor);
  const batch = checked<any[]>(await q);
  const ids = batch.map((i) => i.player_id);
  const children = ids.length
    ? (
        await Promise.all([
          serviceDb()
            .from("players")
            .select("id,first_name,last_name")
            .in("id", ids),
          serviceDb()
            .from("trial_players")
            .select("id,first_name,last_name")
            .in("id", ids),
        ])
      ).flatMap((r) => checked<any[]>(r))
    : [];
  return {
    rows: batch.slice(0, 30).map((i) => ({
      id: i.id,
      name: i.product.name,
      kind: i.product.kind,
      player_id: i.player_id,
      family: i.parents?.full_name,
      child: i.player_data
        ? `${i.player_data.first_name} ${i.player_data.last_name}`
        : (() => {
            const c = children.find((c) => c.id === i.player_id);
            return c
              ? `${c.first_name} ${c.last_name}`
              : "Kind nicht mehr vorhanden";
          })(),
      status: i.status,
      reason: i.reason,
      created_at: i.created_at,
      expires_at: i.expires_at,
      service: i.product_purchases?.[0] ?? null,
    })),
    next: batch.length > 30 ? batch[29].id : null,
  };
}
export async function resumeOrder(
  session: ProfileSession,
  id: string,
  cancel = false,
): Promise<{ id: string; status: string; url?: string }> {
  const i = await ownIntent(session, id),
    db = serviceDb(),
    stripe = productStripe();
  if (["fulfilled", "refunded"].includes(i.status))
    return { id, status: i.status };
  if (!i.session_id) {
    // A Stripe response may have been lost after creating the remote session.
    // Recover by the server-owned reference before ever releasing a reservation.
    if (i.customer_id) {
      for await (const candidate of stripe.checkout.sessions.list({
        customer: i.customer_id,
        created: { gte: Math.floor(Date.parse(i.created_at) / 1000) - 300 },
        limit: 100,
      })) {
        if (candidate.livemode !== productLiveMode())
          throw new HttpError(409, "Live-Checkout gesperrt.");
        if (
          candidate.client_reference_id === id &&
          candidate.metadata?.product_intent_id === id
        ) {
          checked(
            await db
              .from("product_purchase_intents")
              .update({
                session_id: candidate.id,
                checkout_url: candidate.url,
                status: "checkout",
                updated_at: new Date().toISOString(),
              })
              .eq("id", id)
              .is("session_id", null)
              .select("id"),
          );
          return resumeOrder(session, id, cancel);
        }
      }
    }
    if (Date.parse(i.expires_at) > Date.now()) {
      if (cancel)
        throw new HttpError(
          409,
          "Der Kaufstart wird vorbereitet. Bitte nach Ablauf erneut prüfen.",
        );
      if (Date.parse(i.expires_at) - Date.now() < 30 * 60000)
        throw new HttpError(
          409,
          "Die Reservierung läuft aus. Bitte nach Ablauf erneut prüfen; es wird kein zweiter Checkout erzeugt.",
        );
      const { checkoutProduct } = await import("./checkout");
      return checkoutProduct(session, i.product_id, {
        request_id: id,
        ...(i.player_data
          ? { new_child: i.player_data }
          : { player_id: i.player_id }),
        ...(i.camp_details ? { camp_details: i.camp_details } : {}),
        ...(i.customer_id ? { customer_id: i.customer_id } : {}),
        channel: i.channel,
      });
    }
    checked(
      await db
        .from("product_purchase_intents")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", id)
        .is("session_id", null)
        .eq("status", "reserved")
        .select("id"),
    );
    return { id, status: "expired" };
  }
  let remote = await stripe.checkout.sessions.retrieve(i.session_id);
  if (
    remote.livemode !== productLiveMode() ||
    remote.client_reference_id !== id ||
    remote.metadata?.product_intent_id !== id
  )
    throw new HttpError(409, "Checkout-Zuordnung muss geprüft werden.");
  if (
    cancel &&
    remote.status === "open" &&
    remote.payment_status === "unpaid"
  ) {
    try {
      await stripe.checkout.sessions.expire(remote.id);
    } catch {
      /* Re-read a concurrent payment. */
    }
    remote = await stripe.checkout.sessions.retrieve(remote.id);
  }
  if (remote.status === "expired" || remote.status === "complete")
    return fulfillCheckout(id);
  if (cancel)
    throw new HttpError(
      409,
      "Dieser Checkout kann noch nicht sicher freigegeben werden. Bitte Zahlung prüfen.",
    );
  if (i.status === "review")
    throw new HttpError(
      409,
      "Dieser Kauf benötigt eine Prüfung durch die Verwaltung.",
    );
  const p = await productById(i.product_id),
    ctx = await loadProductContext(session);
  if (i.player_data)
    ctx.children.push({
      id: i.player_id,
      name: "Neues Kind",
      ...i.player_data,
      trial: false,
      former_trial: false,
      memberships: [],
      camp_ids: [],
      purchases: [],
    });
  if (
    !p.published ||
    p.published_revision !== i.product_revision ||
    !decideProduct(p.published, p.id, ctx, i.channel, i.player_id).purchasable
  )
    throw new HttpError(
      409,
      "Angebot oder Kaufberechtigung geändert. Den offenen Checkout zuerst prüfen oder beenden.",
    );
  if (
    !remote.url ||
    new URL(remote.url).origin !== "https://checkout.stripe.com"
  )
    throw new HttpError(409, "Gültiger Checkout-Link fehlt.");
  return { id, status: i.status, url: remote.url };
}
export async function updateService(
  session: ProfileSession,
  id: string,
  raw: unknown,
) {
  assertRole(session.role, "admin");
  const v = z
    .object({
      status: z.enum(["booked", "scheduled", "delivered"]),
      note: z.string().trim().min(3).max(1000),
    })
    .strict()
    .parse(raw);
  const i = await ownIntent(session, id);
  if (i.status !== "fulfilled" || i.product.kind !== "other")
    throw new HttpError(
      409,
      "Nur bestätigte sonstige Leistungen können bearbeitet werden.",
    );
  checked(
    await serviceDb()
      .from("product_purchases")
      .update({ service_status: v.status, service_note: v.note })
      .eq("intent_id", id)
      .eq("status", "active")
      .select("id"),
  );
  return { ok: true };
}
export async function operationOverview(
  session: ProfileSession,
  params: URLSearchParams,
) {
  assertRole(session.role, "admin");
  const [orders, changes, payments, processing, events] = await Promise.all([
    listOrders(session, params, true),
    collect(() =>
      serviceDb()
        .from("product_change_requests")
        .select("id,status,reason,preview,updated_at")
        .in("status", ["processing", "scheduled", "pending_payment", "review"]),
    ),
    collect(() =>
      serviceDb()
        .from("product_payment_links")
        .select(
          "id,invoice_id,payment_intent_id,status,reason,amount,currency,parent_id",
        )
        .in("status", ["review", "refunded"])
        .is("review_resolved_at", null),
    ),
    processingStatus(),
    collect(() =>
      serviceDb()
        .from("product_payment_events")
        .select("id,type,status,last_error,attempts,available_at")
        .eq("status", "failed"),
    ),
  ]);
  return { ...orders, changes, payments, processing, events };
}

export async function recheckOrder(
  session: ProfileSession,
  id: string,
  raw: unknown,
) {
  assertRole(session.role, "admin");
  const { reason } = z
    .object({ reason: z.string().trim().min(5).max(500) })
    .strict()
    .parse(raw);
  await ownIntent(session, id);
  const r = await session.db.rpc("recheck_product_order", {
    input: { id, reason },
  });
  if (r.error)
    throw new HttpError(
      409,
      "Erneute Prüfung nicht möglich; Zahlungsproblem zuerst fachlich klären.",
    );
  return fulfillCheckout(id);
}

export async function resolvePaymentReview(
  session: ProfileSession,
  id: string,
  raw: unknown,
) {
  assertRole(session.role, "admin");
  const { reason } = z
    .object({ reason: z.string().trim().min(5).max(500) })
    .strict()
    .parse(raw);
  const payment = checked(
    await serviceDb()
      .from("product_payment_links")
      .select("id,charge_id,subscription_id")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!payment?.charge_id)
    throw new HttpError(409, "Aktueller Stripe-Zahlungsnachweis fehlt.");
  const stripe = productStripe();
  const { applyChargeOutcome } = await import("./payments");
  await applyChargeOutcome(
    await stripe.charges.retrieve(payment.charge_id),
    stripe,
  );
  if (payment.subscription_id) {
    const { syncSubscription } = await import("../stripe");
    await syncSubscription(payment.subscription_id, stripe);
  }
  const r = await session.db.rpc("resolve_product_payment_review", {
    input: { id, reason },
  });
  if (r.error)
    throw new HttpError(
      409,
      "Zahlungsprüfung konnte nicht abgeschlossen werden.",
    );
  return { ok: true };
}
