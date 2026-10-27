import "server-only";
import { z } from "zod";
import { assertRole, HttpError } from "./security";
import { serviceDb } from "./service-db";
import type { ProfileSession } from "./parent-profile";
import { collectRows } from "./pai/analytics";
import { stripeBillingConflicts } from "./stripe-conflicts";
import { stripeActivityRows } from "./stripe-activities";
import {
  stripeNoticeIdentity,
  stripeNoticeDecisions,
} from "./stripe-notice-decisions";
import {
  stripeNoticeCount,
  STRIPE_NOTICE_MONTH,
  STRIPE_NOTICE_PAGE_SIZE,
  type StripeNotice,
  type StripeNoticePage,
} from "../stripe-notices";

const paramsSchema = z
  .object({
    section: z.enum(["conflicts", "activities"]),
    window: z.enum(["month", "all"]).default("month"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
type SourceNotice = Omit<StripeNotice, "state" | "token"> & {
  revision: unknown;
};
async function decorate(rows: SourceNotice[], now: number) {
  return stripeNoticeDecisions(
    rows.map(({ revision, ...r }) => ({
      ...r,
      state: "open",
      ...stripeNoticeIdentity(r.kind, r.id, revision, now),
    })),
  );
}
function checked(r: any) {
  if (r.error)
    throw new HttpError(
      503,
      "Stripe-Meldungen konnten nicht vollständig geladen werden. Bitte Migration 030 und Verbindung prüfen.",
    );
  return r.data ?? [];
}
export async function stripeOverview(
  session: ProfileSession,
  input: unknown,
): Promise<StripeNoticePage> {
  assertRole(session.role, "admin");
  const params = paramsSchema.parse(input),
    now = Date.now(),
    checkedAt = new Date(now).toISOString();
  const db = serviceDb();
  if (params.section === "conflicts") {
    let warning: string | undefined;
    const [billing, reviews] = await Promise.all([
      stripeBillingConflicts(session).catch(() => {
        warning =
          "Aktueller Stripe-Zahlungsstatus nicht verfügbar. Die Abo-Zuordnungen bleiben bearbeitbar; der Badge ist derzeit unvollständig.";
        return { rows: [], checkedAt };
      }),
      collectRows(() =>
        db
          .from("subscription_assignment_reviews")
          .select(
            "id,signature,created_at,subscriptions!inner(stripe_customer_id)",
          )
          .eq("status", "pending"),
      ),
    ]);
    const customerIds = [
      ...new Set(reviews.map((r) => r.subscriptions.stripe_customer_id)),
    ];
    const customers: any[] = [];
    for (let n = 0; n < customerIds.length; n += 100)
      customers.push(
        ...(await collectRows(() =>
          db
            .from("stripe_customer_registry")
            .select("id,name")
            .in("id", customerIds.slice(n, n + 100)),
        )),
      );
    const source: SourceNotice[] = [
      ...reviews.map((r) => ({
        id: r.id,
        kind: "review" as const,
        at: r.created_at,
        customer:
          customers.find((c) => c.id === r.subscriptions.stripe_customer_id)
            ?.name ?? r.subscriptions.stripe_customer_id,
        title: "Abo-Zuordnung prüfen",
        actionRequired: true,
        reviewId: r.id,
        revision: r.signature,
      })),
      ...billing.rows.map((r) => ({
        id: r.id,
        kind: "billing" as const,
        at: r.at,
        customer: r.customer,
        title: r.reason,
        actionRequired: true,
        billing: r,
        revision: [
          r.status,
          r.blocked,
          r.invoices
            .map((i) => [i.id, i.remaining, i.currency])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        ],
      })),
    ];
    const rows = (await decorate(source, now)).sort(
      (a, b) =>
        b.at.localeCompare(a.at) ||
        a.kind.localeCompare(b.kind) ||
        a.id.localeCompare(b.id),
    );
    // All conflict summaries are returned once; filtering/paging stays inside the disclosure
    // without another full Stripe scan for every page click.
    return {
      rows,
      total: rows.length,
      openCount: stripeNoticeCount(rows, now),
      checkedAt,
      ...(warning ? { warning } : {}),
    };
  }
  const columns = "id,stripe_event_id,type,payload,stripe_created,status";
  const cutoff = Math.ceil((now - STRIPE_NOTICE_MONTH) / 1000),
    asOf = Math.floor(now / 1000);
  let query = db
    .from("stripe_webhook_events")
    .select(columns, { count: "exact" })
    .lte("stripe_created", asOf)
    .order("stripe_created", { ascending: false })
    .order("id", { ascending: false });
  if (params.window === "month") query = query.gte("stripe_created", cutoff);
  const [selected, recent] = await Promise.all([
    query.range(
      (params.page - 1) * STRIPE_NOTICE_PAGE_SIZE,
      params.page * STRIPE_NOTICE_PAGE_SIZE - 1,
    ),
    collectRows(() =>
      db
        .from("stripe_webhook_events")
        .select(columns)
        .gte("stripe_created", cutoff)
        .lte("stripe_created", asOf),
    ),
  ]);
  const pageRows = checked(selected);
  const combined = [
    ...new Map([...recent, ...pageRows].map((r) => [r.id, r])).values(),
  ];
  const hydrated = await stripeActivityRows(combined);
  const decorated = await decorate(
    hydrated.map((r) => ({
      id: r.id,
      kind: "activity",
      at: r.at,
      customer: r.customer,
      title: r.title,
      actionRequired: r.actionRequired,
      activity: r,
      revision: [r.actionRequired, r.actionLabel, r.subscriptionId],
    })),
    now,
  );
  return {
    rows: pageRows.map((r: any) =>
      decorated.find((row) => row.id === r.stripe_event_id)!,
    ),
    total: selected.count ?? 0,
    openCount: stripeNoticeCount(decorated, now),
    checkedAt,
  };
}
