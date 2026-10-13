import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
let db: PGlite;
const id = (n: number) =>
  `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = async (sql: string, args: unknown[] = []) =>
  (await db.query<any>(sql, args)).rows;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f < "202610080001")
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec(
    readFileSync("supabase/release/009-one-time-continuation.sql", "utf8"),
  );
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec("begin");
  await q("insert into auth.users values($1,'coach@test.invalid',now());", [
    id(1),
  ]);
  await q("insert into profiles(id,role) values($1,'admin')", [id(1)]);
  await q("insert into staff_profiles(id,display_name) values($1,'Coach')", [
    id(1),
  ]);
  await q("select set_config('request.jwt.claim.sub',$1,true)", [id(1)]);
  await q(
    "insert into players(id,first_name,last_name) values($1,'Kind','Eins'),($2,'Kind','Zwei')",
    [id(11), id(12)],
  );
  await q("insert into locations(id,name,address) values($1,'Platz','Weg 1')", [
    id(2),
  ]);
  await q(
    "insert into subscriptions(id,stripe_customer_id,stripe_subscription_id,status,stripe_data) values($1,'cus_old','sub_old','canceled','{}'),($2,'cus_new','sub_new','active','{}')",
    [id(31), id(32)],
  );
  await q(
    "insert into subscription_players(subscription_id,stripe_item_id,player_id) values($1,'si_new',$2)",
    [id(32), id(11)],
  );
  await q(
    "insert into entitlement_periods(id,player_id,subscription_id,stripe_customer_id,stripe_item_id,stripe_price_id,product_name,starts_at,ends_at,included_units) values($1,$2,$3,'cus_old','manual_si_old','price_fixture','GameChanger','2030-10-02T10:30:47Z','2030-11-02T11:30:47Z',8)",
    [id(21), id(11), id(31)],
  );
  await q(
    "insert into entitlement_continuation_exceptions(period_id,player_id,funding_invoice_id,reason) values($1,$2,'in_funding','Einmalige ausdrückliche Freigabe')",
    [id(21), id(11)],
  );
});
afterEach(async () => db.exec("rollback"));
async function actualPeriod(player = id(11)) {
  await q(
    "insert into entitlement_periods(id,player_id,subscription_id,stripe_customer_id,stripe_item_id,stripe_price_id,product_name,starts_at,ends_at,included_units) values($1,$2,$3,'cus_new','si_new','price_fixture','GameChanger','2030-10-15T10:00:00Z','2030-11-15T10:00:00Z',8)",
    [id(22), player, id(32)],
  );
}
function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "in_new",
    status: "paid",
    amount_paid: 15200,
    customer: "cus_new",
    parent: { subscription_details: { subscription: "sub_new" } },
    lines: {
      data: [
        {
          parent: {
            subscription_item_details: {
              subscription_item: "si_new",
              proration: false,
            },
          },
          pricing: { price_details: { price: "price_fixture" } },
          period: {
            start: Date.parse("2030-10-15T10:00:00Z") / 1000,
            end: Date.parse("2030-11-15T10:00:00Z") / 1000,
          },
        },
      ],
    },
    ...overrides,
  };
}
async function event(
  payload = invoice(),
  status = "processed",
  created = Date.now() / 1000 + 5,
) {
  return (
    await q(
      "insert into stripe_webhook_events(stripe_event_id,type,payload,stripe_created,status) values($1,'invoice.paid',$2,$3,$4) returning id",
      [
        `evt_${crypto.randomUUID()}`,
        { data: { object: payload } },
        Math.ceil(created),
        status,
      ],
    )
  )[0].id;
}
const exception = async () =>
  (await q("select * from entitlement_continuation_exceptions"))[0];
it("protects the exception from canceled-subscription synchronization without reactivating Stripe", async () => {
  await q("select apply_stripe($1)", [
    {
      stripe_subscription_id: "sub_old",
      stripe_customer_id: "cus_old",
      status: "canceled",
      ended_at: "2026-08-20T12:31:27Z",
      billing_cycle_anchor: "2026-03-06T11:30:05Z",
      retrieved_at: new Date().toISOString(),
      items: [],
    },
  ]);
  expect(
    (await q("select status from entitlement_periods where id=$1", [id(21)]))[0]
      .status,
  ).toBe("active");
  expect(
    (await q("select status from subscriptions where id=$1", [id(31)]))[0]
      .status,
  ).toBe("canceled");
});
it("replaces once after successful invoice processing and keeps superseded exceptions void", async () => {
  await actualPeriod();
  const evt = await event(invoice(), "pending");
  expect((await exception()).replaced_at).toBeNull();
  await q("update stripe_webhook_events set status='processed' where id=$1", [
    evt,
  ]);
  const first = await exception();
  expect(first.replacement_period_id).toBe(id(22));
  expect(first.replacement_invoice_id).toBe("in_new");
  await q("select resolve_entitlement_continuation($1)", [id(11)]);
  expect((await exception()).replaced_at).toEqual(first.replaced_at);
  await q("update entitlement_periods set status='active' where id=$1", [
    id(21),
  ]);
  expect(
    (await q("select status from entitlement_periods where id=$1", [id(21)]))[0]
      .status,
  ).toBe("void");
});
it.each([
  ["funding invoice", { id: "in_funding" }],
  ["zero payment", { amount_paid: 0 }],
  ["unpaid invoice", { status: "open" }],
  ["wrong customer", { customer: "cus_foreign" }],
  [
    "wrong subscription",
    { parent: { subscription_details: { subscription: "sub_foreign" } } },
  ],
  ["missing lines", { lines: { data: [] } }],
])("does not replace for %s", async (_, overrides) => {
  await actualPeriod();
  await event(invoice(overrides));
  expect((await exception()).replaced_at).toBeNull();
});
it("ignores invoice replays predating the explicit exception", async () => {
  await actualPeriod();
  await event(invoice(), "processed", 0);
  expect((await exception()).replaced_at).toBeNull();
});
it("does not replace for another child or an unassigned payment", async () => {
  await actualPeriod(id(12));
  await event();
  expect((await exception()).replaced_at).toBeNull();
});
it("handles assignment after a paid invoice was already processed", async () => {
  await event();
  expect((await exception()).replaced_at).toBeNull();
  await actualPeriod();
  expect((await exception()).replacement_period_id).toBe(id(22));
});
it("moves fitting future plans and preserves already recorded outcomes", async () => {
  const training = async (start: string) =>
    (
      await q("select save_training($1) id", [
        {
          title: "Training",
          starts_at: start,
          ends_at: new Date(Date.parse(start) + 3600000).toISOString(),
          player_ids: [id(11)],
          trainer_id: id(1),
          location_id: id(2),
          event_type: "Gruppentraining",
          notify_parents: false,
        },
      ])
    )[0].id;
  const future = await training("2030-10-20T14:00:00Z");
  const recorded = await training("2030-10-03T14:00:00Z");
  await q(
    "update event_participants set status='absent',reason='Dokumentiert' where event_id=$1",
    [recorded],
  );
  await actualPeriod();
  await event();
  expect(
    (
      await q("select period_id from event_participants where event_id=$1", [
        future,
      ])
    )[0].period_id,
  ).toBe(id(22));
  const [prior] = await q(
    "select period_id,status from event_participants where event_id=$1",
    [recorded],
  );
  expect(prior).toEqual({ period_id: id(21), status: "absent" });
});
it("keeps exception management unavailable to parents and ordinary authenticated accounts", async () => {
  expect(
    (
      await q(
        "select has_table_privilege('authenticated','entitlement_continuation_exceptions','select') readable,has_function_privilege('authenticated','resolve_entitlement_continuation(uuid)','execute') executable",
      )
    )[0],
  ).toEqual({ readable: false, executable: false });
});
