import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  disciplineStats,
  disciplineUnits,
  stampSlots,
} from "../src/lib/domain";
let db: PGlite;
const admin = "30000000-0000-0000-0000-000000000004";
const child = "50000000-0000-0000-0000-000000000001";
const loc = "20000000-0000-0000-0000-000000000001";
const prices = {
  old: "price_1RlD1TRoswKHkM7689gRCjfq",
  current: "price_1UAq5PRoswKHkM76YMnEB9T0",
  annual: "price_1SAEB2RoswKHkM76rG2O64pe",
  next: "price_1SyvxMRoswKHkM761z5XJzFl",
};
async function query<T = Record<string, any>>(
  sql: string,
  args: unknown[] = [],
) {
  return (await db.query<T>(sql, args)).rows;
}
async function sync(
  id: string,
  price: string,
  start: string,
  end: string,
  created = "2025-06-01T00:00:00Z",
  status = "active",
) {
  const input = {
    stripe_subscription_id: id,
    stripe_customer_id: "cus_fixture",
    status,
    subscription_created_at: created,
    billing_cycle_anchor: start,
    retrieved_at: new Date().toISOString(),
    items: [
      { id: `si_${id}`, price_id: price, starts_at: start, ends_at: end },
    ],
  };
  const sid = (await query("select apply_stripe($1) id", [input]))[0].id;
  await query(
    "insert into subscription_players(subscription_id,stripe_item_id,player_id) values($1,$2,$3) on conflict do nothing",
    [sid, `si_${id}`, child],
  );
  await query("select apply_stripe($1)", [input]);
  return sid;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth; create schema storage; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,service_role; grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec(
    readFileSync(
      "supabase/release/011-subscription-package-changes.sql",
      "utf8",
    ),
  );
  await query(
    "insert into auth.users values($1,'admin@example.invalid',now())",
    [admin],
  );
  await query("insert into profiles(id,role) values($1,'admin')", [admin]);
  await query(
    "insert into staff_profiles(id,display_name) values($1,'Test Trainer')",
    [admin],
  );
  await query(
    "insert into players(id,first_name,last_name,birth_year) values($1,'Tariff','Fixture',2015)",
    [child],
  );
  await query(
    "insert into locations(id,name,address) values($1,'Test','Test')",
    [loc],
  );
});
afterAll(async () => {
  await db?.close();
});

