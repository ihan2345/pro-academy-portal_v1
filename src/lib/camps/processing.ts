import "server-only";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { serviceDb } from "@/lib/server/service-db";
import { HttpError } from "@/lib/server/security";
import { campProcessingEnabled } from "./processing-config";
import { campPaymentMode } from "./runtime";
import { confirmPayment } from "./service";
import { collectCampReview } from "../../../scripts/camp/stripe-review-lib.mjs";

type Source = {
  camp_id: string;
  payment_link_id: string;
  price_id: string;
  product_id: string;
};
function checked<T>(result: { data: T; error: unknown }): NonNullable<T> {
  if (result.error)
    throw new Error("Camp-Verarbeitung: Datenbankzugriff fehlgeschlagen.");
  return result.data as NonNullable<T>;
}
export function campReadStripe() {
  const key =
    process.env.CAMP_STRIPE_READ_KEY ?? process.env.STRIPE_SECRET_KEY ?? "";
  if (!/^(sk|rk)_live_/.test(key))
    throw new Error("Camp: Stripe-Lesezugang fehlt.");
  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 10000,
    maxNetworkRetries: 1,
  });
}
export async function campProcessingSources(
  campId?: string,
): Promise<Source[]> {
  const db = serviceDb();
  const camps = checked(
    await db.from("camps").select("id").eq("payment_mode", "live"),
  );
  const ids = camps.map((c) => c.id).filter((id) => !campId || id === campId);
  if (!ids.length) return [];
  const [legacy, offers] = await Promise.all([
    db.from("camp_stripe_sources").select("*").in("camp_id", ids),
    db
      .from("camp_offers")
      .select(
        "camp_id,stripe_payment_link_id,stripe_price_id,stripe_product_id",
      )
      .in("camp_id", ids),
  ]);
  const sources: Source[] = [
    ...checked(legacy),
    ...checked(offers).map((o) => ({
      camp_id: o.camp_id,
      payment_link_id: o.stripe_payment_link_id,
      price_id: o.stripe_price_id,
      product_id: o.stripe_product_id,
    })),
  ];
  const unique = new Map<string, Source>();
  for (const source of sources) {
    const previous = unique.get(source.payment_link_id);
    if (
      previous &&
      (previous.camp_id !== source.camp_id ||
        previous.price_id !== source.price_id ||
        previous.product_id !== source.product_id)
    )
      throw new Error("Stripe-Link ist mehreren Angeboten zugeordnet.");
    unique.set(source.payment_link_id, source);
  }
  return [...unique.values()];
}

// Store only event references. Stripe payloads cannot directly create families or bookings.
export async function enqueueCampEvent(event: Stripe.Event) {
  if (!event.livemode || event.account) return { ignored: true };
  const accepted = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.closed",
  ];
  if (!accepted.includes(event.type)) return { ignored: true };
  const stripe = campReadStripe();
  const object = event.data.object as unknown as {
    id: string;
    payment_intent?: string | { id: string } | null;
  };
  const sources = await campProcessingSources();
  const sessions: Stripe.Checkout.Session[] = [];
  if (event.type.startsWith("checkout.session.")) {
    sessions.push(await stripe.checkout.sessions.retrieve(object.id));
  } else {
    const payment =
      typeof object.payment_intent === "string"
        ? object.payment_intent
        : object.payment_intent?.id;
    if (!payment) return { ignored: true };
    for await (const session of stripe.checkout.sessions.list({
      payment_intent: payment,
      limit: 100,
    }))
      sessions.push(session);
  }
  const matched = sessions.filter(
    (s) =>
      s.livemode &&
      s.mode === "payment" &&
      sources.some(
        (source) =>
          source.payment_link_id ===
          (typeof s.payment_link === "string"
            ? s.payment_link
            : s.payment_link?.id),
      ),
  );
  if (!matched.length) return { ignored: true };
  // An event's payment must never map to multiple Camps/sessions.
  if (matched.length !== 1) throw new Error("Mehrdeutige Camp-Zahlung.");
  const session = matched[0];
  const link =
    typeof session.payment_link === "string"
      ? session.payment_link
      : session.payment_link?.id;
  const source = sources.find((s) => s.payment_link_id === link)!;
  checked(
    await serviceDb().from("camp_payment_events").upsert(
      {
        event_id: event.id,
        camp_id: source.camp_id,
        payment_link_id: link,
        session_id: session.id,
      },
      { onConflict: "event_id", ignoreDuplicates: true },
    ),
  );
  return { received: true };
}

