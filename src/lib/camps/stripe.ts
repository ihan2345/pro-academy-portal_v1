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
  return new Stripe(key, { maxNetworkRetries: 2 });
}
export async function verifyOffer(
  priceId: string,
  linkId: string,
  codes: Record<string, string>,
) {
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
  if (!link.allow_promotion_codes || link.customer_creation !== "always")
    throw new HttpError(
      400,
      "Im Zahlungslink müssen Rabattcodes und Kundenerstellung aktiviert sein.",
    );
  const productId =
    typeof price.product === "string" ? price.product : price.product.id;
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
    if (
      !promo ||
      promo.coupon.percent_off !== Number(percent) ||
      !promo.coupon.valid ||
      (promo.coupon.applies_to?.products &&
        !promo.coupon.applies_to.products.includes(productId))
    )
      throw new HttpError(
        400,
        `Rabattcode für ${percent} % passt nicht zum Stripe-Produkt.`,
      );
  }
  // Raw GET retains adjustable_quantity, which Stripe's line-item list does not expose.
  const raw = await fetch(
    `https://api.stripe.com/v1/payment_links/${encodeURIComponent(linkId)}?expand[]=line_items`,
    {
      headers: {
        Authorization: `Bearer ${process.env.CAMP_STRIPE_SECRET_KEY}`,
      },
      cache: "no-store",
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
) {
  const stripe = campStripe();
  const mode = campPaymentMode();
  const metadata = { camp_id: campId, camp_payment_mode: mode };
  const prefix = `camp-${mode}:${campId}:${kind}:${amount}`;
  const product = await stripe.products.create(
    {
      name: `${title}${kind === "early" ? " · Frühbucher" : ""}`,
      metadata,
    },
    { idempotencyKey: prefix + ":product" },
  );
  await remember("product", product.id, campId);
  const price = await stripe.prices.create(
    {
      product: product.id,
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
        applies_to: { products: [product.id] },
        metadata,
      },
      { idempotencyKey: prefix + `:coupon:${percent}` },
    );
    await remember("coupon", coupon.id, campId);
    const code = `C${campId.replaceAll("-", "").slice(0, 12)}${kind === "early" ? "E" : "N"}${amount}R${percent}`;
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
  const link = await stripe.paymentLinks.create(
    {
      line_items: [
        {
          price: price.id,
          quantity: 1,
          adjustable_quantity: { enabled: false },
        },
      ],
      automatic_tax: { enabled: mode === "live" },
      allow_promotion_codes: true,
      customer_creation: "always",
      payment_method_types: ["card"],
      metadata,
      after_completion: {
        type: "redirect",
        redirect: {
          url: `${appUrl}/camp/erfolg?session_id={CHECKOUT_SESSION_ID}`,
        },
      },
    },
    { idempotencyKey: prefix + ":link" },
  );
  await remember("payment_link", link.id, campId);
  return {
    stripe_price_id: price.id,
    stripe_product_id: product.id,
    stripe_payment_link_id: link.id,
    payment_url: link.url,
    amount,
    currency: "eur",
    codes,
    livemode: price.livemode,
  };
}
export function checkoutUrl(offer: Offer, bookingId: string, email: string) {
  const url = new URL(offer.payment_url);
  if (url.protocol !== "https:" || url.hostname !== "buy.stripe.com")
    throw new HttpError(400, "Unzulässiger Zahlungslink.");
  url.searchParams.set("client_reference_id", bookingId);
  url.searchParams.set("locked_prefilled_email", email);
  url.searchParams.set("locale", "de");
  return url.href;
}
