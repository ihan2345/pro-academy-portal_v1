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
it("maps all eight actual prices with the approved grandfathered/current allowances", async () => {
  const rows = await query(
    "select name,generation,included_units,athletics_units,billing_interval,is_public from plans order by id",
  );
  expect(rows.map((r) => r.included_units)).toEqual([
    4, 8, 10, 4, 8, 12, 10, 12,
  ]);
  expect(rows[6].billing_interval).toBe("year");
  expect(rows[7].athletics_units).toBe(4);
  expect(rows.filter((r) => r.is_public).map((r) => r.generation)).toEqual([
    "current",
    "current",
    "current",
  ]);
  await expect(
    query("update plans set included_units=8 where stripe_price_id=$1", [
      prices.old,
    ]),
  ).rejects.toThrow();
});
it("preserves legacy 10-unit renewals after September while new PRO receives 12", async () => {
  const old = await sync(
    "sub_old",
    prices.old,
    "2026-09-12T10:00:00Z",
    "2026-10-12T10:00:00Z",
  );
  const fresh = await sync(
    "sub_new",
    prices.current,
    "2026-09-12T10:00:00Z",
    "2026-10-12T10:00:00Z",
    "2026-09-01T00:00:00Z",
  );
  expect(
    (
      await query(
        "select included_units from entitlement_periods where subscription_id=$1",
        [old],
      )
    )[0].included_units,
  ).toBe(10);
  expect(
    (
      await query(
        "select included_units from entitlement_periods where subscription_id=$1",
        [fresh],
      )
    )[0].included_units,
  ).toBe(12);
});
it("does not silently sell an old tariff to a subscription created after the cutoff", async () => {
  const sid = await sync(
    "sub_badlegacy",
    prices.old,
    "2026-09-01T10:00:00Z",
    "2026-10-01T10:00:00Z",
    "2026-08-31T22:00:00Z",
  );
  expect(
    await query("select id from entitlement_periods where subscription_id=$1", [
      sid,
    ]),
  ).toHaveLength(0);
  expect(
    (
      await query("select needs_review from subscriptions where id=$1", [sid])
    )[0].needs_review,
  ).toBe(true);
});
it("annual billing creates 12 monthly 10-unit snapshots and repeated sync is idempotent", async () => {
  const sid = await sync(
    "sub_year",
    prices.annual,
    "2025-01-31T11:00:00Z",
    "2026-01-31T11:00:00Z",
  );
  await sync(
    "sub_year",
    prices.annual,
    "2025-01-31T11:00:00Z",
    "2026-01-31T11:00:00Z",
  );
  const rows = await query(
    "select * from entitlement_periods where subscription_id=$1 order by starts_at",
    [sid],
  );
  expect(rows).toHaveLength(12);
  expect(rows.every((r) => r.included_units === 10)).toBe(true);
  expect(rows[1].starts_at.toISOString()).toBe("2025-02-28T11:00:00.000Z");
  expect(rows[2].starts_at.toISOString()).toBe("2025-03-31T10:00:00.000Z");
  expect(rows[11].ends_at.toISOString()).toBe("2026-01-31T11:00:00.000Z");
  for (let i = 1; i < rows.length; i++)
    expect(rows[i].starts_at).toEqual(rows[i - 1].ends_at);
});
it("preserves leap-day and short first-period boundaries without gaps", async () => {
  const rows = await query(
    "select * from allowance_windows('2024-02-29T11:00:00Z','2025-02-28T11:00:00Z','year')",
  );
  expect(rows).toHaveLength(12);
  expect(rows.at(-1)!.ends_at.toISOString()).toBe("2025-02-28T11:00:00.000Z");
  const short = await query(
    "select * from allowance_windows('2025-01-31T11:00:00Z','2025-03-01T11:00:00Z','year')",
  );
  expect(short).toHaveLength(2);
  expect(short[1].ends_at.toISOString()).toBe("2025-03-01T11:00:00.000Z");
});
it("price changes never replace existing snapshots, including NEXT LEVEL split", async () => {
  const sid = await sync(
    "sub_next",
    prices.next,
    "2025-06-01T00:00:00Z",
    "2025-07-01T00:00:00Z",
  );
  await sync(
    "sub_next",
    prices.current,
    "2025-06-01T00:00:00Z",
    "2025-07-01T00:00:00Z",
  );
  const row = (
    await query("select * from entitlement_periods where subscription_id=$1", [
      sid,
    ])
  )[0];
  expect(row.athletics_units).toBe(4);
  expect(row.included_units).toBe(12);
  await expect(
    query("update entitlement_periods set athletics_units=0 where id=$1", [
      row.id,
    ]),
  ).rejects.toThrow("immutable");
  expect(
    (
      await query("select needs_review from subscriptions where id=$1", [sid])
    )[0].needs_review,
  ).toBe(true);
});
it("cancelled subscriptions cannot generate future entitlements", async () => {
  const sid = await sync(
    "sub_cancel",
    prices.old,
    "2027-01-01T00:00:00Z",
    "2027-02-01T00:00:00Z",
    "2025-01-01T00:00:00Z",
    "canceled",
  );
  expect(
    await query("select id from entitlement_periods where subscription_id=$1", [
      sid,
    ]),
  ).toHaveLength(0);
});
it("athletics uses NEXT LEVEL allowance, cannot be booked against a football-only period, and reports stay split", async () => {
  await query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
  const event = {
    title: "Athletik",
    starts_at: "2025-06-15T10:00:00Z",
    ends_at: "2025-06-15T11:00:00Z",
    location_id: loc,
    trainer_id: admin,
    event_type: "Athletiktraining",
    player_ids: [child],
    notify_parents: false,
  };
  const eid = (await query("select save_training($1) id", [event]))[0].id;
  const participant = (
    await query("select * from event_participants where event_id=$1", [eid])
  )[0];
  await query(
    "select set_attendance($1,'attended_manual','Test abgeschlossen',false)",
    [participant.id],
  );
  const report = (
    await query("select capture_report($1) id", [participant.period_id])
  )[0].id;
  const snapshot = (
    await query("select snapshot from report_snapshots where id=$1", [report])
  )[0].snapshot;
  expect(snapshot.athletics_units).toBe(4);
  expect(disciplineStats(snapshot.events).athletics.completed).toBe(1);
  expect(disciplineStats(snapshot.events).football.completed).toBe(0);
  await expect(
    query("select save_training($1)", [
      { ...event, id: eid, revision: 1, event_type: "Gruppentraining" },
    ]),
  ).rejects.toThrow("bestätigte");
  await expect(
    query("select save_training($1)", [
      {
        ...event,
        starts_at: "2025-02-15T10:00:00Z",
        ends_at: "2025-02-15T11:00:00Z",
      },
    ]),
  ).rejects.toThrow("Leistungszeitraum");
});
it("a parent sees only publicly available new products and cannot call the importer", async () => {
  await query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec("set role authenticated");
  try {
    expect(
      (await query("select generation from plans")).every(
        (r) => r.generation === "current",
      ),
    ).toBe(true);
    await expect(query("select import_stripe_allowance('{}')")).rejects.toThrow(
      "permission denied",
    );
  } finally {
    await db.exec("reset role");
  }
});
it("12 stamps fit the allowance and athletics never consumes football slots", () => {
  const rows = [
    {
      status: "attended_manual" as const,
      event_type: "Athletiktraining",
      starts_at: "2025-06-01T10:00:00Z",
      ends_at: "2025-06-01T11:00:00Z",
    },
  ];
  const stats = disciplineStats(rows);
  expect(stats.football.completed).toBe(0);
  expect(stats.athletics.completed).toBe(1);
  expect(
    disciplineUnits(
      { included_units: 12, athletics_units: 4 },
      "Gruppentraining",
    ),
  ).toBe(8);
  expect(stampSlots(12, 10, 1)).toEqual([
    ...Array(10).fill("done"),
    "planned",
    "open",
  ]);
});

