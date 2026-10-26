import { productLiveMode } from "./runtime";
import "server-only";
import type Stripe from "stripe";
import { serviceDb } from "../service-db";
import { checked, collect } from "./context";
const ref = (v: string | { id?: string } | null | undefined) =>
  typeof v === "string" ? v : v?.id;
export async function recordInvoicePayments(
  invoice: Stripe.Invoice,
  stripe: Stripe,
) {
  if (invoice.livemode !== productLiveMode() || !invoice.id)
    throw Error("Invalid test invoice");
  const sid = ref(invoice.parent?.subscription_details?.subscription);
  if (!sid) return;
  const db = serviceDb();
  const sub = checked(
    await db
      .from("subscriptions")
      .select("parent_id,stripe_customer_id")
      .eq("stripe_subscription_id", sid)
      .maybeSingle(),
  );
  if (!sub?.parent_id || sub.stripe_customer_id !== ref(invoice.customer))
    return;
  const orders = await collect(() =>
    db.from("product_purchase_intents").select("id").eq("subscription_id", sid),
  );
  for await (const payment of stripe.invoicePayments.list({
    invoice: invoice.id,
    status: "paid",
    limit: 100,
  })) {
    const pi = ref(payment.payment.payment_intent);
    if (
      payment.livemode !== productLiveMode() ||
      !pi ||
      payment.amount_paid == null
    )
      continue;
    checked(
      await db
        .from("product_payment_links")
        .upsert(
          {
            parent_id: sub.parent_id,
            intent_id: orders.length === 1 ? orders[0].id : null,
            subscription_id: sid,
            invoice_id: invoice.id,
            payment_intent_id: pi,
            amount: payment.amount_paid,
            currency: payment.currency,
          },
          { onConflict: "payment_intent_id,invoice_id" },
        )
        .select("id"),
    );
  }
}
export async function applyChargeOutcome(
  charge: Stripe.Charge,
  stripe: Stripe,
  disputeWon = false,
) {
  if (charge.livemode !== productLiveMode()) throw Error("Live charge blocked");
  const pi = ref(charge.payment_intent);
  if (!pi) return;
  // This also recovers payments of pre-existing / externally changed subscriptions.
  for await (const p of stripe.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: pi },
    status: "paid",
    limit: 100,
  })) {
    if (p.livemode !== productLiveMode())
      throw Error("Live invoice payment blocked");
    const invoice = await stripe.invoices.retrieve(ref(p.invoice)!);
    await recordInvoicePayments(invoice, stripe);
  }
  const db = serviceDb(),
    links = await collect(() =>
      db
        .from("product_payment_links")
        .select("id,intent_id,subscription_id,charge_state,review_resolved_at")
        .eq("payment_intent_id", pi),
    );
  const status = charge.refunded
    ? "refunded"
    : charge.amount_refunded > 0 ||
        !charge.paid ||
        (charge.disputed && !disputeWon)
      ? "review"
      : "paid";
  const reason =
    status === "refunded"
      ? "Erstattung bestätigt"
      : status === "review"
        ? "Teilerstattung oder Zahlungsstreit: fachliche Prüfung erforderlich"
        : null;
  const chargeState = JSON.stringify({
    paid: charge.paid,
    refunded: charge.refunded,
    amount_refunded: charge.amount_refunded,
    disputed: charge.disputed,
  });
  const unresolved = links.filter(
    (link) => link.charge_state !== chargeState || !link.review_resolved_at,
  );
  for (const link of links) {
    const ledgerStatus =
      status === "paid" && disputeWon && link.subscription_id
        ? "review"
        : status;
    const ledgerReason =
      ledgerStatus === "review" && disputeWon
        ? "Zahlungsstreit gewonnen; Vertragsprüfung abschließen"
        : reason;
    checked(
      await db
        .from("product_payment_links")
        .update({
          status: ledgerStatus,
          charge_id: charge.id,
          charge_state: chargeState,
          updated_at: new Date().toISOString(),
          ...(link.charge_state !== chargeState
            ? {
                review_resolved_at: null,
                review_resolved_by: null,
                reason: ledgerReason,
              }
            : {}),
        })
        .eq("id", link.id)
        .select("id"),
    );
  }
  if (status !== "paid" || disputeWon)
    for (const sid of new Set(
      unresolved.map((x) => x.subscription_id).filter(Boolean),
    ))
      checked(
        await db
          .from("subscriptions")
          .update({ needs_review: true })
          .eq("stripe_subscription_id", sid)
          .select("id"),
      );
  const direct = await collect(() =>
    db
      .from("product_purchase_intents")
      .select("id,camp_booking_id,product,status")
      .eq("payment_id", pi),
  );
  const linkedIds = links.map((x) => x.intent_id).filter(Boolean);
  const linked = linkedIds.length
    ? await collect(() =>
        db
          .from("product_purchase_intents")
          .select("id,camp_booking_id,product,status")
          .in("id", linkedIds),
      )
    : [];
  for (const i of new Map(
    [...direct, ...linked].map((i) => [i.id, i]),
  ).values()) {
    // Refunds do not cancel contracts or rewrite historical training allowances.
    const orderStatus = status === "paid" ? "fulfilled" : status;
    if (status === "paid" && (!disputeWon || i.status !== "review")) continue;
    if (i.product.kind === "subscription") {
      if (links.length && !unresolved.some((link) => link.intent_id === i.id))
        continue;
      checked(
        await db
          .from("product_purchase_intents")
          .update({
            ...(status !== "paid" ? { status: "review" } : {}),
            reason:
              reason ??
              "Zahlungsstreit gewonnen; Vertragsprüfung separat abschließen",
            updated_at: new Date().toISOString(),
          })
          .eq("id", i.id)
          .select("id"),
      );
      continue;
    }
    checked(
      await db
        .from("product_purchases")
        .update({ status: status === "paid" ? "active" : status })
        .eq("intent_id", i.id)
        .select("id"),
    );
    checked(
      await db
        .from("product_purchase_intents")
        .update({
          status: orderStatus,
          reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", i.id)
        .select("id"),
    );
    if (i.camp_booking_id)
      checked(
        await db
          .from("camp_bookings")
          .update({
            status: status === "paid" ? "paid" : status,
            review_reason: reason,
          })
          .eq("id", i.camp_booking_id)
          .select("id"),
      );
  }
}
