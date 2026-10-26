import { productLiveMode } from "./runtime";
import "server-only";
import Stripe from "stripe";
import { serviceDb } from "../service-db";
import { HttpError } from "../security";
import { checked, collect } from "./context";
import { fulfillCheckout } from "./checkout";
import { productStripe } from "./stripe";
import { requireProductPayments } from "./runtime";
import { recordInvoicePayments, applyChargeOutcome } from "./payments";
import { syncSubscription, syncInvoicePeriods } from "../stripe";
export async function receiveProductEvent(request: Request, bytes: Buffer) {
  requireProductPayments();
  const secret =
    process.env.PRODUCT_STRIPE_WEBHOOK_SECRET ||
    (productLiveMode() ? process.env.STRIPE_WEBHOOK_SECRET : "");
  if (!secret?.startsWith("whsec_"))
    throw new HttpError(503, "Stripe-Webhook ist noch nicht eingerichtet.");
  let event: Stripe.Event;
  try {
    event = await productStripe().webhooks.constructEventAsync(
      bytes,
      request.headers.get("stripe-signature") ?? "",
      secret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    throw new HttpError(400, "Stripe-Signatur ungültig.");
  }
  if (event.livemode !== productLiveMode() || event.account)
    throw new HttpError(
      400,
      "Nur eigene Stripe-Ereignisse dieser Umgebung erlaubt.",
    );
  if (!productEventTypes.includes(event.type)) return { ignored: true };
  return enqueueProductEvent(event);
}
export const productEventTypes: string[] = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  "customer.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
];
export async function enqueueProductEvent(event: Stripe.Event) {
  if (event.livemode !== productLiveMode() || event.account)
    throw Error("Only own Stripe events in the configured mode allowed");
  if (!productEventTypes.includes(event.type)) return { ignored: true };
  const r = await serviceDb()
    .from("product_payment_events")
    .upsert(
      {
        stripe_event_id: event.id,
        type: event.type,
        object_id: (event.data.object as { id: string }).id,
      },
      { onConflict: "stripe_event_id", ignoreDuplicates: true },
    );
  if (r.error)
    throw new HttpError(
      503,
      "Ereignis konnte nicht dauerhaft gespeichert werden.",
    );
  return { received: true };
}
export async function processProductEvents() {
  requireProductPayments();
  const db = serviceDb(),
    stripe = productStripe();
  const jobs = checked<any[]>(await db.rpc("claim_product_events"));
  let processed = 0;
  for (const job of jobs) {
    try {
      if (job.type.startsWith("checkout.session.")) {
        const s = await stripe.checkout.sessions.retrieve(job.object_id);
        if (s.livemode !== productLiveMode())
          throw new Error("Session gehört zu einer anderen Stripe-Umgebung");
        const id = s.metadata?.product_intent_id;
        if (id) {
          const i = checked(
            await db
              .from("product_purchase_intents")
              .select("id,session_id,status")
              .eq("id", id)
              .maybeSingle(),
          );
          if (i) {
            if (!i.session_id)
              throw new Error("Checkout-Verknüpfung noch nicht gespeichert");
            if (i.session_id !== s.id)
              throw new Error("Sessionzuordnung widersprüchlich");
            if (
              job.type === "checkout.session.async_payment_failed" &&
              s.payment_status !== "paid" &&
              i.status !== "fulfilled"
            )
              checked(
                await db
                  .from("product_purchase_intents")
                  .update({
                    status: "failed",
                    reason: "Stripe-Zahlung fehlgeschlagen",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", id)
                  .select("id"),
              );
            else await fulfillCheckout(id);
          }
        }
      } else if (
        job.type.startsWith("customer.subscription.") ||
        job.type.startsWith("invoice.")
      ) {
        let sid = job.object_id,
          invoice: Stripe.Invoice | undefined;
        if (job.type.startsWith("invoice.")) {
          invoice = await stripe.invoices.retrieve(job.object_id);
          if (invoice.livemode !== productLiveMode())
            throw new Error("Rechnung gehört zu einer anderen Stripe-Umgebung");
          const ref = invoice.parent?.subscription_details?.subscription;
          sid = typeof ref === "string" ? ref : (ref?.id ?? "");
        }
        if (sid) {
          const known = checked(
            await db
              .from("subscriptions")
              .select("id,parent_id")
              .eq("stripe_subscription_id", sid)
              .maybeSingle(),
          );
          const liveSub = await stripe.subscriptions.retrieve(sid);
          if (liveSub.livemode !== productLiveMode())
            throw Error("Live subscription blocked");
          const customer =
            typeof liveSub.customer === "string"
              ? liveSub.customer
              : liveSub.customer.id;
          const accounts = checked<any[]>(
            await db
              .from("parent_stripe_customers")
              .select("parent_id")
              .eq("stripe_customer_id", customer),
          );
          if (known || accounts.length === 1) {
            const { reconcileProductChanges } = await import("./changes");
            const change = await reconcileProductChanges(sid);
            if (!("synced" in change && change.synced))
              await syncSubscription(sid, stripe);
            if (!known?.parent_id && accounts.length === 1)
              checked(
                await db
                  .from("subscriptions")
                  .update({ parent_id: accounts[0].parent_id })
                  .eq("stripe_subscription_id", sid)
                  .is("parent_id", null)
                  .select("id"),
              );
            if (invoice?.status === "paid") {
              await syncInvoicePeriods(invoice.id!, sid, stripe);
              await recordInvoicePayments(invoice, stripe);
            }
          }
        }
      } else if (job.type === "customer.updated") {
        const customer = await stripe.customers.retrieve(job.object_id);
        if (customer.deleted || customer.livemode !== productLiveMode())
          throw Error("Invalid test customer");
        checked(
          await db
            .from("parent_stripe_customers")
            .update({ billing_email: customer.email })
            .eq("stripe_customer_id", customer.id)
            .select("id"),
        );
        checked(
          await db
            .from("parents")
            .update({ billing_email: customer.email })
            .eq("stripe_customer_id", customer.id)
            .select("id"),
        );
      } else {
        const dispute = job.type.startsWith("charge.dispute.")
          ? await stripe.disputes.retrieve(job.object_id)
          : null;
        if (dispute && dispute.livemode !== productLiveMode())
          throw Error("Live dispute blocked");
        const chargeId = dispute
          ? typeof dispute.charge === "string"
            ? dispute.charge
            : dispute.charge.id
          : job.object_id;
        const charge = await stripe.charges.retrieve(chargeId);
        await applyChargeOutcome(charge, stripe, dispute?.status === "won");
      }
      checked(
        await db
          .from("product_payment_events")
          .update({ status: "processed", last_error: null })
          .eq("id", job.id)
          .eq("lease_token", job.lease_token)
          .select("id"),
      );
      processed++;
    } catch {
      checked(
        await db
          .from("product_payment_events")
          .update({
            status: "failed",
            last_error:
              "Stripe-Ereignis konnte nicht vollständig verarbeitet werden.",
            available_at: new Date(
              Date.now() + 60000 * Math.min(60, 2 ** job.attempts),
            ).toISOString(),
          })
          .eq("id", job.id)
          .eq("lease_token", job.lease_token)
          .select("id"),
      );
    }
  }
  return { processed };
}
