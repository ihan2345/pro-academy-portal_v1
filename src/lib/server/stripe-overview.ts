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
  openStripeNotice,
  groupStripeNotices,
  matchesStripeNoticeType,
  STRIPE_NOTICE_MONTH,
  STRIPE_NOTICE_PAGE_SIZE,
  type StripeNotice,
  type StripeNoticePage,
} from "../stripe-notices";

const paramsSchema = z
  .object({
    section: z.enum(["conflicts", "activities"]),
    window: z.enum(["month", "all"]).default("month"),
    state: z.enum(["all", "open"]).default("all"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    type: z.enum(["all", "new", "cancel"]).default("all"),
  })
  .strict();
type SourceNotice = Omit<StripeNotice, "state" | "token"> & {
  revision: unknown;
};
async function decorate(rows: SourceNotice[], now: number) {
  const decorated = await stripeNoticeDecisions(
    rows.map(({ revision, ...r }) => ({
      ...r,
      state: "open",
      ...stripeNoticeIdentity(r.kind, r.id, revision, now),
    })),
  );
  return decorated.map((row) =>
    row.state === "open" &&
    !row.actionRequired &&
    row.activity?.resolvedAutomatically &&
    row.activity.assignment === "assigned"
      ? { ...row, state: "done" as const, resolvedAutomatically: true }
      : row,
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
    const selected =
      params.state === "open" ? rows.filter(openStripeNotice) : rows;
    return {
      rows: selected,
      total: selected.length,
      openCount: stripeNoticeCount(rows, now),
      checkedAt,
      ...(warning ? { warning } : {}),
    };
  }
  const columns = "id,stripe_event_id,type,payload,stripe_created,status";
  const cutoff = Math.ceil((now - STRIPE_NOTICE_MONTH) / 1000),
    asOf = Math.floor(now / 1000);
  // Einträge derselben Familie am selben Tag werden zusammengefasst und als
  // Gruppe geblättert. Dafür (und für den Badge) wird der ganze Zeitraum
  // bewertet; "Gesamt" schließt die letzten 30 Tage immer mit ein.
  const candidates = await collectRows(() => {
    let rows = db
      .from("stripe_webhook_events")
      .select(columns)
      .lte("stripe_created", asOf);
    if (params.window === "month") rows = rows.gte("stripe_created", cutoff);
    return rows;
  });
  // Open status depends on current assignments and saved decisions, so evaluate
  // every candidate before paging. Batch hydration to keep DB filter URLs bounded.
  const hydrated: Awaited<ReturnType<typeof stripeActivityRows>> = [];
  for (let offset = 0; offset < candidates.length; offset += 250)
    hydrated.push(
      ...(await stripeActivityRows(candidates.slice(offset, offset + 250))),
    );
  const decorated = (
    await decorate(
      hydrated.map((r) => ({
        id: r.id,
        kind: "activity",
        at: r.at,
        customer: r.customer,
        title: r.title,
        actionRequired: r.actionRequired,
        activity: r,
        reviewId: r.reviewId ?? undefined,
        revision: [r.actionRequired, r.actionLabel, r.subscriptionId],
      })),
      now,
    )
  ).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const groups = groupStripeNotices(
    params.state === "open" ? decorated.filter(openStripeNotice) : decorated,
  );
  const selected = groups.filter((g) =>
    matchesStripeNoticeType(g, params.type),
  );
  return {
    rows: selected
      .slice(
        (params.page - 1) * STRIPE_NOTICE_PAGE_SIZE,
        params.page * STRIPE_NOTICE_PAGE_SIZE,
      )
      .flatMap((g) => g.rows),
    total: selected.length,
    openCount: stripeNoticeCount(decorated, now),
    checkedAt,
    typeCounts: {
      all: groups.length,
      new: groups.filter((g) => matchesStripeNoticeType(g, "new")).length,
      cancel: groups.filter((g) => matchesStripeNoticeType(g, "cancel")).length,
    },
  };
}
