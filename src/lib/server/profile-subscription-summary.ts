import "server-only";
import type Stripe from "stripe";
import { serviceDb } from "./service-db";

export type ProfileSubscriptionSummary = {
  id: string;
  names: string[];
  status: string;
  ended_at: string | null;
  cancel_at: string | null;
  cancellation_reason: string | null;
};
export type ProfileSubscriptions = {
  complete: boolean;
  active: ProfileSubscriptionSummary[];
  previous: ProfileSubscriptionSummary | null;
};
const cancellationReasons: Record<string, string> = {
  cancellation_requested: "Vom Kunden gekündigt",
  payment_failed: "Zahlung fehlgeschlagen",
  payment_disputed: "Zahlung angefochten",
};
const feedback: Record<string, string> = {
  customer_service: "Kundenservice",
  low_quality: "Qualität",
  missing_features: "Fehlende Leistungen",
  other: "Sonstiger Grund",
  switched_service: "Anbieterwechsel",
  too_complex: "Zu kompliziert",
  too_expensive: "Zu teuer",
  unused: "Nicht genutzt",
};
const iso = (value?: number | null) =>
  value ? new Date(value * 1000).toISOString() : null;
/** Fresh, read-only status from the same verified Stripe customer accounts. */
export async function readProfileSubscriptions(
  stripe: Stripe,
  customers: string[],
  paidPeriods: Map<string, number>,
): Promise<ProfileSubscriptions> {
  try {
    const began = Date.now();
    let requests = 0;
    const options = () => {
      if (++requests > 20 || Date.now() - began > 12000)
        throw new Error("Abo-Status unvollständig");
      return { timeout: 5000, maxNetworkRetries: 0 };
    };
    const rows: Stripe.Subscription[] = [];
    for (const customer of customers) {
      let after: string | undefined;
      for (;;) {
        const page = await stripe.subscriptions.list(
          {
            customer,
            status: "all",
            limit: 100,
            ...(after ? { starting_after: after } : {}),
          },
          options(),
        );
        rows.push(...page.data);
        if (!page.has_more) break;
        const next = page.data.at(-1)?.id;
        if (!next || next === after)
          throw new Error("Abo-Status unvollständig");
        after = next;
      }
    }
    const unique = [...new Map(rows.map((s) => [s.id, s])).values()];
    const active = unique.filter((s) => s.status === "active");
    const previous = active.length
      ? undefined
      : unique
          .filter(
            (s) =>
              paidPeriods.has(s.id) &&
              !(
                s.trial_end &&
                s.trial_start &&
                s.start_date >= s.trial_start &&
                (paidPeriods.get(s.id) ?? 0) <= s.trial_end
              ),
          )
          .sort(
            (a, b) =>
              (b.ended_at ?? paidPeriods.get(b.id) ?? b.start_date) -
              (a.ended_at ?? paidPeriods.get(a.id) ?? a.start_date),
          )[0];
    const selected = [...active, ...(previous ? [previous] : [])];
    const prices = [
      ...new Set(selected.flatMap((s) => s.items.data.map((i) => i.price.id))),
    ];
    const plans = prices.length
      ? await serviceDb()
          .from("plans")
          .select("name,stripe_price_id")
          .in("stripe_price_id", prices)
      : { data: [], error: null };
    const planNames = new Map(
      (plans.data ?? []).map((p) => [p.stripe_price_id, p.name]),
    );
    const productNames = new Map<string, string>();
    const summaries = new Map<string, ProfileSubscriptionSummary>();
    for (const sub of selected) {
      if (sub.items.has_more) throw new Error("Abo-Positionen unvollständig");
      const names: string[] = [];
      for (const item of sub.items.data) {
        let name = planNames.get(item.price.id) ?? item.price.nickname;
        if (!name) {
          const product = item.price.product;
          if (typeof product === "object" && !product.deleted)
            name = product.name;
          else {
            const id = typeof product === "string" ? product : product.id;
            name = productNames.get(id);
            if (!name) {
              const found = await stripe.products.retrieve(id, options());
              if (found.deleted) name = "Ehemaliges Abo-Produkt";
              else name = found.name;
              productNames.set(id, name);
            }
          }
        }
        names.push(name);
      }
      const reason = sub.cancellation_details;
      const cancellation = [
        reason?.reason
          ? (cancellationReasons[reason.reason] ?? reason.reason)
          : "",
        reason?.feedback ? (feedback[reason.feedback] ?? reason.feedback) : "",
        reason?.comment?.trim(),
      ].filter(Boolean);
      summaries.set(sub.id, {
        id: sub.id,
        names: [...new Set(names)],
        status: sub.status,
        ended_at: iso(sub.ended_at),
        cancel_at: iso(
          sub.cancel_at ??
            (sub.cancel_at_period_end
              ? Math.max(...sub.items.data.map((i) => i.current_period_end))
              : null),
        ),
        cancellation_reason: cancellation.length
          ? cancellation.join(" · ")
          : null,
      });
    }
    return {
      complete: true,
      active: active.map((s) => summaries.get(s.id)!),
      previous: previous ? summaries.get(previous.id)! : null,
    };
  } catch {
    return { complete: false, active: [], previous: null };
  }
}
