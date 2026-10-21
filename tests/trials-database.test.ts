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
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  const files = readdirSync("supabase/migrations").sort();
  for (const f of files.filter((f) => f < "202609230010"))
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec(
    readFileSync("supabase/release/001-onboarding-mail.sql", "utf8"),
  );
  for (const f of readdirSync("supabase/camp")
    .filter((f) => /^00[1-9]-/.test(f) && f !== "001-down.sql")
    .sort())
    await db.exec(readFileSync(`supabase/camp/${f}`, "utf8"));
  await db.exec(readFileSync("supabase/camp/010-team-import.sql", "utf8"));
  for (const f of files.filter((f) => f >= "202609230010"))
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  for (const f of [
    "002-v2-backfill-mail.sql",
    "005-training-notifications.sql",
    "006-manual-training-recipient-exception.sql",
    "007-staff-training-confirmations.sql",
    "008-training-planning-grace.sql",
    "009-parent-email-preference.sql",
    "016-calendar-backfills.sql",
    "017-trial-training.sql",
  ])
    await db.exec(readFileSync(`supabase/release/${f}`, "utf8"));
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec("begin");
  await q("insert into auth.users values($1,'coach@test.invalid',now())", [
    id(1),
  ]);
  await q("insert into profiles(id,role) values($1,'admin')", [id(1)]);
  await q("insert into staff_profiles(id,display_name) values($1,'Coach')", [
    id(1),
  ]);
  await q("insert into locations(id,name,address) values($1,'Platz','Weg 1')", [
    id(2),
  ]);
  await q("select set_config('request.jwt.claim.sub',$1,true)", [id(1)]);
  await db.exec(
    "update system_settings set value='{\"enabled\":true}' where key='trial_training_release'",
  );
});
afterEach(async () => db.exec("rollback"));
const input = (n = 10, count = 1) => ({
  request_id: id(n),
  parent_name: `Familie ${n}`,
  email: `parent${n}@test.invalid`,
  phone: `+49151100000${n}`,
  children: Array.from({ length: count }, (_, i) => ({
    first_name: `Kind ${n} ${i}`,
    last_name: "Familie",
    birth_date: `2015-01-0${i + 1}`,
    club: "",
  })),
  operational_consent: true,
  privacy_acknowledged: true,
  marketing_consent: true,
});
async function apply(n = 10, count = 1) {
  const body = input(n, count);
  await q("select create_trial_request($1,'test-ip')", [body]);
  return await q(
    "select * from trial_requests where family_id=$1 order by first_name",
    [id(n)],
  );
}
async function verify(n = 10) {
  await q("select trial_parent_action($1,$2)", [id(n), { action: "verify" }]);
}
async function event(days = 3) {
  return (
    await q(
      "insert into training_events(title,starts_at,ends_at,location_id,trainer_id,auto_attendance_at) values('Probetraining',now()+$1::int*interval '1 day',now()+$1::int*interval '1 day'+interval '1 hour',$2,$3,now()) returning *",
      [days, id(2), id(1)],
    )
  )[0];
}
async function manage(body: unknown) {
  return (await q("select manage_trial($1) id", [body]))[0].id;
}
async function rejected(sql: string, args: unknown[], message: RegExp) {
  await db.exec("savepoint rejected");
  await expect(q(sql, args)).rejects.toThrow(message);
  await db.exec("rollback to savepoint rejected");
}
async function attended() {
  const [r] = await apply();
  await verify();
  const e = await event();
  await manage({ action: "assign", request_id: r.id, event_id: e.id });
  await q(
    "update training_events set starts_at=now()-interval '4 days',ends_at=now()-interval '4 days'+interval '1 hour' where id=$1",
    [e.id],
  );
  await q("select auto_attendance()");
  await q(
    "update trial_requests set confirmed_at=now()-interval '2 days' where id=$1",
    [r.id],
  );
  return { ...r, event_id: e.id };
}

