import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "../service-db";
import { HttpError } from "../security";
import { checked } from "./context";
import { productIdSchema } from "@/lib/products/domain";
import { fulfillCheckout } from "./checkout";
const cookieName = "pa_product_guest";
export async function guestBrowserHash(create = false) {
  const store = await cookies();
  let token = store.get(cookieName)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    if (!create) return null;
    token = randomBytes(32).toString("hex");
    store.set(cookieName, token, {
      httpOnly: true,
      secure: process.env.APP_MODE === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 86400,
    });
  }
  return createHash("sha256").update(token).digest("hex");
}
export async function ownGuestIntent(id: string) {
  productIdSchema.parse(id);
  const hash = await guestBrowserHash();
  if (!hash) throw new HttpError(404, "Kaufauftrag nicht gefunden.");
  const i = checked(
    await serviceDb()
      .from("product_purchase_intents")
      .select("*")
      .eq("id", id)
      .eq("guest_token_hash", hash)
      .maybeSingle(),
  );
  if (!i?.guest_data) throw new HttpError(404, "Kaufauftrag nicht gefunden.");
  return i;
}
export async function limitGuestRequest(key: string) {
  // Hash before persisting rate-limit identifiers, including IP/email addresses.
  const hash = createHash("sha256").update(key).digest("hex");
  if (!checked(await serviceDb().rpc("limit_product_request", { key: hash })))
    throw new HttpError(
      429,
      "Bitte warte einige Minuten und versuche es erneut.",
    );
}
export async function requestGuestAccess(id: string) {
  const i = await ownGuestIntent(id);
  if (!i.proof || !["fulfilled", "review"].includes(i.status))
    throw new HttpError(409, "Bitte zuerst den Zahlungsstatus aktualisieren.");
  await limitGuestRequest(`guest-access:${i.guest_data.email}`);
  const r = await serviceDb().rpc("queue_product_guest_access", {
    purchase: i.id,
  });
  checked(r);
  return {
    message:
      "Deine Buchung bleibt erhalten. Der Zugangslink wird an die beim Kauf angegebene E-Mail-Adresse gesendet.",
  };
}
export async function claimGuestPurchases(db: SupabaseClient) {
  const r = await db.rpc("claim_product_guest_orders");
  if (r.error)
    throw new HttpError(
      409,
      "Die Familienzuordnung benötigt eine Prüfung durch die Verwaltung.",
    );
  for (const id of r.data ?? []) {
    try {
      await fulfillCheckout(id);
    } catch {
      /* Paid order stays visible in administration; never interrupt authentication. */
    }
  }
}
export async function resumeGuestOrder(id: string, cancel = false) {
  const i = await ownGuestIntent(id);
  if (["fulfilled", "refunded"].includes(i.status))
    return { id, status: i.status };
  const { productStripe } = await import("./stripe");
  const { productLiveMode } = await import("./runtime");
  const { productById } = await import("./catalog");
  const { guestProductContext } = await import("@/lib/products/guest");
  const { decideProduct } = await import("@/lib/products/policy");
  const stripe = productStripe();
  if (!i.session_id && i.customer_id) {
    // Recover a lost create response, rather than opening a second payment.
    for await (const remote of stripe.checkout.sessions.list({
      customer: i.customer_id,
      limit: 100,
    })) {
      if (
        remote.livemode === productLiveMode() &&
        remote.client_reference_id === id &&
        remote.metadata?.product_intent_id === id
      ) {
        checked(
          await serviceDb()
            .from("product_purchase_intents")
            .update({ session_id: remote.id, checkout_url: remote.url })
            .eq("id", id)
            .select("id"),
        );
        i.session_id = remote.id;
        break;
      }
    }
  }
  if (!i.session_id)
    throw new HttpError(
      409,
      "Der Bestellstart ist noch nicht abgeschlossen. Bitte mit denselben Angaben erneut versuchen oder die Verwaltung kontaktieren.",
    );
  let remote = await stripe.checkout.sessions.retrieve(i.session_id);
  if (
    remote.livemode !== productLiveMode() ||
    remote.client_reference_id !== id ||
    remote.metadata?.product_intent_id !== id
  )
    throw new HttpError(409, "Checkout-Zuordnung benötigt eine Prüfung.");
  if (
    cancel &&
    remote.status === "open" &&
    remote.payment_status === "unpaid"
  ) {
    try {
      await stripe.checkout.sessions.expire(remote.id);
    } catch {
      /* Concurrent payment: re-read before release. */
    }
    remote = await stripe.checkout.sessions.retrieve(remote.id);
  }
  if (remote.status === "expired" || remote.status === "complete")
    return fulfillCheckout(id);
  if (cancel || i.status === "review")
    throw new HttpError(
      409,
      "Die Zahlung oder Zuordnung benötigt eine Prüfung. Bitte nicht erneut kaufen.",
    );
  const p = await productById(i.product_id);
  if (
    !p.published ||
    p.published_revision !== i.product_revision ||
    !decideProduct(
      p.published,
      p.id,
      guestProductContext(i.player_id, i.player_data),
      i.channel,
      i.player_id,
    ).purchasable
  )
    throw new HttpError(
      409,
      "Angebot geändert. Bitte den offenen Checkout beenden oder prüfen lassen.",
    );
  if (
    !remote.url ||
    new URL(remote.url).origin !== "https://checkout.stripe.com"
  )
    throw new HttpError(409, "Checkout-Link nicht verfügbar.");
  return { id, status: "checkout", url: remote.url };
}
