import "server-only";
import type Stripe from "stripe";

export async function stripeCustomerPage(
  stripe: Pick<Stripe, "customers">,
  query = "",
  cursor?: string,
) {
  const term = query.trim();
  if (term) {
    // Keep user input inside a quoted value, including quotes and backslashes.
    const value = term.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const page = await stripe.customers.search({
      query: `name~"${value}" OR email~"${value}"`,
      limit: 25,
      ...(cursor ? { page: cursor } : {}),
    });
    return {
      data: page.data,
      has_more: page.has_more,
      next_cursor: page.next_page ?? null,
    };
  }
  const page = await stripe.customers.list({
    limit: 25,
    ...(cursor ? { starting_after: cursor } : {}),
  });
  return {
    data: page.data,
    has_more: page.has_more,
    next_cursor: page.has_more ? (page.data.at(-1)?.id ?? null) : null,
  };
}

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
