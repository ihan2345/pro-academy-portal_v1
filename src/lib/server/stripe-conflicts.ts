import "server-only";
import type Stripe from "stripe";
import type { ProfileSession } from "./parent-profile";
import type { StripeBillingConflictPage } from "../stripe-conflicts";
import { assertRole, HttpError } from "./security";
import { profileStripeClient } from "./profile-stripe";
import { serviceDb } from "./service-db";
import { collectRows } from "./pai/analytics";

const restricted = new Set(["past_due", "unpaid", "incomplete", "paused"]);
const id = (v: any): string | null =>
  typeof v === "string" ? v : (v?.id ?? null);
const invoiceSubscription = (i: any) =>
  id(i.parent?.subscription_details?.subscription) ?? id(i.subscription);

/** Current Stripe state, not historical failure events. This endpoint never writes. */
export async function stripeBillingConflicts(
  session: ProfileSession,
): Promise<StripeBillingConflictPage> {
  assertRole(session.role, "admin");
  const started = Date.now();
  const stripe = profileStripeClient();
  async function pages<T extends { id?: string }>(
    fetch: (after?: string) => PromiseLike<{ data: T[]; has_more: boolean }>,
  ) {
    const rows: T[] = [];
    let after: string | undefined;
    for (let page = 0; page < 40 && Date.now() - started < 25000; page++) {
      const r = await fetch(after);
      if (r.data.some((row) => !row.id))
        throw new HttpError(
          503,
          "Unvollständige Stripe-Antwort. Bitte erneut prüfen.",
        );
      rows.push(...r.data);
      if (!r.has_more) return rows;
      const next = r.data.at(-1)?.id;
      if (!next || next === after) break;
      after = next;
    }
    throw new HttpError(
      503,
      "Stripe-Konflikte nicht vollständig abrufbar. Bitte erneut prüfen.",
    );
  }
  let subscriptions: Stripe.Subscription[], invoices: Stripe.Invoice[];
  const options = { timeout: 6000, maxNetworkRetries: 0 };
  try {
    [subscriptions, invoices] = await Promise.all([
      pages<Stripe.Subscription>((after) =>
        stripe.subscriptions.list(
          {
            status: "all",
            limit: 100,
            ...(after ? { starting_after: after } : {}),
          },
          options,
        ),
      ),
      pages<Stripe.Invoice>((after) =>
        stripe.invoices.list(
          {
            status: "open",
            limit: 100,
            ...(after ? { starting_after: after } : {}),
          },
          options,
        ),
      ),
    ]);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      503,
      "Aktueller Zahlungs- und Abo-Status bei Stripe nicht verfügbar. Bitte erneut prüfen.",
    );
  }
  const subs = new Map(subscriptions.map((s) => [s.id, s]));
  const openInvoices = invoices.filter((i) => {
    const sub = invoiceSubscription(i);
    return (
      sub &&
      i.status === "open" &&
      i.amount_remaining > 0 &&
      (i.attempted ||
        i.attempt_count > 0 ||
        (i.due_date && i.due_date * 1000 < started) ||
        restricted.has(subs.get(sub)?.status ?? ""))
    );
  });
  const invoiceSubs = new Set(openInvoices.map(invoiceSubscription));
  if (openInvoices.some((i) => !subs.has(invoiceSubscription(i)!)))
    throw new HttpError(
      503,
      "Stripe-Daten haben sich geändert. Bitte erneut prüfen.",
    );
  const candidates = [...subs.values()].filter(
    (s) =>
      restricted.has(s.status) ||
      invoiceSubs.has(s.id) ||
      (s.status === "canceled" &&
        s.cancellation_details?.reason === "payment_failed"),
  );
  if (!candidates.length)
    return { rows: [], checkedAt: new Date(started).toISOString() };
  const db = serviceDb();
  async function matching(
    table: string,
    columns: string,
    key: string,
    values: string[],
    filter: (q: any) => any = (q) => q,
  ) {
    const result: any[] = [];
    for (let n = 0; n < values.length; n += 100)
      result.push(
        ...(await collectRows(() =>
          filter(
            db
              .from(table)
              .select(columns)
              .in(key, values.slice(n, n + 100)),
          ),
        )),
      );
    return result;
  }
  const customerIds = [
    ...new Set(candidates.map((s) => id(s.customer)).filter(Boolean)),
  ] as string[];
  const [localSubs, customers] = await Promise.all([
    matching(
      "subscriptions",
      "id,stripe_subscription_id",
      "stripe_subscription_id",
      candidates.map((s) => s.id),
    ),
    matching("stripe_customer_registry", "id,name", "id", customerIds),
  ]);
  const localIds = localSubs.map((s) => s.id);
  const [mappings, periods] = await Promise.all([
    matching(
      "subscription_players",
      "id,subscription_id,player_id,players(id,first_name,last_name,archived_at)",
      "subscription_id",
      localIds,
    ),
    matching(
      "entitlement_periods",
      "id,subscription_id,player_id,status",
      "subscription_id",
      localIds,
      (q) =>
        q
          .lte("starts_at", new Date(started).toISOString())
          .gt("ends_at", new Date(started).toISOString()),
    ),
  ]);
  const activeAlternatives = await matching(
    "entitlement_periods",
    "id,player_id,subscription_id,subscriptions!inner(stripe_subscription_id)",
    "player_id",
    [...new Set(mappings.map((m) => m.player_id))],
    (q) =>
      q
        .eq("status", "active")
        .lte("starts_at", new Date(started).toISOString())
        .gt("ends_at", new Date(started).toISOString()),
  );
  return {
    checkedAt: new Date(started).toISOString(),
    rows: candidates.flatMap((s) => {
      const ownInvoices = openInvoices.filter(
        (i) => invoiceSubscription(i) === s.id,
      );
      const local = localSubs.find((v) => v.stripe_subscription_id === s.id);
      const children = mappings
        .filter(
          (m) =>
            m.subscription_id === local?.id &&
            m.players &&
            !m.players.archived_at,
        )
        .map((m) => ({
          id: m.player_id,
          name: `${m.players.first_name} ${m.players.last_name}`,
        }));
      const suspended = periods.some(
        (p) =>
          p.subscription_id === local?.id &&
          p.status === "suspended" &&
          children.some((c) => c.id === p.player_id) &&
          !activeAlternatives.some(
            (other) =>
              other.player_id === p.player_id &&
              other.subscription_id !== local?.id &&
              ["active", "trialing"].includes(
                subs.get(other.subscriptions?.stripe_subscription_id)?.status ??
                  "",
              ),
          ),
      );
      if (!ownInvoices.length && !restricted.has(s.status) && !suspended)
        return [];
      const prefix = s.livemode
        ? "https://dashboard.stripe.com/"
        : "https://dashboard.stripe.com/test/";
      const customerId = id(s.customer)!;
      return [
        {
          id: s.id,
          subscriptionId: s.id,
          customerId,
          customer:
            customers.find((c) => c.id === customerId)?.name ||
            ownInvoices.find((i) => i.customer_name)?.customer_name ||
            customerId,
          status: s.status,
          reason:
            s.status === "canceled" &&
            s.cancellation_details?.reason === "payment_failed"
              ? "Abo wegen fehlgeschlagener Zahlung beendet"
              : s.status === "past_due"
                ? "Abo-Zahlung überfällig"
                : s.status === "unpaid"
                  ? "Abo wegen offener Zahlung gesperrt"
                  : s.status === "paused"
                    ? "Abo bei Stripe pausiert"
                    : s.status === "incomplete"
                      ? "Erste Abo-Zahlung ausstehend"
                      : ownInvoices.some(
                            (i) => i.attempt_count > 0 || i.attempted,
                          )
                        ? "Abo-Zahlung fehlgeschlagen"
                        : "Abo-Rechnung überfällig",
          blocked: suspended || restricted.has(s.status),
          children: [...new Map(children.map((c) => [c.id, c])).values()],
          invoices: ownInvoices.map((i) => ({
            id: i.id!,
            number: i.number,
            remaining: i.amount_remaining,
            currency: i.currency,
            href: `${prefix}invoices/${encodeURIComponent(i.id!)}`,
          })),
          href: `${prefix}subscriptions/${encodeURIComponent(s.id)}`,
        },
      ];
    }),
  };
}