export async function runCampProcessing() {
  if (!campProcessingEnabled())
    throw new Error("Camp-Serververarbeitung ist nicht freigegeben.");
  const db = serviceDb(),
    token = randomUUID();
  if (!checked(await db.rpc("camp_claim_processing", { owner: token })))
    return { busy: true, sources: 0, failed: 0 };
  let count = 0,
    failed = 0;
  try {
    const stripe = campReadStripe();
    for (const source of await campProcessingSources()) {
      if (!checked(await db.rpc("camp_claim_processing", { owner: token })))
        throw new Error("Camp-Verarbeitung wurde übernommen.");
      const started = new Date().toISOString();
      try {
        // Approved live offers also support admin review for direct-link purchases.
        // Existing source mappings are never overwritten by the processor.
        checked(
          await db.from("camp_stripe_sources").upsert(source, {
            onConflict: "payment_link_id",
            ignoreDuplicates: true,
          }),
        );
        // Full source reconciliation also repairs missed webhooks and refunds after downtime.
        const result = await collectCampReview(stripe, [source]);
        // Renew the lease before writing or confirming after potentially slow network reads.
        if (!checked(await db.rpc("camp_claim_processing", { owner: token })))
          throw new Error("Camp-Verarbeitung wurde übernommen.");
        for (const record of result.records) {
          if (
            !record.booking_reference ||
            !/^[0-9a-f-]{36}$/i.test(record.booking_reference)
          )
            continue;
          const booking = checked(
            await db
              .from("camp_bookings")
              .select("id,child_data,booking_origin,stripe_payment_link_id")
              .eq("id", record.booking_reference)
              .eq("camp_id", source.camp_id)
              .maybeSingle(),
          );
          if (
            !booking ||
            booking.booking_origin !== "checkout" ||
            booking.stripe_payment_link_id !== source.payment_link_id
          )
            continue;
          if (campPaymentMode() !== "live")
            throw new Error("Live-Buchungsbestätigung ist nicht freigegeben.");
          let confirmation;
          try {
            confirmation = await confirmPayment(record.session_id, true);
          } catch (error) {
            if (!(error instanceof HttpError) || error.status >= 500)
              throw error;
            record.status = "review";
            record.issues.push(
              "Portal-Zahlung konnte nicht zugeordnet werden; manuell prüfen",
            );
            continue;
          }
          record.child_name = `${booking.child_data.first_name} ${booking.child_data.last_name}`;
          record.issues = record.issues.filter(
            (issue: string) => issue !== "Kindesname fehlt",
          );
          record.status =
            confirmation.status === "refunded"
              ? "refunded"
              : confirmation.status === "paid" && !record.issues.length
                ? "paid"
                : "review";
          if (confirmation.status === "review")
            record.issues.push(
              "Portal-Buchung benötigt Zuordnungs- oder Zahlungsprüfung",
            );
        }
        checked(
          await db.rpc("camp_store_review", {
            owner: token,
            source,
            rows: result.records,
            started,
            failure: null,
          }),
        );
        count++;
      } catch {
        failed++;
        checked(
          await db.rpc("camp_store_review", {
            owner: token,
            source,
            rows: [],
            started,
            failure:
              "Abgleich fehlgeschlagen. Der letzte vollständige Stand bleibt erhalten; der nächste Lauf versucht es erneut.",
          }),
        );
      }
    }
  } finally {
    checked(await db.from("camp_processing_lease").delete().eq("token", token));
  }
  return { sources: count, failed };
}

export async function readServerReview(campId: string) {
  const db = serviceDb();
  const sources = await campProcessingSources(campId);
  const snapshots = checked(
    await db.from("camp_review_snapshots").select("*").eq("camp_id", campId),
  );
  const current = sources.map((s) =>
    snapshots.find((r) => r.payment_link_id === s.payment_link_id),
  );
  const checkedAt =
    current.length && current.every((s) => s?.checked_at)
      ? current.map((s) => s!.checked_at as string).sort()[0]
      : null;
  return {
    running: campProcessingEnabled(),
    interval_seconds: 300,
    checked_at: checkedAt,
    error: current.some((s) => s?.error)
      ? "Mindestens ein Zahlungsangebot konnte zuletzt nicht vollständig abgeglichen werden."
      : null,
    sources,
    records: current.flatMap((s) => s?.records ?? []),
  };
}
