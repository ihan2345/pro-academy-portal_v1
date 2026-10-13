import "server-only";
import type Stripe from "stripe";
import { profileStripeClient } from "./profile-stripe";
import { HttpError } from "./security";

export interface RevenueLink {
  parent_id: string;
  stripe_customer_id: string;
}

/** EUR collected through Stripe, after refunds, once per charge/customer. */
export function parentRevenue(
  parents: string[],
  links: RevenueLink[],
  charges: Stripe.Charge[],
) {
  const owners = new Map<string, Set<string>>();
  for (const link of links) {
    const ids = owners.get(link.stripe_customer_id) ?? new Set<string>();
    ids.add(link.parent_id);
    owners.set(link.stripe_customer_id, ids);
  }
  const totals = new Map<string, number | null>(parents.map((p) => [p, null]));
  for (const p of parents) {
    const customers = links.filter((l) => l.parent_id === p);
    if (
      customers.length &&
      customers.every((l) => owners.get(l.stripe_customer_id)?.size === 1)
    )
      totals.set(p, 0);
  }
  const seen = new Set<string>();
  for (const charge of charges) {
    if (seen.has(charge.id)) continue;
    seen.add(charge.id);
    const customer =
      typeof charge.customer === "string"
        ? charge.customer
        : charge.customer?.id;
    const mapped = customer ? owners.get(customer) : undefined;
    if (
      mapped?.size !== 1 ||
      charge.status !== "succeeded" ||
      !charge.paid ||
      !charge.captured
    )
      continue;
    const parent = [...mapped][0];
    if (!totals.has(parent) || totals.get(parent) === null) continue;
    if (charge.currency !== "eur" || charge.disputed) {
      totals.set(parent, null);
      continue;
    }
    totals.set(
      parent,
      totals.get(parent)! + charge.amount_captured - charge.amount_refunded,
    );
  }
  return totals;
}

export async function readParentRevenue(
  role: string | undefined,
  parents: string[],
  links: RevenueLink[],
) {
  if (role !== "admin")
    throw new HttpError(403, "Finanzdaten sind nur für Admins verfügbar.");
  const customers = [
    ...new Set(
      links
        .filter((l) => parents.includes(l.parent_id))
        .map((l) => l.stripe_customer_id),
    ),
  ];
  if (!customers.length) return parentRevenue(parents, links, []);
  const stripe = profileStripeClient();
  const charges: Stripe.Charge[] = [];
  const started = Date.now();
  const unavailable = new Set<string>();
  let cursor = 0,
    requests = 0,
    failure: unknown;
  const incomplete = () =>
    new HttpError(
      503,
      "Umsatzhistorie nicht vollständig abrufbar. Es wird keine unvollständige Rangliste angezeigt.",
    );
  async function readCustomer(customer: string) {
    let after: string | undefined;
    for (let page = 0; page < 50; page++) {
      if (++requests > 1000 || Date.now() - started >= 30000)
        throw incomplete();
      const result = await stripe.charges.list(
        { customer, limit: 100, ...(after ? { starting_after: after } : {}) },
        { timeout: 6000, maxNetworkRetries: 0 },
      );
      charges.push(...result.data);
      if (!result.has_more) return;
      const next = result.data.at(-1)?.id;
      if (!next || next === after) break;
      after = next;
    }
    throw incomplete();
  }
  await Promise.all(
    Array.from({ length: Math.min(6, customers.length) }, async () => {
      while (!failure && cursor < customers.length) {
        const customer = customers[cursor++];
        try {
          await readCustomer(customer);
        } catch (e) {
          if ((e as { code?: string }).code === "resource_missing")
            unavailable.add(customer);
          else failure = e;
        }
      }
    }),
  );
  if (failure) throw incomplete();
  const totals = parentRevenue(parents, links, charges);
  for (const link of links)
    if (unavailable.has(link.stripe_customer_id) && totals.has(link.parent_id))
      totals.set(link.parent_id, null);
  return totals;
}

export function compareRevenue(
  a: { id: string; full_name: string },
  b: { id: string; full_name: string },
  totals: Map<string, number | null>,
) {
  const av = totals.get(a.id) ?? null,
    bv = totals.get(b.id) ?? null;
  return (
    (av === null ? (bv === null ? 0 : 1) : bv === null ? -1 : bv - av) ||
    a.full_name.localeCompare(b.full_name, "de") ||
    a.id.localeCompare(b.id)
  );
}
