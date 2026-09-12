export function sameFamilyContact(
  parent: { full_name: string; contact_email: string },
  customer: { name?: string | null; email?: string | null },
) {
  const name = (value: string) =>
    value.trim().replace(/\s+/g, " ").toLowerCase();
  const email = (value: string) => value.trim().toLowerCase();
  return (
    Boolean(customer.name?.trim() && customer.email?.trim()) &&
    name(parent.full_name) === name(customer.name!) &&
    email(parent.contact_email) === email(customer.email!)
  );
}

// A caller-supplied ID is never enough to open a Stripe billing session.
export function selectBillingCustomer(allowed: string[], requested?: string) {
  const ids = [...new Set(allowed)];
  if (requested) return ids.includes(requested) ? requested : null;
  return ids.length === 1 ? ids[0] : null;
}

export function subscriptionLinkIssue(
  subscription: {
    customer: string | { id: string };
    items: { data: { id: string; quantity?: number }[] };
  },
  input: { customer_id: string; item_id: string },
) {
  const customer =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const item = subscription.items.data.find((i) => i.id === input.item_id);
  if (customer !== input.customer_id || !item)
    return "Stripe-Kunde oder Abonnement-Item stimmt nicht überein.";
  if (item.quantity !== 1)
    return "Abo-Menge ist nicht 1. Bitte zuerst die Zuordnung und das Kontingent klären.";
  return null;
}
