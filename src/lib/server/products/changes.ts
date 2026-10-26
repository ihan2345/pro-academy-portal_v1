import { productLiveMode } from "./runtime";
import { countsAsUnit, isRemovedParticipant } from "@/lib/domain";
import { productIdSchema } from "@/lib/products/domain";
import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import Stripe from "stripe";
import type { ProfileSession } from "../parent-profile";
import { serviceDb } from "../service-db";
import { HttpError } from "../security";
import { syncSubscription } from "../stripe";
import { decideProduct } from "@/lib/products/policy";
import { productById } from "./catalog";
import { checked, loadProductContext, collect } from "./context";
import { productStripe, verifyStoredPrice } from "./stripe";
import { requireProductPayments } from "./runtime";
const fingerprint = (s: Stripe.Subscription) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        id: s.id,
        status: s.status,
        customer: typeof s.customer === "string" ? s.customer : s.customer.id,
        cancel: s.cancel_at_period_end,
        pending: s.pending_update,
        schedule: s.schedule,
        items: s.items.data.map((i) => [
          i.id,
          i.price.id,
          i.quantity,
          i.current_period_start,
          i.current_period_end,
        ]),
        invoice:
          typeof s.latest_invoice === "string"
            ? s.latest_invoice
            : s.latest_invoice?.id,
      }),
    )
    .digest("hex");
