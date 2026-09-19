import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { campMailContent } from "../src/lib/camps/notifications";
import { htmlEmail } from "../src/lib/mail";
let db: PGlite;
const id = (n: number) =>
  `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create schema storage;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
  create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec(
    readFileSync("supabase/release/001-onboarding-mail.sql", "utf8"),
  );
  for (const f of readdirSync("supabase/camp")
    .filter((f) => /^00[1-8]-/.test(f) && f !== "001-down.sql")
    .sort())
    await db.exec(readFileSync(`supabase/camp/${f}`, "utf8"));
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec("begin");
  await db.query(
    "insert into auth.users values($1,'first@example.invalid',now()),($2,'admin@example.invalid',now())",
    [id(1), id(8)],
  );
  await db.query(
    "insert into profiles(id,role) values($1,'parent'),($2,'admin') on conflict(id) do update set role=excluded.role",
    [id(1), id(8)],
  );
  await db.query(
    "insert into parents(id,full_name,contact_email,auth_user_id,notifications_held) values($1,'Parent','first@example.invalid',$2,false)",
    [id(2), id(1)],
  );
  await db.query(
    "insert into players(id,first_name,last_name,birth_year)values($1,'Child','Test',2017)",
    [id(3)],
  );
  await db.query(
    "insert into parent_players(parent_id,player_id)values($1,$2)",
    [id(2), id(3)],
  );
  await db.query(
    `insert into camps(id,title,location,capacity,days,status,payment_mode) values($1,'Camp','Platz',10,jsonb_build_array(jsonb_build_object('starts_at',now()+interval '7 days'-interval '1 minute','ends_at',now()+interval '7 days 5 hours'),jsonb_build_object('starts_at',now()+interval '8 days','ends_at',now()+interval '8 days 5 hours')),'open','live')`,
    [id(4)],
  );
  await db.query(
    "insert into plans(id,name,included_units,generation,is_camp,camp_id)values($1,'Camp',0,'special',true,$2)",
    [id(5), id(4)],
  );
  await db.query(
    "insert into camp_offers(id,camp_id,plan_id,kind,stripe_price_id,stripe_product_id,stripe_payment_link_id,payment_url,amount)values($1,$2,$3,'main','price_camp','prod_camp','plink_camp','https://buy.stripe.com/camp',10000)",
    [id(6), id(4), id(5)],
  );
  await db.query(
    `insert into camp_bookings(id,camp_id,offer_id,parent_id,player_id,browser_token_hash,parent_data,child_data,customer_group,status,paid_at,expected_amount,currency,stripe_price_id,stripe_payment_link_id)values($1,$2,$3,$4,$5,'hash','{}','{}','new','paid',now()-interval '10 days',10000,'eur','price_camp','plink_camp')`,
    [id(7), id(4), id(6), id(2), id(3)],
  );
  await db.exec(`update system_settings set value='{"enabled":true,"recipients":["first@example.invalid"],"invitation_recipients":[],"automatic_invitations":false}' where key='portal_delivery_release';
  update system_settings set value=jsonb_build_object('enabled',true,'starts_after',now()-interval '30 days') where key='camp_mail_release';`);
});
afterEach(async () => db.exec("rollback"));
const plan = () =>
  db.query<{ n: number }>("select camp_plan_notifications() n");
const jobs = () =>
  db.query<{ kind: string; payload: any }>(
    "select kind,payload from notification_jobs where kind like 'camp_%' order by kind",
  );
it("plans exactly one seven-day reminder for the whole Camp and deduplicates retries", async () => {
  expect((await plan()).rows[0].n).toBe(1);
  expect((await plan()).rows[0].n).toBe(0);
  expect((await jobs()).rows.map((x) => x.kind)).toEqual(["camp_reminder_7d"]);
  await db.exec(
    "update camps set days=jsonb_build_array(jsonb_build_object('starts_at',now()+interval '23 hours','ends_at',now()+interval '3 days'))",
  );
  expect((await plan()).rows[0].n).toBe(1);
  expect((await jobs()).rows.map((x) => x.kind)).toEqual([
    "camp_reminder_24h",
    "camp_reminder_7d",
  ]);
});
it("never catches up a reminder for a late booking", async () => {
  await db.exec("update camp_bookings set paid_at=now()");
  expect((await plan()).rows[0].n).toBe(0);
});
it.each(["draft", "review", "cancelled", "refunded"])(
  "never queues mail for %s bookings",
  async (status) => {
    await db.query("update camp_bookings set status=$1", [status]);
    expect((await plan()).rows[0].n).toBe(0);
  },
);
it("keeps onboarding restrictions and skips archived camps", async () => {
  await db.exec("update parents set notifications_held=true");
  expect((await plan()).rows[0].n).toBe(0);
  await db.exec(
    "update parents set notifications_held=false;update auth.users set email_confirmed_at=null",
  );
  expect((await plan()).rows[0].n).toBe(0);
  await db.exec(
    "update auth.users set email_confirmed_at=now();update camps set status='archived'",
  );
  expect((await plan()).rows[0].n).toBe(0);
});
it("rechecks removal, schedule changes and family linkage before sending queued mail", async () => {
  await plan();
  const j = (await jobs()).rows[0];
  const allowed = () =>
    db.query<{ allowed: boolean }>(
      "select parent_delivery_allowed('first@example.invalid',$1,$2) allowed",
      [j.kind, j.payload],
    );
  expect((await allowed()).rows[0].allowed).toBe(true);
  await db.exec("update camp_bookings set status='cancelled'");
  expect((await allowed()).rows[0].allowed).toBe(false);
  await db.exec(
    "update camp_bookings set status='paid';update camps set days=jsonb_build_array(jsonb_build_object('starts_at',now()+interval '8 days','ends_at',now()+interval '9 days'))",
  );
  expect((await allowed()).rows[0].allowed).toBe(false);
});
it("confirms only after the last day plus the existing buffer and sends a single completion", async () => {
  await db.exec(
    "update camps set days=jsonb_build_array(jsonb_build_object('starts_at',now()-interval '4 days','ends_at',now()-interval '3 days'),jsonb_build_object('starts_at',now()-interval '2 days','ends_at',now()+interval '1 hour'))",
  );
  expect((await plan()).rows[0].n).toBe(0);
  expect(
    (
      await db.query<{ s: string }>(
        "select attendance_status s from camp_bookings",
      )
    ).rows[0].s,
  ).toBe("planned");
  await db.exec(
    "update camps set days=jsonb_build_array(jsonb_build_object('starts_at',now()-interval '4 days','ends_at',now()-interval '2 days'))",
  );
  expect((await plan()).rows[0].n).toBe(1);
  expect((await jobs()).rows.map((x) => x.kind)).toEqual(["camp_completion"]);
  expect((await plan()).rows[0].n).toBe(0);
  expect(
    (
      await db.query<{ d: string }>(
        "select to_char(calculate_auto_at('2026-10-22T15:00:00+02:00') at time zone 'Europe/Berlin','YYYY-MM-DD HH24:MI') d",
      )
    ).rows[0].d,
  ).toBe("2026-10-23 09:00");
});
it("allows the team to mark absence and prevents a positive completion", async () => {
  await db.query("select camp_set_attendance($1,$2,'absent')", [id(7), id(8)]);
  await db.exec(
    "update camps set days=jsonb_build_array(jsonb_build_object('starts_at',now()-interval '4 days','ends_at',now()-interval '2 days'))",
  );
  expect((await plan()).rows[0].n).toBe(0);
});
it("renders both contact buttons and all days without disclosing unapproved reports", () => {
  const data = {
    title: "Herbstcamp",
    location: "Platz & Straße",
    child: "Kind Test",
    days: [
      {
        starts_at: "2026-10-20T10:00:00+02:00",
        ends_at: "2026-10-20T15:00:00+02:00",
      },
      {
        starts_at: "2026-10-21T10:00:00+02:00",
        ends_at: "2026-10-21T15:00:00+02:00",
      },
    ],
  };
  const c = campMailContent("camp_reminder_7d", data, id(7), "4915143342392");
  const html = htmlEmail(
    c.subject,
    c.text,
    "https://portal.example/camps/test",
    c.actions,
  );
  expect(html).toContain('href="mailto:mail@proacademy-ak.com?');
  expect(html).toContain("https://wa.me/4915143342392?text=");
  expect(c.text).toContain("20.10.2026");
  expect(c.text).toContain("21.10.2026");
  expect(c.text).not.toContain("Camp-Bericht:");
});