const iso = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString();
let sequence = 0;
function payload(name: string, items: Record<string, unknown>[]) {
  return {
    stripe_subscription_id: name,
    stripe_customer_id: "cus_fixture",
    status: "active",
    subscription_created_at: "2025-01-01T00:00:00Z",
    billing_cycle_anchor: iso(-10),
    retrieved_at: new Date(Date.now() + sequence++ * 1000).toISOString(),
    items,
  };
}
const item = (id: string, price: string, start = iso(-10), end = iso(20)) => ({
  id,
  price_id: price,
  quantity: 1,
  starts_at: start,
  ends_at: end,
});
const first = "price_1RlBeSRoswKHkM76gM8jmUB5";
const game = "price_1RlCyQRoswKHkM76WMvJa0zd";
async function initial(
  name: string,
  old: Record<string, unknown>,
  player = child,
) {
  const input = payload(name, [old]);
  const sid = (await query("select apply_stripe($1) id", [input]))[0].id;
  await query(
    "insert into subscription_players(subscription_id,stripe_item_id,player_id) values($1,$2,$3)",
    [sid, old.id, player],
  );
  await query("select apply_stripe_package_sync($1)", [payload(name, [old])]);
  return {
    sid,
    period: (
      await query(
        "select * from entitlement_periods where subscription_id=$1",
        [sid],
      )
    )[0],
  };
}
it("moves a unique replaced item and downgrades the same card without losing consumption", async () => {
  const old = item("si_old", game);
  const { sid, period } = await initial("sub_change", old);
  await query(
    "insert into training_backfills(request_id,period_id,player_id,event_type,title,occurred_on,duration_minutes,parent_note,created_by) values(gen_random_uuid(),$1,$2,'Gruppentraining','Nachtrag',current_date-1,60,'Test',$3)",
    [period.id, child, admin],
  );
  const next = item("si_new", first, old.starts_at, old.ends_at);
  await query("select apply_stripe_package_sync($1)", [
    payload("sub_change", [next]),
  ]);
  const rows = await query(
    "select * from entitlement_periods where subscription_id=$1",
    [sid],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: period.id,
    included_units: 4,
    product_name: "FirstTouch",
    stripe_item_id: "si_new",
  });
  expect(
    await query("select * from training_backfills where period_id=$1", [
      period.id,
    ]),
  ).toHaveLength(1);
  expect(
    await query(
      "select * from entitlement_package_revisions where period_id=$1",
      [period.id],
    ),
  ).toHaveLength(1);
  await query("select apply_stripe_package_sync($1)", [
    payload("sub_change", [next]),
  ]);
  expect(
    await query(
      "select * from entitlement_package_revisions where period_id=$1",
      [period.id],
    ),
  ).toHaveLength(1);
});
it("handles a price change retaining the Stripe item ID and a reset billing anchor", async () => {
  const old = item("si_same", first);
  const { sid, period } = await initial("sub_same", old);
  await query("select apply_stripe_package_sync($1)", [
    payload("sub_same", [item("si_same", game, iso(-1), iso(29))]),
  ]);
  const rows = await query(
    "select * from entitlement_periods where subscription_id=$1",
    [sid],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].included_units).toBe(8);
  expect(rows[0].starts_at).toEqual(period.starts_at);
  await query("select import_stripe_allowance($1)", [
    {
      subscription_id: "sub_same",
      item_id: old.id,
      price_id: first,
      starts_at: old.starts_at,
      ends_at: old.ends_at,
    },
  ]);
  const afterInvoice = await query(
    "select * from entitlement_periods where subscription_id=$1",
    [sid],
  );
  expect(afterInvoice).toHaveLength(1);
  expect(afterInvoice[0].included_units).toBe(8);
});
it("does not carry consumption across a normal renewal boundary", async () => {
  const old = item("si_renew", game, iso(-40), iso(-10));
  const { sid, period } = await initial("sub_renew", old);
  await query("select apply_stripe_package_sync($1)", [
    payload("sub_renew", [item("si_renew_new", first, iso(-10), iso(20))]),
  ]);
  const rows = await query(
    "select * from entitlement_periods where subscription_id=$1 order by starts_at",
    [sid],
  );
  expect(rows).toHaveLength(2);
  expect(rows[0].id).toBe(period.id);
  expect(rows[0].included_units).toBe(8);
  expect(rows[1].included_units).toBe(4);
});
it("queues ambiguous mappings with the old children as suggestions", async () => {
  const second = "50000000-0000-0000-0000-000000000002";
  await query(
    "insert into players(id,first_name,last_name,birth_year) values($1,'Second','Child',2015)",
    [second],
  );
  const a = item("si_a", game),
    b = item("si_b", game);
  const { sid } = await initial("sub_ambiguous", a);
  await query(
    "insert into subscription_players(subscription_id,stripe_item_id,player_id) values($1,'si_b',$2)",
    [sid, second],
  );
  await query("select apply_stripe_package_sync($1)", [
    payload("sub_ambiguous", [a, b]),
  ]);
  const c = item("si_c", first),
    d = item("si_d", first);
  await query("select apply_stripe_package_sync($1)", [
    payload("sub_ambiguous", [c, d]),
  ]);
  const reviews = await query(
    "select * from subscription_assignment_reviews where subscription_id=$1 order by stripe_item_id",
    [sid],
  );
  expect(reviews).toHaveLength(2);
  expect(reviews[0].suggested_player_ids).toEqual([child, second]);
  expect(
    (
      await query(
        "select stripe_item_id from subscription_players where subscription_id=$1 order by stripe_item_id",
        [sid],
      )
    ).map((r) => r.stripe_item_id),
  ).toEqual(["si_a", "si_b"]);
  const confirm = {
    review_id: reviews[0].id,
    signature: reviews[0].signature,
    player_id: child,
    previous_item_id: "si_a",
  };
  await query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
  await expect(
    query("select resolve_subscription_assignment($1)", [
      { ...confirm, signature: null },
    ]),
  ).rejects.toThrow("geändert");
  await query("select resolve_subscription_assignment($1)", [confirm]);
  expect(
    (
      await query(
        "select status from subscription_assignment_reviews where id=$1",
        [reviews[0].id],
      )
    )[0].status,
  ).toBe("resolved");
  await expect(
    query("select resolve_subscription_assignment($1)", [confirm]),
  ).rejects.toThrow("geändert");
  await query("select set_config('request.jwt.claim.sub','',false)");
});
it("keeps direct entitlement edits and unauthorized confirmations blocked", async () => {
  const row = (await query("select id from entitlement_periods limit 1"))[0];
  await expect(
    query("update entitlement_periods set included_units=99 where id=$1", [
      row.id,
    ]),
  ).rejects.toThrow("immutable");
  await expect(
    query("select resolve_subscription_assignment($1)", [
      { review_id: row.id, player_id: child },
    ]),
  ).rejects.toThrow("Berechtigung");
});

