import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
import { describeActivity } from "../src/lib/activities";
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
    "060-activity-details.sql",
  ])
    await db.exec(readFileSync(`supabase/release/${f}`, "utf8"));
});
afterAll(async () => {
  await db?.close();
});
const SUB = "00000000-0000-4000-8000-0000000000a1",
  PARENT = "00000000-0000-4000-8000-0000000000b1",
  KID = "00000000-0000-4000-8000-0000000000c1";
it("answers who, why and when for a cancelled subscription", async () => {
  await db.exec(`insert into parents(id,full_name,contact_email,stripe_customer_id) values('${PARENT}','Eva Muster','eva@example.invalid','cus_1');
 insert into players(id,first_name,last_name,birth_year) values('${KID}','Max','Muster',2016);
 insert into subscriptions(id,parent_id,stripe_customer_id,stripe_subscription_id,status) values('${SUB}','${PARENT}','cus_1','sub_1','active');
 insert into subscription_players(subscription_id,stripe_item_id,player_id) values('${SUB}','si_1','${KID}');`);
  await query(
    "insert into stripe_webhook_events(stripe_event_id,type,payload,stripe_created,created_at) values('evt_1','customer.subscription.deleted',$1,1795000000,'2026-11-22T09:19:00Z')",
    [
      {
        data: {
          object: {
            id: "sub_1",
            status: "canceled",
            ended_at: 1795338000,
            cancellation_details: {
              reason: "cancellation_requested",
              feedback: "too_expensive",
              comment: "Wir ziehen um",
            },
          },
        },
      },
    ],
  );
  const [{ id }] = await query(
    "insert into audit_log(table_name,action,record_id,old_value,new_value,created_at) values('subscriptions','UPDATE',$1,$2,$3,'2026-11-22T09:20:00Z') returning id",
    [
      SUB,
      { id: SUB, status: "active", stripe_data: {} },
      { id: SUB, status: "canceled", stripe_data: {} },
    ],
  );
  const [row] = await query("select * from activity_feed where id=$1", [
    "a:" + id,
  ]);
  expect(row.subject).toBe("Max Muster");
  expect(row.details).toMatchObject({
    family: "Eva Muster",
    parentId: PARENT,
    children: "Max Muster",
    reason: "cancellation_requested",
    feedback: "too_expensive",
    comment: "Wir ziehen um",
    endedAt: "2026-11-22",
  });
  const admin = describeActivity(row, true),
    coach = describeActivity(row, false);
  expect(admin.title).toBe("Abo beendet");
  expect(admin.facts).toEqual([
    { label: "Wer", value: "Familie Eva Muster · Max Muster" },
    { label: "Warum", value: "Vom Kunden selbst gekündigt (Kundenportal)" },
    { label: "Angabe", value: "Angegebener Grund: Zu teuer" },
    { label: "Kommentar", value: "„Wir ziehen um“" },
    { label: "Wirksam", value: "Beendet seit 22.11.2026" },
    { label: "Durch", value: "Automatisch über Stripe" },
  ]);
  expect(admin.parentId).toBe(PARENT);
  expect(JSON.stringify(coach)).not.toMatch(
    /umziehen|Zu teuer|Warum|ziehen um/,
  );
  expect(coach.parentId).toBeUndefined();
});
it("shows a scheduled cancellation while the subscription still runs", async () => {
  const [{ id }] = await query(
    "insert into audit_log(table_name,action,record_id,old_value,new_value,created_at) values('subscriptions','UPDATE',$1,$2,$3,'2026-11-21T09:20:00Z') returning id",
    [
      SUB,
      {
        id: SUB,
        status: "active",
        stripe_data: { cancel_at_period_end: false },
      },
      {
        id: SUB,
        status: "active",
        stripe_data: {
          cancel_at_period_end: true,
          cancel_at: "2026-12-31T00:00:00Z",
        },
      },
    ],
  );
  const [row] = await query("select * from activity_feed where id=$1", [
    "a:" + id,
  ]);
  expect(row.kind).toBe("cancellation");
  const a = describeActivity(row, true);
  expect(a.title).toBe("Kündigung vorgemerkt");
  expect(a.text).toContain("31.12.2026");
});
