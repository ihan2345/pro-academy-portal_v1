import "server-only";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import type { ProfileSession } from "../parent-profile";
import { profileStripeClient } from "../profile-stripe";
import { serviceDb } from "../service-db";
import { HttpError } from "../security";
import { checked } from "./service";
import { collectRows, reportWindow, scopedSubscriptions } from "./analytics";

export const billingSchema = z
  .object({
    report: z.enum(["payments", "unpaid", "ending_subscriptions"]),
    start: z.iso.date().nullable(),
    end: z.iso.date().nullable(),
  })
  .strict();
export async function billing(s: ProfileSession, raw: unknown) {
  const args = billingSchema.parse(raw);
  if (!["admin", "parent"].includes(s.role!))
    throw new HttpError(
      403,
      "Finanzdaten sind für diese Rolle nicht freigegeben.",
    );
  const parents = await collectRows(() => {
    let q = s.db.from("parents").select("id,full_name").is("archived_at", null);
    if (s.role === "parent") q = q.eq("auth_user_id", s.user.id);
    return q;
  });
  const parentIds = new Set(parents.map((p) => p.id));
  const links = (
    await collectRows(() =>
      s.db
        .from("parent_stripe_customers")
        .select("id,parent_id,stripe_customer_id"),
    )
  ).filter((l) => parentIds.has(l.parent_id));
  const customers = [
    ...new Set<string>(links.map((l) => l.stripe_customer_id)),
  ];
  if (!customers.length)
    return {
      available: false,
      reason:
        "Kein Zahlungskonto mit diesem Portalbereich verknüpft; keine Aussage über Zahlungen möglich.",
    };
  // A shared payment customer must never leak another family's invoices.
  if (s.role === "parent") {
    for (const customer of customers) {
      const owners = checked<any[] | null>(
        await serviceDb()
          .from("parent_stripe_customers")
          .select("parent_id")
          .eq("stripe_customer_id", customer),
      );
      if (owners.some((o) => !parentIds.has(o.parent_id)))
        throw new HttpError(
          403,
          "Zahlungskonto nicht eindeutig der eigenen Familie zugeordnet.",
        );
    }
  }
  const today = Temporal.Now.zonedDateTimeISO("Europe/Berlin").toPlainDate();
  const window =
    args.report === "ending_subscriptions"
      ? reportWindow(
          args.start ?? today.toString(),
          args.end ?? today.add({ days: 30 }).toString(),
        )
      : reportWindow(args.start, args.end);
  // Preserve the local isolation boundary; no accidental production Stripe reads.
  if (process.env.APP_MODE !== "production")
    return {
      available: false,
      reason:
        "Live-Zahlungen und Kündigungstermine sind in der isolierten lokalen pAi-Testumgebung nicht angebunden. Keine Werte schätzen.",
    };
  const stripe = profileStripeClient();
  const started = Date.now();
  let requests = 0;
  const rows: any[] = [];
  const customerSet = new Set(customers);
  const customerId = (value: any) =>
    typeof value === "string" ? value : value?.id;
  for (const customer of s.role === "parent" ? customers : [undefined]) {
    let after: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= 50 || ++requests > 100 || Date.now() - started > 25000)
        throw new HttpError(
          503,
          "Finanzdaten nicht vollständig abrufbar; keine Teilsumme berechnet.",
        );
      const params = {
        limit: 100,
        ...(customer ? { customer } : {}),
        ...(after ? { starting_after: after } : {}),
      };
      const options = { timeout: 6000, maxNetworkRetries: 0 };
      const result =
        args.report === "payments"
          ? await stripe.charges.list(
              {
                ...params,
                created: {
                  gte: Math.floor(Date.parse(window.from) / 1000),
                  lt: Math.floor(Date.parse(window.until) / 1000),
                },
              },
              options,
            )
          : args.report === "unpaid"
            ? await stripe.invoices.list({ ...params, status: "open" }, options)
            : await stripe.subscriptions.list(
                { ...params, status: "all" },
                options,
              );
      rows.push(
        ...result.data.filter((r) => customerSet.has(customerId(r.customer))),
      );
      if (!result.has_more) break;
      after = result.data.at(-1)?.id;
      if (!after) throw new HttpError(503, "Unvollständige Finanzantwort.");
    }
  }
  const name = (customer: any) => {
    const owners = [
      ...new Set(
        links
          .filter((l) => l.stripe_customer_id === customerId(customer))
          .map((l) => l.parent_id),
      ),
    ];
    return owners.length === 1
      ? parents.find((p) => p.id === owners[0])?.full_name
      : "Nicht eindeutig zugeordnet";
  };
  return summarizeBilling(args.report, rows, window, name);
}
export function summarizeBilling(
  report: string,
  rows: any[],
  window: ReturnType<typeof reportWindow>,
  name: (customer: any) => string,
) {
  const totals: Record<string, any> = {};
  if (report === "payments") {
    for (const r of rows) {
      if (r.status !== "succeeded" || !r.paid || !r.captured) continue;
      const t = (totals[r.currency] ??= {
        capturedMinor: 0,
        refundedMinor: 0,
        netMinor: 0,
        disputedCount: 0,
      });
      t.capturedMinor += r.amount_captured;
      t.refundedMinor += r.amount_refunded;
      t.netMinor += r.amount_captured - r.amount_refunded;
      if (r.disputed) t.disputedCount++;
    }
    return {
      window,
      currencies: totals,
      complete: true,
      note: "Stripe-Zahlungseingänge der im Portal verknüpften Kunden nach Zahlungsdatum, Beträge in kleinster Währungseinheit (EUR: Cent). Abzüglich aller inzwischen zu diesen Zahlungen erfassten Erstattungen, unabhängig vom Erstattungsdatum. Kein buchhalterischer Nettoumsatz; keine Barzahlungen. Streitfälle separat gezählt.",
    };
  }
  if (report === "unpaid") {
    const invoices = rows.filter((r) => r.amount_remaining > 0);
    for (const r of invoices)
      totals[r.currency] = (totals[r.currency] ?? 0) + r.amount_remaining;
    return {
      totalsMinor: totals,
      totalOpenInvoices: invoices.length,
      invoices: invoices.slice(0, 30).map((r) => ({
        family: name(r.customer),
        number: r.number,
        currency: r.currency,
        remainingMinor: r.amount_remaining,
        dueAt: r.due_date ? new Date(r.due_date * 1000).toISOString() : null,
        overdue: !!r.due_date && r.due_date * 1000 < Date.now(),
      })),
      more: invoices.length > 30,
      totalsComplete: true,
      note: "Alle aktuell offenen Stripe-Rechnungen unabhängig vom Erstellungsdatum; offen bedeutet nicht automatisch überfällig. Keine Entwürfe oder abgeschriebenen Forderungen. Beträge in kleinster Währungseinheit.",
    };
  }
  const ending = rows.filter(
    (r) => r.status !== "canceled" && (r.cancel_at || r.cancel_at_period_end),
  );
  const items = ending
    .flatMap((r) => {
      const ends = r.cancel_at
        ? [r.cancel_at]
        : [
            ...new Set<number>(
              r.items.data.map((i: any) => i.current_period_end),
            ),
          ];
      return ends
        .filter(
          (end) =>
            end * 1000 >= Date.parse(window.from) &&
            end * 1000 < Date.parse(window.until),
        )
        .map((end) => ({
          family: name(r.customer),
          status: r.status,
          endsAt: new Date(end * 1000).toISOString(),
        }));
    })
    .sort((a, b) => a.endsAt.localeCompare(b.endsAt));
  if (ending.some((r) => !r.cancel_at && r.items.has_more))
    throw new HttpError(503, "Abo-Endtermine nicht vollständig abrufbar.");
  return {
    window,
    endings: items.slice(0, 30),
    total: items.length,
    more: items.length > 30,
    totalsComplete: true,
    note: "Explizit zur Kündigung vorgesehene Abos/Positionen. Das normale Ende eines Leistungszeitraums ist keine Kündigung.",
  };
}