export async function previewProductChange(
  session: ProfileSession,
  id: string,
  raw: unknown,
) {
  requireProductPayments();
  if (session.role !== "parent")
    throw new HttpError(403, "Bitte mit deinem Elternkonto anmelden.");
  const input = z
      .object({
        player_id: productIdSchema,
        channel: z
          .enum(["catalog", "parents", "trials", "homepage"])
          .default("catalog"),
      })
      .strict()
      .parse(raw),
    db = serviceDb(),
    stripe = productStripe(),
    p = await productById(id),
    ctx = await loadProductContext(session);
  if (!p.published || !ctx.parent_id)
    throw new HttpError(404, "Angebot fehlt.");
  const d = decideProduct(p.published, id, ctx, input.channel, input.player_id);
  if (!d.purchasable || d.mode !== "change")
    throw new HttpError(
      403,
      d.reasons.join(" ") || "Kein freigegebener Tarifwechsel.",
    );
  const child = ctx.children.find((c) => c.id === input.player_id)!,
    members = child.memberships.filter((m) => m.current);
  if (members.length !== 1 || members[0].review)
    throw new HttpError(409, "Abo-Zuordnung bitte zuerst prüfen lassen.");
  const member = members[0],
    sub = await stripe.subscriptions.retrieve(member.stripe_subscription_id, {
      expand: ["latest_invoice"],
    });
  const item = sub.items.data.find((i) => i.id === member.item_id),
    customer =
      typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const accounts = checked<any[]>(
    await db
      .from("parent_stripe_customers")
      .select("parent_id")
      .eq("stripe_customer_id", customer),
  );
  if (
    sub.livemode !== productLiveMode() ||
    sub.status !== "active" ||
    sub.items.has_more ||
    sub.items.data.length !== 1 ||
    !item ||
    item.quantity !== 1 ||
    sub.cancel_at_period_end ||
    sub.cancel_at ||
    sub.pending_update ||
    sub.schedule ||
    sub.collection_method !== "charge_automatically" ||
    accounts.some((a) => a.parent_id !== ctx.parent_id) ||
    !accounts.some((a) => a.parent_id === ctx.parent_id)
  )
    throw new HttpError(
      409,
      "Dieses Abo benötigt vor dem Wechsel eine persönliche Prüfung (Zahlung, Kündigung, mehrere Positionen oder vorgemerkter Wechsel).",
    );
  const invoice =
    typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
  if (!invoice || invoice.status !== "paid" || invoice.amount_remaining)
    throw new HttpError(409, "Bitte zuerst die offene Rechnung klären.");
  const target = await verifyStoredPrice(p.published),
    plan = checked(
      await db
        .from("plans")
        .select("*")
        .eq("id", p.published.plan_id!)
        .single(),
    );
  if (
    plan.generation === "legacy" ||
    target.interval !== item.price.recurring?.interval ||
    target.currency !== item.price.currency
  )
    throw new HttpError(
      400,
      "Bestandspreise, Währungs- und Monats-/Jahreswechsel benötigen eine persönliche Prüfung.",
    );
  const oldFootball = member.units - member.athletics,
    newFootball = plan.included_units - plan.athletics_units;
  const more =
    newFootball >= oldFootball &&
    plan.athletics_units >= member.athletics &&
    target.amount > (item.price.unit_amount ?? 0);
  const less =
    newFootball <= oldFootball &&
    plan.athletics_units <= member.athletics &&
    target.amount < (item.price.unit_amount ?? 0);
  if (!more && !less)
    throw new HttpError(
      400,
      "Dieser Wechsel verändert die Leistungsarten unterschiedlich. Bitte persönlich abstimmen.",
    );
  const prorationDate = Math.floor(Date.now() / 1000);
  let due = 0;
  if (more) {
    const invoicePreview = await stripe.invoices.createPreview({
      customer,
      subscription: sub.id,
      subscription_details: {
        items: [{ id: item.id, price: target.id, quantity: 1 }],
        proration_behavior: "always_invoice",
        proration_date: prorationDate,
      },
    });
    if (
      invoicePreview.livemode !== productLiveMode() ||
      invoicePreview.currency !== target.currency
    )
      throw new HttpError(400, "Ungültige Stripe-Vorschau.");
    due = invoicePreview.amount_due;
  }
  const periods = checked<any[]>(
    await db
      .from("entitlement_periods")
      .select("id,included_units,athletics_units,starts_at,ends_at")
      .eq("player_id", child.id)
      .eq("stripe_item_id", item.id)
      .lte("starts_at", new Date().toISOString())
      .gt("ends_at", new Date().toISOString()),
  );
  const participants = periods.length
    ? await collect(() =>
        db
          .from("event_participants")
          .select(
            "id,status,reason,removed_from_event,training_events!inner(event_type,status)",
          )
          .in(
            "period_id",
            periods.map((p) => p.id),
          ),
      )
    : [];
  let usedFootball = 0,
    usedAthletics = 0,
    planned = 0;
  for (const a of participants)
    if (!isRemovedParticipant(a) && a.training_events.status !== "cancelled") {
      if (a.status === "planned") planned++;
      if (countsAsUnit(a.status))
        a.training_events.event_type === "Athletiktraining"
          ? usedAthletics++
          : usedFootball++;
    }
  const preview = {
    direction: more ? "upgrade" : "downgrade",
    player_id: child.id,
    player_name: child.name,
    current_name: member.plan,
    target_name: p.published.name,
    target_price: target.id,
    current_price: item.price.id,
    current_amount: item.price.unit_amount,
    amount_due: due,
    recurring_amount: target.amount,
    currency: target.currency,
    interval: target.interval,
    effective_at: more ? prorationDate : item.current_period_end,
    period_end: item.current_period_end,
    period_start: item.current_period_start,
    proration_date: prorationDate,
    current_units: member.units,
    current_athletics: member.athletics,
    target_units: plan.included_units,
    target_athletics: plan.athletics_units,
    used_football: usedFootball,
    used_athletics: usedAthletics,
    planned,
    note: more
      ? "Upgrade sofort nach erfolgreicher Zahlung. Bisher angerechnete Einheiten bleiben erhalten."
      : "Downgrade zum Ende des aktuellen Stripe-Abrechnungszeitraums. Die nächste Periode erhält das neue Kontingent.",
  };
  const request = checked(
    await db
      .from("product_change_requests")
      .insert({
        parent_id: ctx.parent_id,
        auth_id: session.user.id,
        player_id: child.id,
        product_id: id,
        product_revision: p.published_revision,
        subscription_id: sub.id,
        item_id: item.id,
        fingerprint: fingerprint(sub),
        preview,
      })
      .select("id,expires_at")
      .single(),
  );
  return { ...request, ...preview };
}
export async function confirmProductChange(
  session: ProfileSession,
  id: string,
) {
  requireProductPayments();
  const db = serviceDb(),
    stripe = productStripe();
  const r = checked(
    await db
      .from("product_change_requests")
      .select("*")
      .eq("id", productIdSchema.parse(id))
      .eq("auth_id", session.user.id)
      .maybeSingle(),
  );
  if (!r) throw new HttpError(404, "Wechselvorschau fehlt.");
  if (r.status !== "preview") return { id, status: r.status };
  if (Date.parse(r.expires_at) < Date.now())
    throw new HttpError(
      409,
      "Preisvorschau ist abgelaufen. Bitte erneut berechnen.",
    );
  const p = await productById(r.product_id),
    ctx = await loadProductContext(session);
  if (
    !p.published ||
    p.published_revision !== r.product_revision ||
    !p.published.channels.some(
      (c) =>
        decideProduct(p.published!, p.id, ctx, c, r.player_id).mode ===
          "change" &&
        decideProduct(p.published!, p.id, ctx, c, r.player_id).purchasable,
    )
  )
    throw new HttpError(409, "Angebot oder Berechtigung hat sich geändert.");
  await verifyStoredPrice(p.published);
  const sub = await stripe.subscriptions.retrieve(r.subscription_id, {
    expand: ["latest_invoice"],
  });
  if (fingerprint(sub) !== r.fingerprint || sub.livemode !== productLiveMode())
    throw new HttpError(
      409,
      "Abonnement hat sich geändert. Bitte neue Vorschau öffnen.",
    );
  const claim = await db
    .from("product_change_requests")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "preview")
    .select("id")
    .maybeSingle();
  if (claim.error || !claim.data)
    throw new HttpError(409, "Es besteht bereits ein offener Wechsel.");
  try {
    if (r.preview.direction === "upgrade") {
      const updated = await stripe.subscriptions.update(
        sub.id,
        {
          items: [
            { id: r.item_id, price: r.preview.target_price, quantity: 1 },
          ],
          payment_behavior: "pending_if_incomplete",
          proration_behavior: "always_invoice",
          proration_date: r.preview.proration_date,
          expand: ["latest_invoice"],
        },
        { idempotencyKey: `product-change:${id}` },
      );
      if (updated.livemode !== productLiveMode())
        throw new Error("Abo gehört zu einer anderen Stripe-Umgebung");
      checked(
        await db
          .from("product_change_requests")
          .update({
            status: "pending_payment",
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select("id"),
      );
      await reconcileProductChanges(sub.id);
      const invoice =
        typeof updated.latest_invoice === "object"
          ? updated.latest_invoice
          : null;
      return {
        id,
        status: checked(
          await db
            .from("product_change_requests")
            .select("status")
            .eq("id", id)
            .single(),
        ).status,
        invoice_url: invoice?.hosted_invoice_url ?? null,
      };
    }
    // A schedule attaches to the SAME subscription and switches only at its end.
    const schedule = await stripe.subscriptionSchedules.create(
      { from_subscription: sub.id },
      { idempotencyKey: `product-change:${id}:schedule` },
    );
    if (schedule.livemode !== productLiveMode() || !schedule.current_phase)
      throw new Error("Ungültiger Testzeitplan");
    checked(
      await db
        .from("product_change_requests")
        .update({ schedule_id: schedule.id })
        .eq("id", id)
        .select("id"),
    );
    await stripe.subscriptionSchedules.update(
      schedule.id,
      {
        end_behavior: "release",
        proration_behavior: "none",
        phases: [
          {
            start_date: schedule.current_phase.start_date,
            end_date: r.preview.period_end,
            items: [{ price: r.preview.current_price, quantity: 1 }],
            proration_behavior: "none",
          },
          {
            start_date: r.preview.period_end,
            duration: { interval: r.preview.interval, interval_count: 1 },
            items: [{ price: r.preview.target_price, quantity: 1 }],
            proration_behavior: "none",
          },
        ],
      },
      { idempotencyKey: `product-change:${id}:phases` },
    );
    checked(
      await db
        .from("product_change_requests")
        .update({ status: "scheduled", updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id"),
    );
    return { id, status: "scheduled" };
  } catch {
    checked(
      await db
        .from("product_change_requests")
        .update({
          status: "review",
          reason:
            "Stripe-Wechsel benötigt erneute Prüfung; nicht erneut abschließen.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("id"),
    );
    throw new HttpError(
      409,
      "Der Wechsel benötigt eine Prüfung. Es wird kein zweites Abo angelegt.",
    );
  }
}
export async function reconcileProductChanges(
  sid: string,
  reviewReason?: string,
) {
  requireProductPayments();
  const db = serviceDb(),
    stripe = productStripe();
  const rows = checked<any[]>(
    await db
      .from("product_change_requests")
      .select("*")
      .eq("subscription_id", sid)
      .in("status", [
        "processing",
        "scheduled",
        "pending_payment",
        ...(reviewReason ? ["review"] : []),
      ]),
  );
  if (!rows.length) return { managed: false, sync_allowed: true };
  const sub = await stripe.subscriptions.retrieve(sid, {
    expand: ["latest_invoice"],
  });
  if (sub.livemode !== productLiveMode())
    throw new HttpError(400, "Abo gehört zu einer anderen Stripe-Umgebung.");
  const invoice =
    typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
  // The existing sync owns subscription status and allowances. A scheduled or
  // unpaid local change must not swallow cancellation or external Stripe updates.
  // pending_if_incomplete keeps the original Stripe item until payment succeeds.
  await syncSubscription(sid, stripe);
  for (const row of rows) {
    const target = sub.items.data.some(
      (i) => i.id === row.item_id && i.price.id === row.preview.target_price,
    );
    let status: string | null = null,
      reason: string | null = null;
    if (["canceled", "unpaid", "incomplete_expired"].includes(sub.status)) {
      status = "failed";
      reason =
        "Abonnement extern beendet oder Zahlung endgültig fehlgeschlagen.";
    } else if (
      target &&
      !sub.pending_update &&
      sub.status === "active" &&
      invoice?.status === "paid" &&
      invoice.amount_remaining === 0 &&
      invoice.livemode === productLiveMode()
    ) {
      status = "completed";
    } else if (
      row.status === "scheduled" &&
      !target &&
      (typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id) !==
        row.schedule_id
    ) {
      status = "failed";
      reason = "Vorgemerkter Wechsel wurde in Stripe aufgehoben oder ersetzt.";
    } else if (
      row.status === "pending_payment" &&
      !target &&
      !sub.pending_update
    ) {
      status = "failed";
      reason =
        "Zahlungsabhängiger Wechsel ist abgelaufen oder wurde extern geändert.";
    }
    if (
      !status &&
      reviewReason &&
      row.status === "review" &&
      !target &&
      !sub.pending_update &&
      (typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id) !==
        row.schedule_id
    ) {
      status = "failed";
      reason = `Adminprüfung: ${reviewReason}. Kein zugehöriger offener Wechsel in Stripe.`;
    }
    if (status)
      checked(
        await db
          .from("product_change_requests")
          .update({ status, reason, updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .select("id"),
      );
  }
  return { managed: true, sync_allowed: true, synced: true };
}
