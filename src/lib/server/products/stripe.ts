import "server-only";
import Stripe from "stripe";
import { priceSchema, type Product } from "@/lib/products/domain";
import { HttpError } from "../security";
import { requireProducts, productLiveMode } from "./runtime";
export function productStripeKey() {
  return (
    process.env.PRODUCT_STRIPE_SECRET_KEY ||
    (productLiveMode() ? process.env.STRIPE_SECRET_KEY : "") ||
    ""
  );
}
export function productStripe() {
  requireProducts();
  const key = productStripeKey();
  if (!(productLiveMode() ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/).test(key))
    throw new HttpError(
      503,
      "Ein passender Stripe-Schlüssel für diese Umgebung fehlt.",
    );
  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 10000,
    maxNetworkRetries: 2,
  });
}
export async function validateProductPrice(
  id: string,
  kind: Product["kind"],
  expectedProduct?: string,
) {
  if (!/^price_[A-Za-z0-9_]+$/.test(id))
    throw new HttpError(400, "Ungültige Stripe Price-ID.");
  const stripe = productStripe();
  let price: Stripe.Price;
  try {
    price = await stripe.prices.retrieve(id, { expand: ["product"] });
  } catch {
    throw new HttpError(400, "Stripe-Preis wurde nicht gefunden.");
  }
  const product =
    typeof price.product === "object"
      ? price.product
      : await stripe.products.retrieve(price.product);
  if (
    product.deleted ||
    product.livemode !== productLiveMode() ||
    !product.active ||
    price.livemode !== productLiveMode() ||
    !price.active ||
    !price.unit_amount ||
    price.unit_amount <= 0 ||
    price.billing_scheme !== "per_unit" ||
    price.transform_quantity ||
    (expectedProduct && product.id !== expectedProduct)
  )
    throw new HttpError(
      400,
      "Aktiver Stripe-Preis mit passendem Produkt und festem Betrag erforderlich.",
    );
  if (
    kind === "subscription"
      ? price.type !== "recurring" ||
        !price.recurring ||
        !["month", "year"].includes(price.recurring.interval) ||
        price.recurring.interval_count !== 1 ||
        price.recurring.usage_type !== "licensed"
      : price.type !== "one_time"
  )
    throw new HttpError(
      400,
      "Preisart oder Abrechnungsintervall passt nicht zum Produkt.",
    );
  if (kind === "camp" && price.currency !== "eur")
    throw new HttpError(400, "Camps benötigen einen einmaligen EUR-Preis.");
  return priceSchema.parse({
    id: price.id,
    product_id: product.id,
    amount: price.unit_amount,
    currency: price.currency,
    interval: price.recurring?.interval ?? null,
    interval_count: 1,
    livemode: price.livemode,
    checked_at: new Date().toISOString(),
    product_name: product.name,
    source: "stripe",
  });
}
export async function verifyStoredPrice(p: Product) {
  if (p.price?.source === "fixture")
    throw new HttpError(
      400,
      "Dieser Preis ist ein lokales Beispiel. Bitte eine echte Stripe-Price-ID prüfen.",
    );
  if (!p.price)
    throw new HttpError(400, "Bitte zuerst einen Stripe-Preis prüfen.");
  const actual = await validateProductPrice(
    p.price.id,
    p.kind,
    p.price.product_id,
  );
  if (
    actual.amount !== p.price.amount ||
    actual.currency !== p.price.currency ||
    actual.interval !== p.price.interval ||
    actual.livemode !== p.price.livemode
  )
    throw new HttpError(
      409,
      "Der Stripe-Preis hat sich geändert. Bitte neu prüfen und speichern.",
    );
  return actual;
}
