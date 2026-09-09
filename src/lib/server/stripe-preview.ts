import "server-only";
import type Stripe from "stripe";

// Keep the product cache within one admin request, shared across its customers.
export function subscriptionPreviewLoader(
  stripe: Pick<Stripe, "subscriptions" | "products">,
) {
  const names = new Map<string, Promise<string>>();
  function productName(product: Stripe.Price["product"]): Promise<string> {
    if (typeof product !== "string")
      return Promise.resolve(product.deleted ? product.id : product.name);
    let name = names.get(product);
    if (!name) {
      name = stripe.products
        .retrieve(product)
        .then((result) => (result.deleted ? result.id : result.name));
      names.set(product, name);
    }
    return name;
  }
  return async (customer: string) => {
    // Expanding data.items.data.price.product exceeds Stripe's depth limit.
    const subscriptions = await stripe.subscriptions.list({
      customer,
      status: "all",
      limit: 100,
    });
    return Promise.all(
      subscriptions.data.map(async (subscription) => ({
        id: subscription.id,
        status: subscription.status,
        items: await Promise.all(
          subscription.items.data.map(async (item) => ({
            id: item.id,
            price: item.price.id,
            product: await productName(item.price.product),
            amount: item.price.unit_amount,
            currency: item.price.currency,
          })),
        ),
      })),
    );
  };
}
