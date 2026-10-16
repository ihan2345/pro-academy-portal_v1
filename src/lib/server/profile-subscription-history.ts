import "server-only";
import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { serviceDb } from "./service-db";
import { profileStripeClient } from "./profile-stripe";
import { HttpError } from "./security";
import type { ProfilePeriod } from "../parent-profile";

export interface HistoryPeriod {
  item: string;
  start: number;
  end: number;
}
export interface ProfileSubscriptionLink {
  player_id: string;
  stripe_item_id: string;
  subscriptions: {
    id: string;
    stripe_subscription_id: string;
    status: string;
    stripe_data: Record<string, any>;
  };
}
const TTL = 6 * 60 * 60 * 1000;
const fail = () =>
  new HttpError(
    503,
    "Aktive Abo-Historie derzeit nicht vollständig verfügbar. Bitte später erneut versuchen.",
  );

/** Paid recurring service, including fully discounted invoices, excluding trials/credits. */
export async function readSubscriptionHistory(
  stripe: Stripe,
  subscription: string,
): Promise<HistoryPeriod[]> {
  const options = { timeout: 8000, maxNetworkRetries: 0 };
  const sub = await stripe.subscriptions.retrieve(subscription, options);
  const began = sub.start_date ?? sub.created;
  const trialStart = sub.trial_start ?? began;
  const trialEnd = sub.trial_end;
  const ended = sub.ended_at ?? Infinity;
  const result: HistoryPeriod[] = [];
  let requests = 1;
  async function pages<T extends { id?: string }>(
    fetch: (after?: string) => PromiseLike<{ data: T[]; has_more: boolean }>,
  ) {
    const rows: T[] = [];
    let after: string | undefined;
    for (;;) {
      if (++requests > 100) throw fail();
      const page = await fetch(after);
      rows.push(...page.data);
      if (!page.has_more) return rows;
      const next = page.data.at(-1)?.id;
      if (!next || next === after) throw fail();
      after = next;
    }
  }
  const invoices = await pages<Stripe.Invoice>((after) =>
    stripe.invoices.list(
      {
        subscription,
        status: "paid",
        limit: 100,
        ...(after ? { starting_after: after } : {}),
      },
      options,
    ),
  );
  for (const invoice of invoices) {
    const lines = invoice.lines.has_more
      ? await pages<Stripe.InvoiceLineItem>((after) =>
          stripe.invoices.listLineItems(
            invoice.id!,
            {
              limit: 100,
              ...(after ? { starting_after: after } : {}),
            },
            options,
          ),
        )
      : invoice.lines.data;
    for (const line of lines) {
      const details = line.parent?.subscription_item_details;
      if (!details || line.amount < 0) continue;
      const item = details.subscription_item;
      const start = Math.max(line.period.start, began);
      const end = Math.min(line.period.end, ended);
      if (
        !item ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start
      )
        continue;
      // A later trial must not erase paid service before that trial started.
      const ranges =
        trialEnd && trialStart < end && trialEnd > start
          ? [
              [start, Math.min(end, trialStart)],
              [Math.max(start, trialEnd), end],
            ]
          : [[start, end]];
      for (const [a, b] of ranges)
        if (b > a) result.push({ item, start: a, end: b });
    }
  }
  return result;
}

/** The audited mapping keeps old Stripe item IDs even after multiple package
 * changes in one period. Read all current mappings for the subscriptions so a
 * sibling's item can never be inferred from a shared subscription alone. */
async function historicalOwners(
  db: ReturnType<typeof serviceDb>,
  subscriptionIds: string[],
) {
  async function collect(make: () => any): Promise<any[]> {
    const rows: any[] = [];
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      let query = make().order("id").limit(500);
      if (after) query = query.gt("id", after);
      const result = await query;
      if (result.error) throw fail();
      rows.push(...result.data);
      if (result.data.length < 500) return rows;
      after = result.data.at(-1).id;
    }
    throw fail();
  }
  const owners = new Map<string, Set<string>>();
  const add = (mapping: any) => {
    if (
      !mapping ||
      !subscriptionIds.includes(mapping.subscription_id) ||
      !mapping.stripe_item_id ||
      !mapping.player_id
    )
      return;
    const key = `${mapping.subscription_id}:${mapping.stripe_item_id}`;
    const players = owners.get(key) ?? new Set<string>();
    players.add(mapping.player_id);
    owners.set(key, players);
  };
  // Keep PostgREST IN filters bounded, including profile-wide rankings.
  for (let start = 0; start < subscriptionIds.length; start += 100) {
    const mappings = await collect(() =>
      db
        .from("subscription_players")
        .select("id,subscription_id,stripe_item_id,player_id")
        .in("subscription_id", subscriptionIds.slice(start, start + 100)),
    );
    mappings.forEach(add);
    for (let offset = 0; offset < mappings.length; offset += 100) {
      const audit = await collect(() =>
        db
          .from("audit_log")
          .select("id,old_value,new_value")
          .eq("table_name", "subscription_players")
          .in(
            "record_id",
            mappings.slice(offset, offset + 100).map((m) => m.id),
          ),
      );
      for (const entry of audit) {
        add(entry.old_value);
        add(entry.new_value);
      }
    }
  }
  return owners;
}