it("ignores delayed older snapshots and does not undo the new package", async () => {
  const old = item("si_stale_old", game);
  const { sid } = await initial("sub_stale", old);
  const stale = payload("sub_stale", [old]);
  const next = payload("sub_stale", [
    item("si_stale_new", first, old.starts_at, old.ends_at),
  ]);
  await query("select apply_stripe_package_sync($1)", [next]);
  await query("select apply_stripe_package_sync($1)", [stale]);
  const row = (
    await query("select * from entitlement_periods where subscription_id=$1", [
      sid,
    ])
  )[0];
  expect(row.stripe_item_id).toBe("si_stale_new");
  expect(row.included_units).toBe(4);
});
it("keeps annual history while voiding obsolete future allowances on a monthly downgrade", async () => {
  const old = item("si_year", prices.annual, iso(-40), iso(325));
  const { sid } = await initial("sub_year", old);
  const before = await query(
    "select * from entitlement_periods where subscription_id=$1 order by starts_at",
    [sid],
  );
  expect(before.length).toBe(12);
  const historic = before.filter(
    (p) => new Date(p.ends_at).getTime() < Date.now(),
  );
  const live = before.find(
    (p) =>
      new Date(p.starts_at).getTime() <= Date.now() &&
      new Date(p.ends_at).getTime() > Date.now(),
  );
  const current = item("si_month", first, iso(-1), iso(29));
  await query("select apply_stripe_package_sync($1)", [
    payload("sub_year", [current]),
  ]);
  await query("select apply_stripe_package_sync($1)", [
    payload("sub_year", [current]),
  ]);
  const after = await query(
    "select * from entitlement_periods where subscription_id=$1 order by starts_at",
    [sid],
  );
  expect(after.find((p) => p.id === live.id).included_units).toBe(4);
  expect(
    after
      .filter((p) => new Date(p.starts_at).getTime() > Date.now())
      .every((p) => p.status === "void"),
  ).toBe(true);
  for (const past of historic)
    expect(after.find((p) => p.id === past.id)).toEqual(past);
});
it("updates future annual windows on a price change without duplicate periods", async () => {
  const old = item("si_annual_same", prices.annual, iso(-40), iso(325));
  const { sid } = await initial("sub_annual_same", old);
  // A second local annual plan verifies window preservation, independently of live catalogue changes.
  await query(
    "insert into plans(name,stripe_price_id,included_units,athletics_units,generation,billing_interval,is_public) values('Pro-Player','price_annual_alt',10,0,'legacy','year',false)",
  );
  await query("select apply_stripe_package_sync($1)", [
    payload("sub_annual_same", [
      item("si_annual_same", "price_annual_alt", old.starts_at, old.ends_at),
    ]),
  ]);
  const rows = await query(
    "select * from entitlement_periods where subscription_id=$1",
    [sid],
  );
  expect(rows).toHaveLength(12);
  expect(
    rows
      .filter((p) => new Date(p.ends_at).getTime() > Date.now())
      .every((p) => p.stripe_price_id === "price_annual_alt"),
  ).toBe(true);
});
it("does not apply scheduled future periods to the current card", async () => {
  const old = item("si_future_old", game);
  const { sid, period } = await initial("sub_future", old);
  await query("select apply_stripe_package_sync($1)", [
    payload("sub_future", [item("si_future_new", first, old.ends_at, iso(50))]),
  ]);
  const unchanged = (
    await query("select * from entitlement_periods where id=$1", [period.id])
  )[0];
  expect(unchanged.included_units).toBe(8);
  expect(unchanged.status).toBe("active");
  expect(
    await query("select * from entitlement_periods where subscription_id=$1", [
      sid,
    ]),
  ).toHaveLength(1);
});
