import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
let db: PGlite;
const query = async (sql: string, args: any[] = []) =>
  (await db.query<any>(sql, args)).rows;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth; create schema storage; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,service_role; grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  for (const f of [
    "011-subscription-package-changes.sql",
    "012-human-activities.sql",
  ])
    await db.exec(readFileSync(`supabase/release/${f}`, "utf8"));
});
afterAll(async () => {
  await db?.close();
});
async function audit(
  table: string,
  action: string,
  old: any,
  next: any,
  record = "00000000-0000-4000-8000-000000000001",
  at = "2026-10-17T10:00:00Z",
) {
  return (
    await query(
      "insert into audit_log(table_name,action,record_id,old_value,new_value,created_at) values($1,$2,$3,$4,$5,$6) returning id",
      [table, action, record, old, next, at],
    )
  )[0].id;
}
it("projects semantic changes and suppresses technical touches", async () => {
  const next = {
    first_name: "Kind",
    last_name: "Beispiel",
    updated_at: "new",
    private_note: "SECRET",
  };
  const noop = await audit(
    "players",
    "UPDATE",
    { ...next, updated_at: "old" },
    next,
  );
  const real = await audit(
    "players",
    "UPDATE",
    { ...next, first_name: "Alt" },
    next,
  );
  expect(
    await query("select * from activity_feed where id=$1", ["a:" + noop]),
  ).toHaveLength(0);
  const rows = await query("select * from activity_feed where id=$1", [
    "a:" + real,
  ]);
  expect(rows[0].subject).toBe("Kind Beispiel");
  expect(JSON.stringify(rows)).not.toContain("SECRET");
});
it("counts a package change once instead of its mapping and annual window updates", async () => {
  const mapping = await audit(
    "subscription_players",
    "UPDATE",
    { player_id: "child", stripe_item_id: "old" },
    { player_id: "child", stripe_item_id: "new" },
  );
  expect(
    await query("select * from activity_feed where id=$1", ["a:" + mapping]),
  ).toHaveLength(0);
  await db.exec("begin");
  const ids = [];
  for (let i = 0; i < 12; i++)
    ids.push(
      await audit(
        "entitlement_periods",
        "UPDATE",
        { product_name: "Pro", included_units: 8 },
        {
          product_name: "FirstTouch",
          included_units: 4,
          subscription_id: "sub",
          player_id: "child",
          starts_at: `2026-${String(i + 1).padStart(2, "0")}-01`,
        },
        `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      ),
    );
  await db.exec("commit");
  const rows = await query("select * from activity_feed where kind='package'");
  expect(rows).toHaveLength(1);
});
it("keeps old unresolved mail problems visible and clears instructions after success", async () => {
  const job = (
    await query(
      "insert into notification_jobs(idempotency_key,kind,recipient,payload,status) values('activity-test','stamp_card','PRIVATE@example.invalid','{\"token\":\"SECRET\"}','pending') returning id",
    )
  )[0].id;
  await query(
    "update notification_jobs set status='failed',last_error='SECRET provider details' where id=$1",
    [job],
  );
  await query(
    "update audit_log set created_at=now()-interval '5 days' where table_name='notification_jobs' and record_id=$1",
    [job],
  );
  let rows = await query(
    "select * from activity_feed where kind='mail' and is_open",
  );
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toMatch(/SECRET|PRIVATE/);
  await query("update notification_jobs set status='sent' where id=$1", [job]);
  expect(
    await query("select * from activity_feed where kind='mail' and is_open"),
  ).toHaveLength(0);
  expect(
    await query("select * from activity_feed where kind='mail'"),
  ).toHaveLength(2);
});
it("records Stripe failures and recovery without copying private webhook payloads", async () => {
  const id = (
    await query(
      "insert into stripe_webhook_events(stripe_event_id,type,payload,stripe_created) values('evt_activity','invoice.paid','{\"secret\":\"SECRET\"}',1) returning id",
    )
  )[0].id;
  await query(
    "update stripe_webhook_events set status='failed',last_error='SECRET' where id=$1",
    [id],
  );
  expect(
    await query("select * from activity_feed where kind='stripe' and is_open"),
  ).toHaveLength(1);
  await query(
    "update stripe_webhook_events set status='processed' where id=$1",
    [id],
  );
  const rows = await query("select * from activity_feed where kind='stripe'");
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => !r.is_open)).toBe(true);
  expect(JSON.stringify(rows)).not.toContain("SECRET");
});
it("does not expose the view directly to browser database roles", async () => {
  for (const role of ["anon", "authenticated"])
    expect(
      (
        await query(
          "select has_table_privilege($1,'public.activity_feed','select') allowed",
          [role],
        )
      )[0].allowed,
    ).toBe(false);
  expect(
    (
      await query(
        "select has_table_privilege('service_role','public.activity_feed','select') allowed",
      )
    )[0].allowed,
  ).toBe(true);
});