it("creates one free family request with up to three children and blocks normalized identity matches", async () => {
  const rows = await apply(10, 3);
  expect(rows).toHaveLength(3);
  await q("select create_trial_request($1,'test-ip')", [input(10, 3)]);
  expect(await q("select * from parents")).toHaveLength(1);
  expect(await q("select * from players")).toHaveLength(3);
  expect(await q("select * from notification_jobs")).toHaveLength(1);
  expect(await q("select * from subscriptions")).toHaveLength(0);
  expect(await q("select * from entitlement_periods")).toHaveLength(0);
  await rejected(
    "select create_trial_request($1,'other-ip')",
    [{ ...input(11), email: "PARENT10@test.invalid" }],
    /TRIAL_MATCH/,
  );
  await rejected(
    "select create_trial_request($1,'other-ip')",
    [{ ...input(11), parent_name: "  FAMILIE 10 " }],
    /TRIAL_MATCH/,
  );
  await rejected(
    "select create_trial_request($1,'other-ip')",
    [{ ...input(11), phone: "004915110000010" }],
    /TRIAL_MATCH/,
  );
  await rejected(
    "select create_trial_request($1,'other-ip')",
    [{ ...input(11), children: input(10).children }],
    /TRIAL_MATCH/,
  );
  await rejected(
    "select create_trial_request($1,'other-ip')",
    [input(11, 4)],
    /Pflichtangaben/,
  );
});
it("requires verified email, assigns exactly one free participation, preserves calendar editing and rescheduling", async () => {
  const [r] = await apply();
  const e = await event();
  await rejected(
    "select manage_trial($1)",
    [{ action: "assign", request_id: r.id, event_id: e.id }],
    /E-Mail/,
  );
  await verify();
  await manage({ action: "assign", request_id: r.id, event_id: e.id });
  await manage({ action: "assign", request_id: r.id, event_id: e.id });
  const ep = (await q("select * from event_participants"))[0];
  expect(ep.period_id).toBeNull();
  expect(ep.trial_request_id).toBe(r.id);
  await q("select save_training($1)", [
    {
      id: e.id,
      revision: e.revision,
      title: "Anderer Titel",
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      location_id: id(2),
      trainer_id: id(1),
      event_type: "Gruppentraining",
      player_ids: [r.player_id],
      notify_parents: true,
    },
  ]);
  await q("select plan_trial_notifications()");
  expect(
    (await q("select kind from notification_jobs order by created_at")).map(
      (r) => r.kind,
    ),
  ).toEqual(["trial_welcome", "trial_planning"]);
  const e2 = await event(5);
  await manage({ action: "assign", request_id: r.id, event_id: e2.id });
  await q("select plan_trial_notifications()");
  expect(
    (
      await q(
        "select count(*)::int n from event_participants where not removed_from_event",
      )
    )[0].n,
  ).toBe(1);
  const old = (
    await q(
      "select * from notification_jobs where kind='trial_planning' and payload->>'event_id'=$1",
      [e.id],
    )
  )[0];
  expect(
    (
      await q("select trial_delivery_allowed($1,$2,$3) allowed", [
        old.recipient,
        old.kind,
        old.payload,
      ])
    )[0].allowed,
  ).toBe(false);
});
it("holds feedback until attendance and coach approval, then stores distinct parent feedback with immutable attribution", async () => {
  const r = await attended();
  await q("select plan_trial_notifications()");
  expect(
    await q("select * from notification_jobs where kind='trial_feedback'"),
  ).toHaveLength(0);
  await manage({
    action: "review",
    request_id: r.id,
    event_id: r.event_id,
    rating: 4,
    feedback: "Guter erster Kontakt",
    ready: true,
  });
  await q("select plan_trial_notifications()");
  await q("select plan_trial_notifications()");
  expect(
    await q("select * from notification_jobs where kind='trial_feedback'"),
  ).toHaveLength(1);
  await q("select trial_parent_action($1,$2)", [
    id(10),
    {
      action: "feedback",
      request_id: r.id,
      event_id: r.event_id,
      rating: 5,
      feedback: "Hat Spaß gemacht",
    },
  ]);
  await q("select trial_parent_action($1,$2)", [
    id(10),
    { action: "feedback", request_id: r.id, event_id: r.event_id, rating: 1 },
  ]);
  const feedback = await q(
    "select author_type,rating,event_id,player_id from trial_feedback order by author_type",
  );
  expect(feedback.map((f) => [f.author_type, f.rating])).toEqual([
    ["academy", 4],
    ["parent", 5],
  ]);
  expect(
    feedback.every(
      (f) => f.event_id === r.event_id && f.player_id === r.player_id,
    ),
  ).toBe(true);
});
it("rechecks subscription and opt-out at delivery, spaces the 7/14 day sequence and cancels after corrected attendance", async () => {
  const r = await attended();
  await manage({
    action: "review",
    request_id: r.id,
    event_id: r.event_id,
    rating: 4,
    feedback: "Gute Teilnahme",
    ready: true,
  });
  await q(
    "update trial_requests set confirmed_at=now()-interval '20 days' where id=$1",
    [r.id],
  );
  await q("select plan_trial_notifications()");
  await q(
    "update notification_jobs set status='sent',updated_at=now()-interval '8 days' where kind='trial_feedback'",
  );
  // touch_updated stamps now, so temporarily disable it only for this time-travel fixture.
  await db.exec(
    "alter table notification_jobs disable trigger touch_updated;update notification_jobs set updated_at=now()-interval '8 days' where kind='trial_feedback';alter table notification_jobs enable trigger touch_updated;",
  );
  await q("select plan_trial_notifications()");
  const job = (
    await q("select * from notification_jobs where kind='trial_day7'")
  )[0];
  expect(job).toBeTruthy();
  expect(
    await q("select * from notification_jobs where kind='trial_day14'"),
  ).toHaveLength(0);
  await db.exec(
    "alter table notification_jobs disable trigger touch_updated;update notification_jobs set status='sent',updated_at=now()-interval '8 days' where kind='trial_day7';alter table notification_jobs enable trigger touch_updated;",
  );
  await q("select plan_trial_notifications()");
  expect(
    await q("select * from notification_jobs where kind='trial_day14'"),
  ).toHaveLength(1);
  const allowed = async () =>
    (
      await q("select trial_delivery_allowed($1,$2,$3) allowed", [
        job.recipient,
        job.kind,
        job.payload,
      ])
    )[0].allowed;
  expect(await allowed()).toBe(true);
  await q(
    "insert into subscriptions(id,stripe_customer_id,stripe_subscription_id,status) values($1,'cus_trial','sub_trial','active')",
    [id(90)],
  );
  await q(
    "insert into subscription_players(subscription_id,stripe_item_id,player_id) values($1,'si_trial',$2)",
    [id(90), r.player_id],
  );
  expect(await allowed()).toBe(false);
  await q("update subscriptions set status='canceled' where id=$1", [id(90)]);
  expect(await allowed()).toBe(true);
  await q("select trial_parent_action($1,$2)", [
    id(10),
    { action: "unsubscribe" },
  ]);
  expect(await allowed()).toBe(false);
  const feedback = (
    await q("select * from notification_jobs where kind='trial_feedback'")
  )[0];
  await q(
    "select set_attendance(participant_id,'absent','Korrigierte Teilnahme',false) from trial_requests where id=$1",
    [r.id],
  );
  expect(
    (
      await q("select trial_delivery_allowed($1,$2,$3) allowed", [
        feedback.recipient,
        feedback.kind,
        feedback.payload,
      ])
    )[0].allowed,
  ).toBe(false);
});
it("uses a 24h reminder only for timely scheduling, and keeps ordinary reminders out of trial participants", async () => {
  const [r] = await apply();
  await verify();
  const e = await event();
  await manage({ action: "assign", request_id: r.id, event_id: e.id });
  await q(
    "update training_events set starts_at=now()+interval '23 hours',ends_at=now()+interval '24 hours' where id=$1",
    [e.id],
  );
  await q("select plan_trial_notifications()");
  expect(
    await q("select * from notification_jobs where kind='trial_reminder'"),
  ).toHaveLength(0);
  await q(
    "update trial_requests set scheduled_at=now()-interval '2 days' where id=$1",
    [r.id],
  );
  await q("select plan_trial_notifications()");
  await q("select plan_trial_notifications()");
  await q("select plan_training_reminders()");
  expect(
    await q("select * from notification_jobs where kind='trial_reminder'"),
  ).toHaveLength(1);
  expect(
    await q("select * from notification_jobs where kind='training_reminder'"),
  ).toHaveLength(0);
});
it("protects trial data and prevents session roles bypassing public identity checks", async () => {
  const [r] = await apply();
  await verify();
  const checks = (
    await q(
      "select has_table_privilege('authenticated','trial_families','select') families,has_function_privilege('authenticated','create_trial_request(jsonb,text)','execute') create_request,has_function_privilege('authenticated','trial_parent_action(uuid,jsonb)','execute') parent_action,has_function_privilege('authenticated','manage_trial(jsonb)','execute') manage",
    )
  )[0];
  expect(checks).toEqual({
    families: false,
    create_request: false,
    parent_action: false,
    manage: true,
  });
  await q("select set_config('request.jwt.claim.sub',$1,true)", [id(999)]);
  await rejected(
    "select manage_trial($1)",
    [{ action: "note", request_id: r.id, note: "forged", status: "closed" }],
    /Forbidden/,
  );
  await rejected(
    "select trial_parent_action($1,$2)",
    [
      id(999),
      { action: "feedback", request_id: r.id, event_id: id(3), rating: 5 },
    ],
    /Zugang/,
  );
});

