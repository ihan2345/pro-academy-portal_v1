import "server-only";
import Stripe from "stripe";
import { required, stripeTestGuard } from "./config";
import { serviceDb } from "./service-db";
import { periodFromStripe } from "../domain";
export function stripeClient() {
  const key = required("STRIPE_SECRET_KEY");
  stripeTestGuard(key);
  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
  });
}
export const supportedEvents = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.updated",
]);
export async function verifyStripe(body: string, signature: string) {
  return stripeClient().webhooks.constructEventAsync(
    body,
    signature,
    required("STRIPE_WEBHOOK_SECRET"),
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}
export async function persistStripeEvent(event: Stripe.Event) {
  if (process.env.APP_MODE !== "production" && event.livemode)
    throw new Error("Live-Ereignisse im Testbetrieb gesperrt");
  // The existing signed webhook also feeds the durable product inbox. This is
  // independent of storefront visibility so paid orders finish while the shop is paused.
  if (
    process.env.PRODUCT_MANAGEMENT_ENABLED === "true" &&
    process.env.PRODUCT_PAYMENTS_ENABLED === "true"
  ) {
    const { enqueueProductEvent } = await import("./products/events");
    await enqueueProductEvent(event);
  }
  if (!supportedEvents.has(event.type)) return { ignored: true };
  const { error } = await serviceDb().from("stripe_webhook_events").upsert(
    {
      stripe_event_id: event.id,
      type: event.type,
      stripe_created: event.created,
      payload: event,
    },
    { onConflict: "stripe_event_id", ignoreDuplicates: true },
  );
  if (error) throw error;
  return { received: true };
}
export async function syncSubscription(id: string, client?: Stripe) {
  const retrieved = new Date().toISOString(),
    stripe = client ?? stripeClient(),
    subscription = await stripe.subscriptions.retrieve(id);
  const customer =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const completeItems = [...subscription.items.data];
  if (subscription.items.has_more) {
    completeItems.length = 0;
    for await (const item of stripe.subscriptionItems.list({
      subscription: id,
      limit: 100,
    })) {
      completeItems.push(item);
      if (completeItems.length > 1000)
        throw new Error("Zu viele Abo-Positionen für eine sichere Zuordnung.");
    }
  }
  const items = completeItems.map((item) => ({
    id: item.id,
    price_id: item.price.id,
    quantity: item.quantity,
    ...periodFromStripe(item.current_period_start, item.current_period_end),
  }));
  const { data, error } = await serviceDb().rpc("apply_stripe_package_sync", {
    input: {
      stripe_subscription_id: subscription.id,
      stripe_customer_id: customer,
      status: subscription.status,
      cancel_at_period_end: subscription.cancel_at_period_end,
      cancel_at: subscription.cancel_at,
      schedule_id:
        typeof subscription.schedule === "string"
          ? subscription.schedule
          : (subscription.schedule?.id ?? null),
      ended_at: subscription.ended_at
        ? new Date(subscription.ended_at * 1000).toISOString()
        : null,
      subscription_created_at: new Date(
        subscription.created * 1000,
      ).toISOString(),
      billing_cycle_anchor: new Date(
        subscription.billing_cycle_anchor * 1000,
      ).toISOString(),
      retrieved_at: retrieved,
      items,
    },
  });
  if (error) throw error;
  return { id: data, subscription };
}
export async function processStripeInbox() {
  const db = serviceDb(),
    { data: jobs, error } = await db.rpc("claim_stripe", { batch_size: 20 });
  if (error) throw error;
  let processed = 0;
  for (const job of jobs ?? []) {
    try {
      const event = job.payload as Stripe.Event,
        obj = event.data.object as unknown as Record<string, unknown>;
      let subscriptionId: string | undefined;
      if (event.type.startsWith("customer.subscription."))
        subscriptionId = String(obj.id);
      else if (event.type === "checkout.session.completed")
        subscriptionId =
          typeof obj.subscription === "string" ? obj.subscription : undefined;
      else if (event.type.startsWith("invoice.")) {
        const invoice = obj as unknown as Stripe.Invoice;
        const sub = invoice.parent?.subscription_details?.subscription;
        subscriptionId = typeof sub === "string" ? sub : sub?.id;
      }
      if (subscriptionId) await syncSubscription(subscriptionId);
      if (event.type === "customer.updated") {
        const customer = await stripeClient().customers.retrieve(
          String(obj.id),
        );
        if (!customer.deleted) {
          const accounts = await db
            .from("parent_stripe_customers")
            .update({ billing_email: customer.email })
            .eq("stripe_customer_id", customer.id);
          if (accounts.error) throw accounts.error;
          const updated = await db
            .from("parents")
            .update({ billing_email: customer.email })
            .eq("stripe_customer_id", customer.id);
          if (updated.error) throw updated.error;
        }
      }
      // Invoice periods are imported separately to recover missed cycles, using Stripe-owned line periods.
      if (event.type === "invoice.paid" && subscriptionId)
        await syncInvoicePeriods(String(obj.id), subscriptionId);
      const result = await db
        .from("stripe_webhook_events")
        .update({
          status: "processed",
          processed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", job.id)
        .eq("lease_token", job.lease_token);
      if (result.error) throw result.error;
      processed++;
    } catch (error) {
      const result = await db
        .from("stripe_webhook_events")
        .update({
          status: job.attempts >= 6 ? "failed" : "pending",
          last_error:
            error instanceof Error
              ? error.message
              : "Stripe-Synchronisierung fehlgeschlagen",
          available_at: new Date(
            Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts),
          ).toISOString(),
        })
        .eq("id", job.id)
        .eq("lease_token", job.lease_token);
      if (result.error) throw result.error;
    }
  }
  return processed;
}
export async function syncInvoicePeriods(
  invoiceId: string,
  subscriptionId: string,
  client?: Stripe,
) {
  const db = serviceDb(),
    { data: sub, error } = await db
      .from("subscriptions")
      .select("*")
      .eq("stripe_subscription_id", subscriptionId)
      .single();
  if (error) throw error;
  const { data: mappings, error: me } = await db
    .from("subscription_players")
    .select("*")
    .eq("subscription_id", sub.id);
  if (me) throw me;
  for await (const line of (client ?? stripeClient()).invoices.listLineItems(
    invoiceId,
    {
      limit: 100,
    },
  )) {
    const itemId = line.parent?.subscription_item_details?.subscription_item;
    const mapping = mappings?.find((m) => m.stripe_item_id === itemId);
    const priceId = line.pricing?.price_details?.price;
    if (
      !mapping ||
      !priceId ||
      line.parent?.subscription_item_details?.proration
    )
      continue;
    const result = await db.rpc("import_stripe_allowance", {
      input: {
        subscription_id: subscriptionId,
        item_id: itemId,
        price_id: priceId,
        ...periodFromStripe(line.period.start, line.period.end),
      },
    });
    if (result.error) throw result.error;
  }
}