/** Shared persistent cache, refreshed on relevant subscription changes or after six hours. */
export async function profileActivePeriods(
  links: ProfileSubscriptionLink[],
  storedPeriods: ProfilePeriod[],
  now: string,
): Promise<ProfilePeriod[]> {
  if (!links.length) return storedPeriods;
  const db = serviceDb();
  const unique = [
    ...new Map(
      links.map((l) => [l.subscriptions.id, l.subscriptions]),
    ).values(),
  ].filter((s) => /^sub_[A-Za-z0-9]+$/.test(s.stripe_subscription_id));
  // Legacy local fixtures use non-Stripe IDs such as sub_livetest_....
  // Keep their evidenced allowance periods without sending them to Stripe.
  if (!unique.length) return storedPeriods;
  const cache = await db
    .from("profile_subscription_history")
    .select("subscription_id,source_signature,periods,checked_at")
    .in(
      "subscription_id",
      unique.map((s) => s.id),
    );
  if (cache.error)
    throw new HttpError(
      503,
      "Für die aktive Statusberechnung fehlt die Abo-Historie. Bitte die vorbereitete Migration prüfen.",
    );
  const records = new Map(
    (cache.data ?? []).map((c) => [c.subscription_id, c]),
  );
  const histories = new Map<string, HistoryPeriod[]>();
  let next = 0;
  // Bound concurrency: an initial ranking may need every family's history.
  await Promise.all(
    Array.from({ length: Math.min(4, unique.length) }, async () => {
      while (next < unique.length) {
        const sub = unique[next++];
        const signature = createHash("sha256")
          .update(
            JSON.stringify({
              version: 2,
              stripe: sub.stripe_subscription_id,
              status: sub.status,
              ended: sub.stripe_data?.ended_at,
              items: sub.stripe_data?.items,
            }),
          )
          .digest("hex");
        const cached = records.get(sub.id);
        if (
          cached?.source_signature === signature &&
          Date.parse(now) - Date.parse(cached.checked_at) < TTL &&
          Date.parse(cached.checked_at) <= Date.parse(now)
        ) {
          histories.set(sub.id, cached.periods as HistoryPeriod[]);
          continue;
        }
        let periods: HistoryPeriod[];
        try {
          periods = await readSubscriptionHistory(
            profileStripeClient(),
            sub.stripe_subscription_id,
          );
        } catch {
          throw fail();
        }
        const saved = await db.from("profile_subscription_history").upsert({
          subscription_id: sub.id,
          source_signature: signature,
          periods,
          checked_at: now,
        });
        if (saved.error) throw fail();
        histories.set(sub.id, periods);
      }
    }),
  );
  // Stripe history replaces imported allowance snapshots for these subscriptions:
  // allowance snapshots alone cannot establish old gaps, trials or cancellation ends.
  const sourced = new Set(unique.map((s) => s.id));
  const result = storedPeriods.filter(
    (p) => !p.subscription_id || !sourced.has(p.subscription_id),
  );
  const owners = await historicalOwners(db, [...sourced]);
  const emitted = new Set<string>();
  for (const link of links) {
    for (const period of histories.get(link.subscriptions.id) ?? []) {
      const assigned = owners.get(`${link.subscriptions.id}:${period.item}`);
      if (assigned && assigned.size > 1 && assigned.has(link.player_id)) {
        throw new HttpError(
          503,
          "Die historische Kinderzuordnung dieses Abos ist nicht eindeutig. Bitte prüfen.",
        );
      }
      if (
        period.item !== link.stripe_item_id &&
        !(assigned?.size === 1 && assigned.has(link.player_id))
      )
        continue;
      const key = `${link.player_id}:${link.subscriptions.id}:${period.item}:${period.start}:${period.end}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      result.push({
        player_id: link.player_id,
        subscription_id: link.subscriptions.id,
        starts_at: new Date(period.start * 1000).toISOString(),
        ends_at: new Date(period.end * 1000).toISOString(),
        status: "active",
        product_name: "",
      });
    }
  }
  return result;
}