it("marks an existing planned child for free, captures missing birth date, and keeps closed requests closed", async () => {
  await q(
    "insert into parents(id,full_name,contact_email) values($1,'Bestehende Familie','existing@test.invalid')",
    [id(60)],
  );
  await q(
    "insert into players(id,first_name,last_name,birth_year) values($1,'Bestehendes','Kind',2015)",
    [id(61)],
  );
  await q("insert into parent_players(parent_id,player_id) values($1,$2)", [
    id(60),
    id(61),
  ]);
  await q(
    "insert into subscriptions(id,stripe_customer_id,stripe_subscription_id,status) values($1,'cus_manual','sub_manual','active')",
    [id(62)],
  );
  const [period] = await q(
    "insert into entitlement_periods(player_id,subscription_id,stripe_customer_id,stripe_item_id,stripe_price_id,product_name,starts_at,ends_at,included_units) values($1,$2,'cus_manual','si_manual','price_manual','GameChanger',now()-interval '1 year',now()+interval '1 year',8) returning id",
    [id(61), id(62)],
  );
  const e = await event();
  const [ep] = await q(
    "insert into event_participants(event_id,player_id,period_id) values($1,$2,$3) returning id",
    [e.id, id(61), period.id],
  );
  const input = {
    action: "mark",
    participant_id: ep.id,
    operational_consent: true,
  };
  await rejected("select manage_trial($1)", [input], /Geburtsdatum/);
  const rid = await manage({ ...input, birth_date: "2015-04-05" });
  expect(await manage(input)).toBe(rid);
  expect(
    (
      await q(
        "select period_id,trial_request_id from event_participants where id=$1",
        [ep.id],
      )
    )[0],
  ).toEqual({ period_id: null, trial_request_id: rid });
  expect(
    (
      await q("select camp_birth_date::text birth from players where id=$1", [
        id(61),
      ])
    )[0].birth,
  ).toBe("2015-04-05");
  expect(await q("select * from players")).toHaveLength(1);
  await manage({
    action: "note",
    request_id: rid,
    note: "Abgeschlossen",
    status: "closed",
  });
  await q(
    "update training_events set starts_at=now()-interval '2 days',ends_at=now()-interval '2 days'+interval '1 hour' where id=$1",
    [e.id],
  );
  await q("select set_attendance($1,'attended_manual','Teilgenommen',false)", [
    ep.id,
  ]);
  expect(
    (await q("select status from trial_requests where id=$1", [rid]))[0].status,
  ).toBe("closed");
  await rejected("select manage_trial($1)", [input], /Teilnahmebestätigung/);
  await q("select plan_trial_notifications()");
  expect(
    await q("select * from notification_jobs where kind='trial_feedback'"),
  ).toHaveLength(0);
});
