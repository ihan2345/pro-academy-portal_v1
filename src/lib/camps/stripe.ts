import "server-only";
import Stripe from "stripe";
import { serviceDb } from "@/lib/server/service-db";
import { HttpError } from "@/lib/server/security";
import { campPaymentMode, campLocalEnabled } from "./runtime";
import type { Offer } from "./domain";

export function campStripe() {
  const key = process.env.CAMP_STRIPE_SECRET_KEY ?? "";
  const mode = campPaymentMode();
  if (!(mode === "live" ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/).test(key))
    throw new HttpError(
      503,
      "Stripe-Zugang passt nicht zum freigegebenen Zahlungsmodus.",
    );
  if (
    mode === "live" &&
    (campLocalEnabled() || process.env.CAMP_LIVE_PAYMENTS_ENABLED !== "true")
  )
    throw new HttpError(503, "Live-Zahlungen sind noch nicht freigegeben.");
  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 10000,
    maxNetworkRetries: 1,
  });
}
export async function verifyOffer(
  priceId: string,
  linkId: string | null,
  codes: Record<string, string>,
) {
  if (!linkId) return verifyCheckoutOffer(priceId, codes);
  const stripe = campStripe();
  const [price, link, lines] = await Promise.all([
    stripe.prices.retrieve(priceId),
    stripe.paymentLinks.retrieve(linkId),
    stripe.paymentLinks.listLineItems(linkId),
  ]);
  if (
    price.livemode !== (campPaymentMode() === "live") ||
    link.livemode !== (campPaymentMode() === "live") ||
    price.type !== "one_time" ||
    !price.active ||
    !price.unit_amount ||
    price.currency !== "eur" ||
    !link.active ||
    lines.has_more ||
    lines.data.length !== 1 ||
    lines.data[0].price?.id !== price.id ||
    lines.data[0].quantity !== 1 ||
    link.line_items?.data.some((l) => l.quantity !== 1)
  )
    throw new HttpError(
      400,
      "Zahlungslink muss genau einen einmaligen EUR-Preis im passenden Zahlungsmodus enthalten.",
    );
  if (link.customer_creation !== "always")
    throw new HttpError(
      400,
      "Im Zahlungslink muss die Kundenerstellung aktiviert sein.",
    );
  if (Object.values(codes).some(Boolean) && !link.allow_promotion_codes)
    throw new HttpError(
      400,
      "Im Zahlungslink ist die Eingabe von Rabattcodes nicht aktiviert.",
    );
  const productId =
    typeof price.product === "string" ? price.product : price.product.id;
  await verifiedCampCodes(stripe, productId, codes);
  // Raw GET retains adjustable_quantity, which Stripe's line-item list does not expose.
  const raw = await fetch(
    `https://api.stripe.com/v1/payment_links/${encodeURIComponent(linkId)}?expand[]=line_items`,
    {
      headers: {
        Authorization: `Bearer ${process.env.CAMP_STRIPE_SECRET_KEY}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!raw.ok)
    throw new HttpError(
      502,
      "Stripe-Zahlungslink konnte nicht geprüft werden.",
    );
  const config = await raw.json();
  if (
    config.line_items?.data?.some(
      (l: { adjustable_quantity?: { enabled?: boolean } }) =>
        l.adjustable_quantity?.enabled,
    ) ||
    config.optional_items?.length ||
    (config.automatic_tax?.enabled && price.tax_behavior !== "inclusive")
  )
    throw new HttpError(
      400,
      "Mengenänderungen und Zusatzartikel sind nicht erlaubt. Bei Steuerberechnung muss der EUR-Preis inklusive Steuer hinterlegt sein.",
    );
  return {
    stripe_price_id: price.id,
    stripe_product_id: productId,
    stripe_payment_link_id: link.id,
    payment_url: link.url,
    amount: price.unit_amount,
    currency: price.currency,
    codes,
    livemode: price.livemode,
  };
}
async function verifiedCampCodes(
  stripe: Stripe,
  productId: string,
  codes: Record<string, string>,
) {
  const ids: Record<string, string> = {};
  for (const [percent, code] of Object.entries(codes)) {
    if (!code) continue;
    const promotions = await stripe.promotionCodes.list({
      code,
      active: true,
      limit: 10,
    });
    const promo = promotions.data.find(
      (p) => p.code.toLowerCase() === code.toLowerCase(),
    );
    if (!promo || !promo.coupon.valid)
      throw new HttpError(
        400,
        `Der Rabattcode für ${percent} % ist bei Stripe nicht aktiv oder nicht mehr gültig. Bitte kontaktiere die Academy.`,
      );
    if (
      promo.coupon.percent_off !== Number(percent) ||
      (promo.coupon.applies_to?.products &&
        !promo.coupon.applies_to.products.includes(productId))
    )
      throw new HttpError(
        400,
        `Rabattcode für ${percent} % passt nicht zum Stripe-Produkt.`,
      );
    ids[percent] = promo.id;
  }
  return ids;
}
export async function verifyCheckoutOffer(
  priceId: string,
  codes: Record<string, string>,
) {
  const stripe = campStripe();
  const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
  const product =
    typeof price.product === "string"
      ? await stripe.products.retrieve(price.product)
      : price.product;
  if (
    product.deleted ||
    !product.active ||
    product.livemode !== (campPaymentMode() === "live") ||
    price.livemode !== (campPaymentMode() === "live") ||
    !price.active ||
    price.type !== "one_time" ||
    !price.unit_amount ||
    price.currency !== "eur" ||
    price.billing_scheme !== "per_unit" ||
    price.transform_quantity ||
    (campPaymentMode() === "live" && price.tax_behavior !== "inclusive")
  )
    throw new HttpError(
      400,
      "Aktiver einmaliger Camp-Preis in EUR mit passendem Stripe-Produkt erforderlich.",
    );
  const promotion_ids = await verifiedCampCodes(stripe, product.id, codes);
  return {
    stripe_price_id: price.id,
    stripe_product_id: product.id,
    stripe_payment_link_id: null,
    payment_url: null,
    amount: price.unit_amount,
    currency: price.currency,
    codes,
    livemode: price.livemode,
    promotion_ids,
  };
}
export async function createCampCheckout(
  offer: Offer,
  bookingId: string,
  email: string,
  percent: number,
  appUrl: string,
) {
  const codes = percent
    ? { [String(percent)]: offer.codes[String(percent)] }
    : {};
  const verified = await verifyCheckoutOffer(offer.stripe_price_id, codes);
  if (
    verified.amount !== offer.amount ||
    verified.stripe_product_id !== offer.stripe_product_id ||
    verified.currency !== offer.currency
  )
    throw new HttpError(
      409,
      "Der Camppreis wurde geändert. Bitte erneut versuchen.",
    );
  const session = await campStripe().checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: bookingId,
      metadata: {
        camp_id: offer.camp_id,
        camp_offer_id: offer.id,
        camp_booking_id: bookingId,
      },
      line_items: [{ price: offer.stripe_price_id, quantity: 1 }],
      ...(percent
        ? {
            discounts: [
              { promotion_code: verified.promotion_ids[String(percent)] },
            ],
          }
        : {}),
      customer_creation: "always",
      customer_email: email,
      payment_method_types: ["card"],
      locale: "de",
      automatic_tax: { enabled: campPaymentMode() === "live" },
      expires_at: Math.floor(Date.now() / 1000) + 1800,
      success_url: `${appUrl}/camp/erfolg?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/camp/buchung/${offer.camp_id}`,
    },
    { idempotencyKey: `camp-booking:${bookingId}` },
  );
  if (!session.url || session.livemode !== (campPaymentMode() === "live"))
    throw new HttpError(
      502,
      "Stripe-Checkout konnte nicht eingerichtet werden.",
    );
  return session;
}
async function remember(kind: string, id: string, campId: string) {
  if (campPaymentMode() === "live") return;
  const r = await serviceDb()
    .from("camp_stripe_assets")
    .upsert({ kind, id, camp_id: campId });
  if (r.error)
    throw new Error(
      "Stripe-Testobjekt angelegt, Registrierung fehlgeschlagen. Einrichtung erneut versuchen.",
    );
}
export async function createCampOffer(
  campId: string,
  title: string,
  kind: string,
  amount: number,
  appUrl: string,
  sharedProductId?: string,
) {
  const stripe = campStripe();
  const mode = campPaymentMode();
  const metadata = { camp_id: campId, camp_payment_mode: mode };
  const prefix = `camp-v3-${mode}:${campId}:${kind}:${amount}`;
  const productId =
    sharedProductId ??
    (
      await stripe.products.create(
        { name: title, metadata },
        { idempotencyKey: `camp-v3-${mode}:${campId}:product` },
      )
    ).id;
  if (!sharedProductId) await remember("product", productId, campId);
  const price = await stripe.prices.create(
    {
      product: productId,
      unit_amount: amount,
      currency: "eur",
      tax_behavior: "inclusive",
      metadata,
    },
    { idempotencyKey: prefix + ":price" },
  );
  await remember("price", price.id, campId);
  const codes: Record<string, string> = {};
  for (const percent of [10, 15, 20]) {
    const coupon = await stripe.coupons.create(
      {
        percent_off: percent,
        duration: "once",
        applies_to: { products: [productId] },
        metadata,
      },
      { idempotencyKey: prefix + `:coupon:${percent}` },
    );
    await remember("coupon", coupon.id, campId);
    const code = `C3${campId.replaceAll("-", "").slice(0, 12)}${kind === "early" ? "E" : "N"}${amount}R${percent}`;
    const promo = await stripe.promotionCodes.create(
      {
        coupon: coupon.id,
        code,
        metadata,
      },
      { idempotencyKey: prefix + `:promo:${percent}` },
    );
    await remember("promotion", promo.id, campId);
    codes[String(percent)] = promo.code;
  }
  return {
    stripe_price_id: price.id,
    stripe_product_id: productId,
    stripe_payment_link_id: null,
    payment_url: null,
    amount,
    currency: "eur",
    codes,
    livemode: price.livemode,
  };
}
export function checkoutUrl(offer: Offer, bookingId: string, email: string) {
  if (!offer.payment_url)
    throw new HttpError(
      400,
      "Dieses Camp verwendet einen persönlichen Checkout.",
    );
  const url = new URL(offer.payment_url);
  if (url.protocol !== "https:" || url.hostname !== "buy.stripe.com")
    throw new HttpError(400, "Unzulässiger Zahlungslink.");
  url.searchParams.set("client_reference_id", bookingId);
  url.searchParams.set("locked_prefilled_email", email);
  url.searchParams.set("locale", "de");
  return url.href;
}