it("paid-invoice recovery uses the same monthly annual windows without duplicate snapshots", async () => {
  const sid = (
    await query(
      "select id from subscriptions where stripe_subscription_id='sub_year'",
    )
  )[0].id;
  const input = {
    subscription_id: "sub_year",
    item_id: "si_sub_year",
    price_id: prices.annual,
    starts_at: "2025-01-31T11:00:00Z",
    ends_at: "2026-01-31T11:00:00Z",
  };
  await query("select import_stripe_allowance($1)", [input]);
  await query("select import_stripe_allowance($1)", [input]);
  expect(
    await query("select id from entitlement_periods where subscription_id=$1", [
      sid,
    ]),
  ).toHaveLength(12);
});
it("cancellation voids future annual months and preserves ended snapshots", async () => {
  const sid = await sync(
    "sub_year_cancel",
    prices.annual,
    "2026-01-01T11:00:00Z",
    "2027-01-01T11:00:00Z",
  );
  await query("select apply_stripe($1)", [
    {
      stripe_subscription_id: "sub_year_cancel",
      stripe_customer_id: "cus_fixture",
      subscription_created_at: "2025-01-01T11:00:00Z",
      ended_at: "2026-09-09T10:00:00Z",
      status: "canceled",
      retrieved_at: new Date().toISOString(),
      items: [],
    },
  ]);
  const rows = await query(
    "select starts_at,status from entitlement_periods where subscription_id=$1 order by starts_at",
    [sid],
  );
  expect(rows[0].status).toBe("active");
  expect(rows.at(-1)!.status).toBe("void");
});
