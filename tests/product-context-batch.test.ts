import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileSession } from "../src/lib/server/parent-profile";
import {
  loadProductContext,
  loadProductContexts,
} from "../src/lib/server/products/context";
import { emptyProduct } from "../src/lib/products/domain";
import { decideProduct } from "../src/lib/products/policy";
const now = Date.parse("2026-10-30T09:00:00Z");
const time = (days: number) => new Date(now + days * 86400000).toISOString();
const id = (n: number) =>
  `d1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = { role: "admin", user: { id: id(99) } } as ProfileSession;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3115");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
  vi.stubEnv("PRODUCT_MANAGEMENT_ENABLED", "true");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
function database(tables: Record<string, any[]>, fail?: string) {
  let requests = 0;
  const inSizes: number[] = [];
  const db = {
    from(table: string) {
      const filters: ((row: any) => boolean)[] = [];
      let size = Infinity;
      const query: any = {
        select: () => query,
        eq: (key: string, value: any) => {
          filters.push((r) => r[key] === value);
          return query;
        },
        is: (key: string, value: any) => {
          filters.push(
            (r) => r[key] === value || (value === null && r[key] == null),
          );
          return query;
        },
        in: (key: string, values: any[]) => {
          inSizes.push(values.length);
          filters.push((r) => values.includes(r[key]));
          return query;
        },
        or: (value: string) => {
          const clauses = value.split(",").map((v) => v.split(".eq."));
          filters.push((r) => clauses.some(([key, v]) => r[key] === v));
          return query;
        },
        order: () => query,
        limit: (n: number) => {
          size = n;
          return query;
        },
        gt: (key: string, value: string) => {
          filters.push((r) => r[key] > value);
          return query;
        },
        maybeSingle: async () => {
          const r = await execute();
          return { ...r, data: r.error ? null : (r.data[0] ?? null) };
        },
        then: (resolve: any, reject: any) => execute().then(resolve, reject),
      };
      async function execute() {
        requests++;
        return table === fail
          ? { data: null, error: new Error("unavailable") }
          : {
              data: (tables[table] ?? [])
                .filter((r) => filters.every((f) => f(r)))
                .sort((a, b) => a.id.localeCompare(b.id))
                .slice(0, size),
              error: null,
            };
      }
      return query;
    },
  } as unknown as SupabaseClient;
  return { db, requests: () => requests, inSizes };
}
function fixture() {
  const parents = [
    { id: id(1), auth_user_id: id(11) },
    { id: id(2), auth_user_id: id(12) },
    { id: id(3), auth_user_id: null },
  ];
  const player = (n: number, archived = false) => ({
    id: id(n),
    first_name: "Kind",
    last_name: String(n),
    camp_birth_date: "2016-01-01",
    archived_at: archived ? time(-1) : null,
  });
  const membership = (n: number, kid: number, current: boolean) => ({
    id: id(n),
    player_id: id(kid),
    stripe_item_id: `si_${n}`,
    subscriptions: {
      id: id(n + 100),
      stripe_subscription_id: `sub_${n}`,
      status: current ? "active" : "canceled",
      needs_review: false,
      stripe_data: {
        items: [{ id: `si_${n}`, price_id: `price_${n}`, ends_at: time(20) }],
      },
    },
  });
  const rows: Record<string, any[]> = {
    parents: parents.map((p) => ({ ...p, archived_at: null })),
    parent_players: [
      { id: id(101), parent_id: id(1), players: player(21) },
      { id: id(102), parent_id: id(2), players: player(21) },
      { id: id(103), parent_id: id(2), players: player(22) },
      { id: id(104), parent_id: id(1), players: player(23, true) },
    ],
    trial_families: [
      { id: id(31), parent_id: id(1), created_at: time(-10), stopped_at: null },
      {
        id: id(32),
        parent_id: id(2),
        created_at: time(-200),
        stopped_at: null,
      },
    ],
    trial_players: [
      {
        id: id(24),
        family_id: id(31),
        first_name: "Probe",
        last_name: "Aktiv",
        birth_date: "2017-01-01",
        converted_at: null,
      },
      {
        id: id(25),
        family_id: id(32),
        first_name: "Probe",
        last_name: "Früher",
        birth_date: "2017-01-01",
        converted_at: null,
      },
    ],
    subscription_players: [membership(41, 21, true), membership(42, 22, false)],
    entitlement_periods: [
      {
        id: id(51),
        player_id: id(21),
        subscription_id: id(141),
        stripe_item_id: "si_41",
        stripe_price_id: "price_41",
        status: "active",
        starts_at: time(-10),
        ends_at: time(20),
      },
      {
        id: id(52),
        player_id: id(22),
        subscription_id: id(142),
        stripe_item_id: "si_42",
        stripe_price_id: "price_42",
        status: "active",
        starts_at: time(-40),
        ends_at: time(-10),
      },
    ],
    plans: [
      {
        id: id(61),
        stripe_price_id: "price_41",
        name: "GameChanger",
        included_units: 8,
        athletics_units: 0,
        billing_interval: "month",
      },
      {
        id: id(62),
        stripe_price_id: "price_42",
        name: "FirstTouch",
        included_units: 4,
        athletics_units: 0,
        billing_interval: "month",
      },
    ],
    camp_bookings: [
      {
        id: id(71),
        parent_id: id(1),
        player_id: id(21),
        camp_id: id(81),
        status: "paid",
      },
      {
        id: id(72),
        parent_id: id(2),
        player_id: id(21),
        camp_id: id(82),
        status: "cancelled",
      },
    ],
    product_purchases: [
      {
        id: id(91),
        parent_id: id(1),
        product_id: id(85),
        player_id: id(21),
        status: "active",
        product_purchase_intents: {
          product: { kind: "other" },
          camp_booking_id: null,
        },
      },
      {
        id: id(92),
        parent_id: id(2),
        product_id: id(86),
        player_id: id(21),
        status: "active",
        product_purchase_intents: {
          product: { kind: "camp" },
          camp_booking_id: id(72),
        },
      },
    ],
    catalog_product_grants: [
      {
        id: id(201),
        parent_id: id(1),
        auth_id: id(11),
        product_id: id(85),
        purpose: "visibility",
        player_id: null,
        expires_at: null,
      },
      {
        id: id(202),
        parent_id: null,
        auth_id: id(11),
        product_id: id(85),
        purpose: "purchase",
        player_id: id(21),
        expires_at: time(1),
      },
      {
        id: id(203),
        parent_id: id(2),
        auth_id: null,
        product_id: id(86),
        purpose: "usage",
        player_id: null,
        expires_at: time(-1),
      },
    ],
  };
  return { parents, rows };
}
it("returns the same full contexts and policy decisions as individual reads without mixing shared-child family data", async () => {
  const { parents, rows } = fixture();
  const single = database(rows),
    bulk = database(rows);
  const expected = [];
  for (const p of parents)
    expected.push(await loadProductContext(admin, p.id, single.db));
  const actual = await loadProductContexts(admin, parents, bulk.db, now);
  expect(actual).toEqual(expected);
  expect(actual[0].grants).toHaveLength(2);
  expect(actual[1].grants).toEqual([]);
  expect(actual[0].children.find((c) => c.id === id(21))?.camp_ids).toEqual([
    id(81),
  ]);
  expect(actual[1].children.find((c) => c.id === id(21))?.camp_ids).toEqual([]);
  expect(actual[1].children.find((c) => c.id === id(21))?.purchases).toEqual(
    [],
  );
  expect(actual[0].children.some((c) => c.id === id(23))).toBe(false);
  expect(actual[0].children.find((c) => c.id === id(24))?.trial).toBe(true);
  expect(actual[1].children.find((c) => c.id === id(25))?.former_trial).toBe(
    true,
  );
  const product = {
    ...emptyProduct(),
    status: "active" as const,
    channels: ["catalog" as const],
  };
  for (let i = 0; i < parents.length; i++)
    for (const child of actual[i].children)
      expect(
        decideProduct(product, id(85), actual[i], "catalog", child.id),
      ).toEqual(
        decideProduct(product, id(85), expected[i], "catalog", child.id),
      );
  expect(bulk.requests()).toBeLessThan(single.requests() / 2);
});
it("bounds IN lists, paginates beyond 500 related rows and preserves row order", async () => {
  const { parents, rows } = fixture();
  rows.parent_players = Array.from({ length: 605 }, (_, n) => ({
    id: id(1000 + n),
    parent_id: id(1),
    players: {
      id: id(2000 + n),
      first_name: "Kind",
      last_name: String(n),
      camp_birth_date: null,
      archived_at: null,
    },
  }));
  rows.catalog_product_grants = Array.from({ length: 605 }, (_, n) => ({
    id: id(4000 + n),
    parent_id: id(1),
    auth_id: id(11),
    product_id: id(85),
    purpose: "visibility",
    player_id: null,
    expires_at: null,
  }));
  const single = database(rows),
    bulk = database(rows);
  const expected = await loadProductContext(admin, parents[0].id, single.db);
  const [actual] = await loadProductContexts(admin, [parents[0]], bulk.db, now);
  expect(actual).toEqual(expected);
  expect(actual.children).toHaveLength(606);
  expect(actual.grants).toHaveLength(605);
  expect(Math.max(...bulk.inSizes)).toBeLessThanOrEqual(100);
});
it("fails the entire batch on an unavailable related dataset", async () => {
  const { parents, rows } = fixture();
  await expect(
    loadProductContexts(
      admin,
      parents,
      database(rows, "entitlement_periods").db,
      now,
    ),
  ).rejects.toThrow("nicht vollständig");
});
it("rejects a non-admin batch before querying any family data", async () => {
  const { parents, rows } = fixture();
  const source = database(rows);
  await expect(
    loadProductContexts({ ...admin, role: "parent" }, parents, source.db, now),
  ).rejects.toThrow("Keine Berechtigung");
  expect(source.requests()).toBe(0);
});
