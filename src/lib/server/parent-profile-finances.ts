import "server-only";
import type Stripe from "stripe";
import { profileStripeClient } from "./profile-stripe";
import { serviceDb } from "./service-db";
import { authorizeProfile, type ProfileSession } from "./parent-profile";
import { HttpError } from "./security";
import { calendarDate } from "../calendar";

export interface ProfileFinances {
  checked_at: string;
  complete: boolean;
  notes: string[];
  currencies: {
    currency: string;
    all: { total: number; subscriptions: number | null };
    month: { total: number; subscriptions: number | null };
  }[];
}
const id = (v: string | { id: string } | null | undefined) =>
  typeof v === "string" ? v : v?.id;
/** Read-only totals from the Stripe account owning the verified customer mapping. */
export async function readProfileFinances(
  s: ProfileSession,
  target: string,
): Promise<ProfileFinances> {
  if (s.role !== "admin")
    throw new HttpError(403, "Finanzdaten sind nur für Admins verfügbar.");
  const parent = await authorizeProfile(s, target),
    db = serviceDb();
  const linked = await db
    .from("parent_stripe_customers")
    .select("stripe_customer_id")
    .eq("parent_id", parent.id);
  if (linked.error)
    throw new HttpError(503, "Stripe-Zuordnung nicht verfügbar.");
  const customerIds = [
    ...new Set((linked.data ?? []).map((c) => c.stripe_customer_id as string)),
  ];
  if (!customerIds.length)
    return {
      checked_at: new Date().toISOString(),
      complete: false,
      notes: ["Keine Stripe-Kundenzuordnung vorhanden."],
      currencies: [],
    };
  if (customerIds.length > 10)
    throw new HttpError(
      503,
      "Zu viele Kundenkonten für einen einzelnen Abruf.",
    );
  const other = await db
    .from("parent_stripe_customers")
    .select("parent_id")
    .in("stripe_customer_id", customerIds)
    .neq("parent_id", parent.id)
    .limit(1);
  if (other.error || other.data?.length)
    throw new HttpError(
      409,
      "Stripe-Kundenzuordnung ist nicht eindeutig. Finanzwerte können nicht sicher berechnet werden.",
    );
  // Charges include subscriptions and camp purchases for each mapped customer.
  // Different restricted keys are permissions, not additional payment sources.
  const clients = [profileStripeClient()];
  const start = Date.now(),
    now = new Date().toISOString(),
    month = calendarDate(now).slice(0, 7);
  let requests = 0;
  const options = () => {
    if (++requests > 50 || Date.now() - start > 20000)
      throw new HttpError(
        503,
        "Finanzhistorie nicht vollständig abrufbar. Bitte später erneut versuchen; es wird keine Teilsumme angezeigt.",
      );
    return { timeout: 6000, maxNetworkRetries: 0 };
  };
  async function pages<T extends { id?: string }>(
    fetch: (after?: string) => PromiseLike<{ data: T[]; has_more: boolean }>,
  ) {
    const all: T[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await fetch(after);
      all.push(...page.data);
      if (!page.has_more) return all;
      const next = page.data.at(-1)?.id;
      if (!next || next === after)
        throw new HttpError(503, "Unvollständige Stripeantwort.");
      after = next;
    }
  }
  const sums = new Map<
    string,
    {
      currency: string;
      all: { total: number; subscriptions: number | null };
      month: { total: number; subscriptions: number | null };
    }
  >();
  const notes = new Set<string>(),
    found = new Set<string>();
  let complete = true;
  for (const stripe of clients) {
    for (const customer of customerIds) {
      try {
        await stripe.customers.retrieve(customer, options());
      } catch (e) {
        if ((e as { code?: string }).code === "resource_missing") continue;
        throw e;
      }
      found.add(customer);
      const charges = await pages<Stripe.Charge>((after) =>
        stripe.charges.list(
          {
            customer,
            limit: 100,
            expand: ["data.balance_transaction"],
            ...(after ? { starting_after: after } : {}),
          },
          options(),
        ),
      );
      const invoices = await pages<Stripe.Invoice>((after) =>
        stripe.invoices.list(
          {
            customer,
            status: "paid",
            limit: 100,
            expand: ["data.payments"],
            ...(after ? { starting_after: after } : {}),
          },
          options(),
        ),
      );
      const abo = new Map<string, number>(),
        ambiguous = new Set<string>();
      let unmappedSubscription = false;
      for (const inv of invoices) {
        if (!inv.parent?.subscription_details?.subscription) continue;
        let payments = inv.payments?.data;
        if (!payments || inv.payments?.has_more)
          payments = await pages<Stripe.InvoicePayment>((after) =>
            stripe.invoicePayments.list(
              {
                invoice: inv.id,
                status: "paid",
                limit: 100,
                ...(after ? { starting_after: after } : {}),
              },
              options(),
            ),
          );
        if (!payments.some((p) => p.status === "paid") && inv.amount_paid > 0)
          unmappedSubscription = true;
        // Mixed/manual invoice lines cannot safely be assigned wholly to subscription spend.
        const pure =
          !inv.lines.has_more &&
          inv.lines.data.length > 0 &&
          inv.lines.data.every((l) => !!l.parent?.subscription_item_details);
        for (const p of payments)
          if (p.status === "paid") {
            const key = id(p.payment.payment_intent) ?? id(p.payment.charge);
            if (key) {
              if (pure && p.amount_paid != null)
                abo.set(key, (abo.get(key) ?? 0) + p.amount_paid);
              else ambiguous.add(key);
            }
          }
      }
      for (const c of charges) {
        if (c.status !== "succeeded" || !c.paid || !c.captured) continue;
        const key = id(c.payment_intent) ?? c.id;
        const row = sums.get(c.currency) ?? {
          currency: c.currency,
          all: { total: 0, subscriptions: 0 },
          month: { total: 0, subscriptions: 0 },
        };
        sums.set(c.currency, row);
        const balance = c.balance_transaction;
        const paidAt =
          balance && typeof balance !== "string" ? balance.created : null;
        if (!paidAt) {
          complete = false;
          notes.add(
            "Bei mindestens einer Zahlung fehlt der bestätigte Buchungszeitpunkt.",
          );
        }
        if (c.disputed) {
          complete = false;
          notes.add(
            "Eine Rückbelastung benötigt Prüfung; Werte sind vorläufig.",
          );
        }
        const subscription = abo.get(key) === c.amount_captured;
        if (abo.has(key) && !subscription) ambiguous.add(key);
        if (unmappedSubscription || ambiguous.has(key)) {
          row.all.subscriptions = null;
          row.month.subscriptions = null;
          notes.add(
            "Aboanteile gemischter Rechnungen sind nicht eindeutig; Aboausgaben werden nicht geschätzt.",
          );
        }
        row.all.total += c.amount_captured;
        if (subscription && row.all.subscriptions !== null)
          row.all.subscriptions += c.amount_captured;
        if (paidAt && calendarDate(new Date(paidAt * 1000)).startsWith(month)) {
          row.month.total += c.amount_captured;
          if (subscription && row.month.subscriptions !== null)
            row.month.subscriptions += c.amount_captured;
        }
        if (c.amount_refunded) {
          const refunds = await pages<Stripe.Refund>((after) =>
            stripe.refunds.list(
              {
                charge: c.id,
                limit: 100,
                ...(after ? { starting_after: after } : {}),
              },
              options(),
            ),
          );
          const success = refunds.filter((r) => r.status === "succeeded");
          if (success.reduce((n, r) => n + r.amount, 0) !== c.amount_refunded) {
            complete = false;
            notes.add("Erstattungsstand noch nicht vollständig bestätigt.");
          }
          for (const r of success) {
            row.all.total -= r.amount;
            if (subscription && row.all.subscriptions !== null)
              row.all.subscriptions -= r.amount;
            if (calendarDate(new Date(r.created * 1000)).startsWith(month)) {
              row.month.total -= r.amount;
              if (subscription && row.month.subscriptions !== null)
                row.month.subscriptions -= r.amount;
            }
          }
        }
      }
      // Some paid invoices use customer credit or out-of-band settlement instead of charges.
      // These are deliberately not represented as newly collected Stripe money.
    }
  }
  if (found.size !== customerIds.length) {
    complete = false;
    notes.add("Nicht alle zugeordneten Stripe-Konten konnten gefunden werden.");
  }
  return {
    checked_at: now,
    complete,
    notes: [...notes],
    currencies: [...sums.values()],
  };
}