export async function subscriptionEndings(s: ProfileSession, raw: unknown) {
  const args = z
    .object({ start: z.iso.date().nullable(), end: z.iso.date().nullable() })
    .strict()
    .parse(raw);
  const links = await scopedSubscriptions(s);
  const today = Temporal.Now.zonedDateTimeISO("Europe/Berlin").toPlainDate();
  const window = reportWindow(
    args.start ?? today.toString(),
    args.end ?? today.add({ days: 30 }).toString(),
  );
  if (process.env.APP_MODE !== "production")
    return {
      available: false,
      reason:
        "Kündigungstermine benötigen aktuelle Stripe-Lesedaten, die lokal nicht angebunden sind.",
    };
  const subscriptions = [
    ...new Map(
      links.map((l) => [l.subscriptions.id, l.subscriptions]),
    ).values(),
  ];
  const stripe = profileStripeClient();
  const started = Date.now();
  const rows = [];
  for (const sub of subscriptions) {
    if (["canceled", "incomplete_expired"].includes(sub.status)) continue;
    if (rows.length >= 100 || Date.now() - started > 25000)
      throw new HttpError(503, "Abo-Endtermine nicht vollständig abrufbar.");
    const current = await stripe.subscriptions.retrieve(
      sub.stripe_subscription_id,
      { timeout: 6000, maxNetworkRetries: 0 },
    );
    rows.push({ ...current, customer: sub.id });
  }
  return summarizeBilling("ending_subscriptions", rows, window, (id) =>
    links
      .filter((l) => l.subscriptions.id === id)
      .map((l) => `${l.players.first_name} ${l.players.last_name}`)
      .join(", "),
  );
}
