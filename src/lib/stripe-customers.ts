export type CustomerSort =
  "stripe" | "name-asc" | "name-desc" | "added-desc" | "added-asc";
export interface RegistryCustomer {
  id: string;
  name: string | null;
  email: string | null;
  first_seen_at: string;
  assigned: boolean;
  has_active_subscription?: boolean;
  stripe_position?: number;
  stripe_created_at?: string;
}
export interface StripeCustomerOrder {
  id: string;
  created: number;
}

/** Preserve Stripe's complete page order, including creation-time ties. */
export function withStripeOrder<T extends RegistryCustomer>(
  rows: T[],
  customers: StripeCustomerOrder[],
) {
  const positions = new Map<
    string,
    { stripe_position: number; stripe_created_at: string }
  >();
  for (const [index, customer] of customers.entries()) {
    if (!positions.has(customer.id))
      positions.set(customer.id, {
        stripe_position: index,
        stripe_created_at: new Date(customer.created * 1000).toISOString(),
      });
  }
  const ids = new Set(rows.map((row) => row.id));
  if ([...positions.keys()].some((id) => !ids.has(id)))
    throw new Error("Kundenliste unvollständig. Bitte erneut laden.");
  // Keep historical registry entries that are no longer returned by Stripe.
  return rows.map((row) => ({ ...row, ...positions.get(row.id) }));
}

export function filterCustomers<T extends RegistryCustomer>(
  customers: T[],
  query: string,
  sort: CustomerSort,
  recent: boolean,
  now = Date.now(),
  activeOnly = false,
): T[] {
  const term = query.trim().toLocaleLowerCase("de");
  return customers
    .filter(
      (c) =>
        `${c.name ?? ""} ${c.email ?? ""} ${c.id}`
          .toLocaleLowerCase("de")
          .includes(term) &&
        (!recent || Date.parse(c.first_seen_at) >= now - 14 * 86400000) &&
        (!activeOnly || c.has_active_subscription === true),
    )
    .sort((a, b) => {
      if (sort === "stripe")
        return (
          (a.stripe_position ?? Number.MAX_SAFE_INTEGER) -
            (b.stripe_position ?? Number.MAX_SAFE_INTEGER) ||
          a.id.localeCompare(b.id)
        );
      const value = sort.startsWith("name")
        ? (a.name ?? a.email ?? a.id).localeCompare(
            b.name ?? b.email ?? b.id,
            "de",
            { sensitivity: "base" },
          )
        : a.first_seen_at.localeCompare(b.first_seen_at);
      return (
        (sort.endsWith("desc") ? -value : value) || a.id.localeCompare(b.id)
      );
    });
}
