import { giftAmounts } from "@/lib/products/domain";
import { giftStatusView, ensureGiftRecipientAccess } from "./status";
import "server-only";
import type Stripe from "stripe";
import type { ProfileSession } from "@/lib/server/parent-profile";
import { serviceDb } from "@/lib/server/service-db";
import { checked, loadProductContext } from "@/lib/server/products/context";
import { productLiveMode } from "@/lib/server/products/runtime";
import { productStripe } from "@/lib/server/products/stripe";
import { productById } from "@/lib/server/products/catalog";
import { decideProduct } from "@/lib/products/policy";
import { HttpError } from "@/lib/server/security";
import { giftCheckoutSchema, giftCodeSchema } from "./domain";
import {
  giftHash,
  giftCodeHash,
  newGiftSecret,
  newGiftCode,
  sealGift,
  openGift,
} from "./crypto";
import { requireProductPayments } from "@/lib/server/products/runtime";
import { requireGifts } from "./runtime";
import { ensureGiftValue } from "./stripe";
import { giftBillingConfig } from "./billing";
import { creditGiftPurchase } from "./refunds";

export async function giftSettings() {
  requireGifts();
  return checked<any>(
    await serviceDb().from("gift_settings").select("*").eq("id", true).single(),
  );
}
export async function createGiftCheckout(
  session: ProfileSession | null,
  raw: unknown,
) {
  requireGifts();
  requireProductPayments();
  const input = giftCheckoutSchema.parse(raw),
    db = serviceDb(),
    live = productLiveMode();
  if (session?.user && !session.user.email_confirmed_at)
    throw new HttpError(
      403,
      "Bitte deine E-Mail bestätigen oder den Gastkauf verwenden.",
    );
  const p = await productById(input.product_id),
    ctx = await loadProductContext(session);
  if (
    !p.published ||
    p.published.kind !== "gift" ||
    !decideProduct(p.published, p.id, ctx, "catalog").purchasable
  )
    throw new HttpError(403, "Diese Geschenkkarte ist nicht verfügbar.");
  const settings = await giftSettings();
  if (
    !settings.allow_custom &&
    !giftAmounts(p.published).includes(input.amount)
  )
    throw new HttpError(400, "Bitte einen veröffentlichten Betrag auswählen.");
  const prior = checked<any>(
    await db
      .from("gift_orders")
      .select("*")
      .eq("id", input.request_id)
      .maybeSingle(),
  );
  if (prior) {
    if (
      prior.auth_id !== (session?.user.id ?? null) ||
      prior.buyer.email.toLowerCase() !== input.buyer.email.toLowerCase() ||
      prior.amount !== input.amount ||
      Object.entries(input.recipient).some(
        ([k, v]) => (prior.recipient[k] ?? "") !== v,
      ) ||
      Object.entries(input.buyer).some(
        ([k, v]) => (prior.buyer[k] ?? "") !== v,
      ) ||
      prior.product_id !== input.product_id
    )
      throw new HttpError(
        409,
        "Diese Bestellreferenz wurde bereits verwendet.",
      );
    const key = openGift(prior.access_cipher);
    if (prior.status === "issued")
      return {
        id: prior.id,
        status: prior.status,
        url: `${process.env.APP_URL}/bestellstatus?order=${prior.id}&key=${key}`,
      };
    if (prior.status === "checkout" && prior.checkout_url)
      return { id: prior.id, url: prior.checkout_url };
    if (prior.status === "reserved") {
      const matches: Stripe.Checkout.Session[] = [];
      for await (const candidate of productStripe().checkout.sessions.list({
        created: {
          gte: Math.floor(Date.parse(prior.created_at) / 1000) - 60,
          lte: Math.floor(Date.parse(prior.created_at) / 1000) + 1860,
        },
        limit: 100,
      })) {
        if (
          candidate.client_reference_id === prior.id &&
          candidate.metadata?.gift_order_id === prior.id &&
          candidate.livemode === live &&
          candidate.mode === "payment"
        )
          matches.push(candidate);
      }
      if (matches.length > 1)
        throw new HttpError(
          409,
          "Mehrere Checkout-Zuordnungen benötigen Prüfung.",
        );
      if (matches.length === 1) {
        const recovered = matches[0];
        checked(
          await db
            .from("gift_orders")
            .update({
              session_id: recovered.id,
              checkout_url: recovered.url,
              status: "checkout",
            })
            .eq("id", prior.id),
        );
        if (recovered.status === "complete") {
          await fulfillGiftOrder(prior.id, recovered);
          return {
            id: prior.id,
            url: `${process.env.APP_URL}/bestellstatus?order=${prior.id}&key=${key}`,
          };
        }
        if (recovered.status === "open" && recovered.url)
          return { id: prior.id, url: recovered.url };
        throw new HttpError(
          409,
          "Dieser Checkout ist abgelaufen. Bitte den Dialog schließen und einen neuen Kauf beginnen.",
        );
      }
      if (Date.parse(prior.checkout_expires_at) < Date.now() + 1800000)
        throw new HttpError(
          409,
          "Es wurde kein Checkout gefunden. Bitte den Dialog schließen und einen neuen Kauf beginnen.",
        );
    }
    if (Date.parse(prior.created_at) < Date.now() - 23 * 3600000)
      throw new HttpError(
        409,
        "Diese ältere Geschenkbestellung muss zuerst geprüft werden. Es wird kein zweiter Checkout angelegt.",
      );
    if (prior.status !== "reserved")
      throw new HttpError(409, "Bitte diese Geschenkbestellung zuerst prüfen.");
  }
  const value = await ensureGiftValue(input.amount),
    access = prior ? openGift(prior.access_cipher) : newGiftSecret();
  const recipientAccess = prior?.recipient_access_cipher
    ? openGift(prior.recipient_access_cipher)
    : newGiftSecret();
  const row = {
    id: input.request_id,
    product_id: p.id,
    auth_id: session?.user.id ?? null,
    parent_id: ctx.parent_id,
    buyer: input.buyer,
    recipient: input.recipient,
    amount: input.amount,
    currency: "eur",
    checkout_expires_at:
      prior?.checkout_expires_at ??
      new Date(Date.now() + 1860000).toISOString(),
    livemode: live,
    access_hash: giftHash(access),
    access_cipher: sealGift(access),
    recipient_access_hash: giftHash(recipientAccess),
    recipient_access_cipher: sealGift(recipientAccess),
    appearance: {
      effect_color: p.published.effect_color,
      asset_ids: p.published.asset_ids,
      name: p.published.name,
    },
    stripe_product_id: value.product_id,
    stripe_price_id: value.id,
  };
  if (!prior) checked(await db.from("gift_orders").insert(row));
  const origin = new URL(process.env.APP_URL!).origin;
  const billing = await giftBillingConfig(productStripe());
  const checkout = await productStripe().checkout.sessions.create(
    {
      mode: "payment",
      adaptive_pricing: { enabled: false },
      client_reference_id: row.id,
      metadata: { gift_order_id: row.id },
      payment_intent_data: { metadata: { gift_order_id: row.id } },
      customer_creation: "always",
      customer_email: row.buyer.email,
      line_items: [{ price: value.id, quantity: 1, tax_rates: [billing.tax] }],
      billing_address_collection: "required",
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description:
            "ProAcademy Einzweckgutschein · Leistungen in Deutschland · 19 % USt. im Geschenkwert enthalten",
          metadata: { gift_order_id: row.id },
          footer:
            "Die Umsatzsteuer wird beim Erwerb des Einzweckgutscheins berücksichtigt. Spätere Einlösungen verrechnen den bereits bezahlten und versteuerten Wert.",
        },
      },
      payment_method_types: ["card"],
      locale: "de",
      expires_at: Math.floor(Date.parse(row.checkout_expires_at) / 1000),
      success_url: `${origin}/bestellstatus?order=${row.id}&key=${access}&confirmed=1`,
      cancel_url: `${origin}/bestellstatus?order=${row.id}&key=${access}`,
    },
    { idempotencyKey: `gift-purchase:${row.id}` },
  );
  if (!checkout.url || checkout.livemode !== live)
    throw new HttpError(
      502,
      "Geschenk-Checkout konnte nicht eingerichtet werden.",
    );
  checked(
    await db
      .from("gift_orders")
      .update({
        status: "checkout",
        session_id: checkout.id,
        checkout_url: checkout.url,
      })
      .eq("id", row.id),
  );
  return { id: row.id, url: checkout.url };
}
export async function ownGiftOrder(id: string, key: string) {
  requireGifts();
  if (!/^[0-9a-f-]{36}$/i.test(id) || key.length > 100)
    throw new HttpError(404, "Geschenk nicht gefunden.");
  const order = checked<any>(
    await serviceDb()
      .from("gift_orders")
      .select("*")
      .eq("id", id)
      .eq("access_hash", giftHash(key))
      .eq("livemode", productLiveMode())
      .maybeSingle(),
  );
  if (!order) throw new HttpError(404, "Geschenk nicht gefunden.");
  return order;
}
export async function giftOrderView(id: string, key: string) {
  return giftStatusView(id, key);
}
export async function fulfillGiftOrder(
  id: string,
  prefetched?: Stripe.Checkout.Session,
) {
  requireGifts();
  const db = serviceDb(),
    stripe = productStripe();
  const o = checked<any>(
    await db
      .from("gift_orders")
      .select("*")
      .eq("id", id)
      .eq("livemode", productLiveMode())
      .single(),
  );
  if (!o.session_id)
    throw new HttpError(409, "Checkout-Zuordnung wird noch gespeichert.");
  const s =
    prefetched ?? (await stripe.checkout.sessions.retrieve(o.session_id));
  if (
    s.id !== o.session_id ||
    s.client_reference_id !== o.id ||
    s.metadata?.gift_order_id !== o.id ||
    s.mode !== "payment" ||
    s.livemode !== o.livemode
  )
    throw new HttpError(400, "Checkout passt nicht zu dieser Geschenkkarte.");
  if (s.status === "expired") {
    if (o.status !== "issued")
      checked(
        await db.from("gift_orders").update({ status: "expired" }).eq("id", id),
      );
    return { status: "expired" };
  }
  if (s.status !== "complete" || s.payment_status !== "paid")
    return { status: "pending_payment" };
  const lines = await stripe.checkout.sessions.listLineItems(s.id, {
      limit: 2,
    }),
    line = lines.data[0];
  const piId =
    typeof s.payment_intent === "string"
      ? s.payment_intent
      : s.payment_intent?.id;
  if (
    lines.has_more ||
    lines.data.length !== 1 ||
    line.quantity !== 1 ||
    !line.price ||
    line.price.id !== o.stripe_price_id ||
    (typeof line.price.product === "string"
      ? line.price.product
      : line.price.product.id) !== o.stripe_product_id ||
    s.amount_total !== o.amount ||
    s.amount_subtotal !== o.amount ||
    s.currency !== o.currency ||
    s.total_details?.amount_discount ||
    s.total_details?.amount_shipping ||
    (o.billing_model
      ? s.total_details?.amount_tax !== Math.round((o.amount * 19) / 119)
      : s.total_details?.amount_tax) ||
    !piId
  )
    throw new HttpError(
      400,
      "Geschenkzahlung enthält einen abweichenden Artikel oder Betrag.",
    );
  const pi = await stripe.paymentIntents.retrieve(piId, {
      expand: ["latest_charge"],
    }),
    charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  if (o.billing_model) {
    const invoiceId = typeof s.invoice === "string" ? s.invoice : s.invoice?.id;
    if (!invoiceId)
      throw new HttpError(409, "Gutscheinrechnung wird noch erstellt.");
    const invoice = await stripe.invoices.retrieve(invoiceId);
    if (
      invoice.status !== "paid" ||
      invoice.livemode !== o.livemode ||
      invoice.total !== o.amount ||
      invoice.currency !== o.currency ||
      invoice.amount_remaining !== 0 ||
      (typeof invoice.customer === "string"
        ? invoice.customer
        : invoice.customer?.id) !==
        (typeof s.customer === "string" ? s.customer : s.customer?.id)
    )
      throw new HttpError(409, "Gutscheinrechnung passt nicht zur Zahlung.");
    checked(
      await db
        .from("gift_orders")
        .update({
          invoice_id: invoice.id,
          invoice_url: invoice.hosted_invoice_url,
        })
        .eq("id", o.id),
    );
  }
  if (
    !charge ||
    pi.livemode !== o.livemode ||
    charge.livemode !== o.livemode ||
    pi.status !== "succeeded" ||
    !charge.paid ||
    pi.amount_received !== o.amount ||
    charge.amount !== o.amount ||
    pi.currency !== o.currency ||
    charge.currency !== o.currency ||
    (typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id) !== pi.id
  )
    throw new HttpError(
      400,
      "Geschenkzahlung ist noch nicht vollständig bestätigt.",
    );
  if (charge.refunded || charge.disputed || charge.amount_refunded > 0) {
    if (charge.refunded && o.billing_model)
      await creditGiftPurchase(
        { ...o, payment_id: pi.id },
        (typeof s.invoice === "string" ? s.invoice : s.invoice!.id)!,
        stripe,
      );
    const status = charge.refunded ? "refunded" : "review";
    checked(
      await db.rpc("gift_freeze_order", {
        input: { id: o.id, status, payment_id: pi.id },
      }),
    );
    return { status };
  }
  await ensureGiftRecipientAccess(o);
  const code = newGiftCode();
  const result = await db.rpc("gift_issue_paid_order", {
    input: {
      id: o.id,
      session_id: s.id,
      amount: o.amount,
      currency: o.currency,
      livemode: o.livemode,
      payment_id: pi.id,
      paid_at: new Date(charge.created * 1000).toISOString(),
      code_hash: giftCodeHash(code),
      code_cipher: sealGift(code),
    },
  });
  checked(result);
  return { status: "issued" };
}
async function giftParent(session: ProfileSession) {
  requireGifts();
  if (session.role !== "parent" || !session.user.email_confirmed_at)
    throw new HttpError(
      403,
      "Bitte mit deinem bestätigten Elternkonto anmelden.",
    );
  return (await loadProductContext(session)).parent_id;
}
async function walletForParent(parentId: string | null) {
  if (!parentId) return { available: 0, reserved: 0, credits: [] };
  const credits = checked<any[]>(
    await serviceDb()
      .from("gift_wallet_credits")
      .select("gift_id,amount,remaining,reserved,expires_at,frozen")
      .eq("parent_id", parentId)
      .eq("livemode", productLiveMode()),
  );
  return {
    available: credits
      .filter((c) => !c.frozen && Date.parse(c.expires_at) > Date.now())
      .reduce((n, c) => n + c.remaining - c.reserved, 0),
    reserved: credits.reduce((n, c) => n + c.reserved, 0),
    credits,
  };
}
export async function giftWallet(session: ProfileSession) {
  return walletForParent(await giftParent(session));
}
export async function claimGift(session: ProfileSession, code: string) {
  const parentId = await giftParent(session);
  if (!parentId)
    throw new HttpError(
      400,
      "Bitte zuerst dein Familienkonto im Shop vorbereiten.",
    );
  const value = giftCodeSchema.parse(code),
    r = await serviceDb().rpc("gift_claim", {
      input: {
        code_hash: giftCodeHash(value),
        parent_id: parentId,
        auth_id: session.user.id,
        livemode: productLiveMode(),
      },
    });
  if (r.error) throw new HttpError(409, r.error.message);
  return walletForParent(parentId);
}
