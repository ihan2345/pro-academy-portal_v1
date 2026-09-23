import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
const staff = randomUUID(),
  parent = randomUUID(),
  foreign = randomUUID(),
  child = randomUUID(),
  subscription = randomUUID();
async function query<T = any>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
async function asUser(id: string, sql: string, params: unknown[] = []) {
  await db.exec("begin; set local role authenticated;");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    const rows = await query(sql, params);
    await db.exec("commit");
    return rows;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
async function period(active = false, units = 8) {
  return (
    await query(
      `insert into entitlement_periods(player_id,subscription_id,stripe_customer_id,stripe_item_id,stripe_price_id,product_name,starts_at,ends_at,included_units,athletics_units)
    values($1,$2,'cus_v2',$3,'price_v2','Test',now()-interval '20 days',${active ? "now()+interval '10 days'" : "now()-interval '1 day'"},$4,1) returning id`,
      [child, subscription, randomUUID(), units],
    )
  )[0].id;
}
const input = (period_id: string, extra = {}) => ({
  request_id: randomUUID(),
  period_id,
  event_type: "Gruppentraining",
  duration_minutes: 90,
  parent_note: "Information für Eltern",
  internal_note: "SECRET INTERNAL",
  notify_parents: false,
  ...extra,
});
const save = async (data: object, actor = staff) =>
  (
    await asUser(
      actor,
      "select save_training_backfill($1::jsonb,'491234') id",
      [JSON.stringify(data)],
    )
  )[0].id;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema storage; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,service_role; grant execute on function auth.uid() to authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.exec(readFileSync("supabase/seed.sql", "utf8"));
  for (const [id, role] of [
    [staff, "staff"],
    [parent, "parent"],
    [foreign, "parent"],
  ]) {
    await query("insert into auth.users values($1,$2,now())", [
      id,
      `${id}@test.invalid`,
    ]);
    await query("insert into profiles(id,role) values($1,$2)", [id, role]);
  }
  await query(
    "insert into staff_profiles(id,display_name) values($1,'Coach')",
    [staff],
  );
  await query(
    "insert into players(id,first_name,last_name) values($1,'Test','Kind')",
    [child],
  );
  const [{ id }] = await query(
    "insert into parents(auth_user_id,full_name,contact_email) values($1,'Parent','parent@test.invalid') returning id",
    [parent],
  );
  await query("insert into parent_players(parent_id,player_id) values($1,$2)", [
    id,
    child,
  ]);
  await query(
    "insert into subscriptions(id,stripe_customer_id,stripe_subscription_id,status) values($1,'cus_v2','sub_v2','active')",
    [subscription],
  );
});
afterAll(async () => {
  await db?.close();
});

it("saves only notes and hours, isolates private notes and prevents parent writes", async () => {
  const p = await period(true);
  const data = input(p);
  await expect(save(data, parent)).rejects.toThrow("Forbidden");
  const id = await save(data);
  const own = await asUser(
    parent,
    "select * from training_backfills where id=$1",
    [id],
  );
  expect(own[0].duration_minutes).toBe(90);
  expect(own[0].occurred_on).toBeNull();
  expect(JSON.stringify(own)).not.toContain("SECRET");
  expect(
    await asUser(parent, "select * from training_backfill_private_notes"),
  ).toHaveLength(0);
  expect(
    await asUser(foreign, "select * from training_backfills"),
  ).toHaveLength(0);
  expect(
    (
      await asUser(
        staff,
        "select note from training_backfill_private_notes where id=$1",
        [id],
      )
    )[0].note,
  ).toBe("SECRET INTERNAL");
  await expect(
    asUser(
      staff,
      "update training_backfills set duration_minutes=999 where id=$1",
      [id],
    ),
  ).rejects.toThrow(/permission denied/);
  expect(
    await query("select * from report_snapshots where period_id=$1", [p]),
  ).toHaveLength(0);
  expect(
    await query(
      "select * from notification_jobs where payload->>'backfill_id'=$1",
      [id],
    ),
  ).toHaveLength(0);
});
it("creates immutable report versions atomically, with no hidden mail when unchecked", async () => {
  const p = await period();
  const data = input(p);
  const first = await save(data);
  expect(await save(data)).toBe(first);
  const original = (
    await query("select * from report_snapshots where period_id=$1", [p])
  )[0];
  expect(original.snapshot.completed).toBe(1);
  expect(original.snapshot.minutes).toBe(90);
  expect(original.snapshot.events[0].retrospective).toBe(true);
  expect(JSON.stringify(original.snapshot)).not.toContain("SECRET");
  await query("select register_report_file($1,'v2/test.pdf','digest')", [
    original.id,
  ]);
  expect(
    await query(
      "select * from notification_jobs where payload->>'snapshot_id'=$1",
      [original.id],
    ),
  ).toHaveLength(0);
  await save(input(p, { duration_minutes: 60 }));
  const versions = await query(
    "select * from report_snapshots where period_id=$1 order by version",
    [p],
  );
  expect(versions.map((r) => r.version)).toEqual([1, 2]);
  expect(versions[0]).toEqual(original);
  expect(versions[1].snapshot.completed).toBe(2);
  expect(versions[1].snapshot.minutes).toBe(150);
});
it("queues exactly one dedicated parent notification with public note on retries", async () => {
  const p = await period();
  const data = input(p, { notify_parents: true });
  const id = await save(data);
  await save(data);
  const jobs = await query(
    "select * from notification_jobs where payload->>'backfill_id'=$1",
    [id],
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0].kind).toBe("training_backfill");
  expect(jobs[0].payload.parent_note).toBe(data.parent_note);
  expect(jobs[0].payload.snapshot_id).toBeTruthy();
  expect(JSON.stringify(jobs)).not.toContain("SECRET");
  const [snapshot] = await query(
    "select id from report_snapshots where period_id=$1",
    [p],
  );
  await query("select register_report_file($1,'v2/checked.pdf','digest')", [
    snapshot.id,
  ]);
  expect(
    await query(
      "select * from notification_jobs where payload->>'snapshot_id'=$1",
      [snapshot.id],
    ),
  ).toHaveLength(1);
});
it("rejects invalid duration, blank public note, invalid dates and missing IDs atomically", async () => {
  const p = await period();
  for (const extra of [
    { duration_minutes: 0 },
    { duration_minutes: 721 },
    { parent_note: " " },
    { occurred_on: "2099-01-01" },
    { occurred_on: "2000-01-01" },
    { request_id: null },
  ]) {
    await expect(save(input(p, extra))).rejects.toThrow();
  }
  expect(
    await query("select * from training_backfills where period_id=$1", [p]),
  ).toHaveLength(0);
  expect(
    await query("select * from report_snapshots where period_id=$1", [p]),
  ).toHaveLength(0);
});
it("respects separate football and athletics slots and refuses stale full cards", async () => {
  const p = await period(true, 2);
  await save(input(p));
  await expect(save(input(p))).rejects.toThrow("Kein offener Stempel");
  await save(input(p, { event_type: "Athletiktraining" }));
  await expect(
    save(input(p, { event_type: "Athletiktraining" })),
  ).rejects.toThrow("Kein offener Stempel");
});
it("retains ordinary scheduled report delivery", async () => {
  const p = await period();
  const [{ id }] = await query("select capture_report($1) id", [p]);
  await query("select register_report_file($1,'v2/standard.pdf','digest')", [
    id,
  ]);
  expect(
    await query(
      "select * from notification_jobs where payload->>'snapshot_id'=$1",
      [id],
    ),
  ).toHaveLength(1);
});
it("preserves first observation when registry identity is refreshed", async () => {
  await query(
    "insert into stripe_customer_registry(id,first_seen_at) values('cus_old','2020-01-01')",
  );
  await query("select observe_stripe_customers($1::jsonb)", [
    JSON.stringify([
      { id: "cus_old", name: "New Name", email: "new@test.invalid" },
      { id: "cus_new", name: "New" },
    ]),
  ]);
  const [row] = await query(
    "select * from stripe_customer_registry where id='cus_old'",
  );
  expect(new Date(row.first_seen_at).getUTCFullYear()).toBe(2020);
  expect(row.name).toBe("New Name");
  expect(
    await asUser(parent, "select * from stripe_customer_registry"),
  ).toHaveLength(0);
  await expect(
    asUser(staff, "select observe_stripe_customers('[]')"),
  ).rejects.toThrow(/permission denied/);
});
it("observes webhook arrival time, independent of Stripe creation time", async () => {
  await query(
    `insert into stripe_webhook_events(stripe_event_id,type,payload,stripe_created,created_at) values('evt_v2','customer.updated','{"data":{"object":{"object":"customer","id":"cus_webhook"}}}',1,'2024-02-03')`,
  );
  const [row] = await query(
    "select * from stripe_customer_registry where id='cus_webhook'",
  );
  expect(new Date(row.first_seen_at).toISOString()).toBe(
    "2024-02-03T00:00:00.000Z",
  );
});

it("rejects altered retries and preserves the original entry", async () => {
  const p = await period(true);
  const data = input(p);
  await save(data);
  await expect(
    save({ ...data, parent_note: "Other public note" }),
  ).rejects.toThrow("anderen Angaben");
  expect(
    (
      await query(
        "select parent_note from training_backfills where period_id=$1",
        [p],
      )
    )[0].parent_note,
  ).toBe(data.parent_note);
});

async function trainingInPeriod(periodId: string, status = "planned") {
  const [{ id: location }] = await query("select id from locations limit 1");
  const [{ id: event }] = await query(
    `insert into training_events(title,starts_at,ends_at,location_id,trainer_id,auto_attendance_at,notify_parents)
    values('Cancellation test',now()-interval '5 days',now()-interval '5 days'+interval '1 hour',$1,$2,now()-interval '4 days',false) returning id`,
    [location, staff],
  );
  const [{ id: participant }] = await query(
    "insert into event_participants(event_id,player_id,period_id,status) values($1,$2,$3,$4) returning id",
    [event, child, periodId, status],
  );
  return { event, participant };
}

it("team cancellation frees backfill capacity; individual cancellations still consume a slot", async () => {
  const p = await period(true, 2); // One football slot and one athletics slot.
  const { event } = await trainingInPeriod(p, "cancelled");
  await expect(save(input(p))).rejects.toThrow("Kein offener Stempel");
  await expect(
    asUser(parent, "select cancel_training($1,'Teamabsage')", [event]),
  ).rejects.toThrow("Forbidden");
  await asUser(staff, "select cancel_training($1,'Teamabsage')", [event]);
  await expect(save(input(p))).resolves.toEqual(expect.any(String));
  await expect(save(input(p))).rejects.toThrow("Kein offener Stempel");
  expect(
    await query("select status from event_participants where event_id=$1", [
      event,
    ]),
  ).toEqual([{ status: "cancelled" }]);
});

it("team cancellation creates one corrected report version and does not send a report email", async () => {
  const p = await period();
  const { event } = await trainingInPeriod(p, "attended_manual");
  await query("select capture_report($1)", [p]);
  const [original] = await query(
    "select * from report_snapshots where period_id=$1",
    [p],
  );
  expect(original.snapshot).toMatchObject({ completed: 1, minutes: 60 });
  await asUser(staff, "select cancel_training($1,'Teamabsage')", [event]);
  const reports = await query(
    "select * from report_snapshots where period_id=$1 order by version",
    [p],
  );
  expect(reports).toHaveLength(2);
  expect(reports[0]).toEqual(original);
  expect(reports[1].snapshot).toMatchObject({
    completed: 0,
    minutes: 0,
    version: 2,
    suppress_delivery: true,
    attendance_policy: "team_cancellations_free_v2",
    events: [{ status: "cancelled", event_cancelled: true }],
  });
  const jobsBefore = await query(
    "select id from notification_jobs order by id",
  );
  await asUser(staff, "select cancel_training($1,'Teamabsage wiederholt')", [
    event,
  ]);
  await query(
    "select register_report_file($1,'test/team-cancellation.pdf','test-digest')",
    [reports[1].id],
  );
  expect(await query("select id from notification_jobs order by id")).toEqual(
    jobsBefore,
  );
  expect(
    await query("select id from report_snapshots where period_id=$1", [p]),
  ).toHaveLength(2);
  await expect(
    asUser(staff, "select cancel_training($1,'Teamabsage')", [randomUUID()]),
  ).rejects.toThrow("Termin nicht gefunden");
});

it("migrates existing cancelled reports once without changing old versions or sending mail", async () => {
  const p = await period();
  const { event } = await trainingInPeriod(p, "cancelled");
  await query("update training_events set status='cancelled' where id=$1", [
    event,
  ]);
  // Reproduce a pre-migration snapshot through the old capture function.
  const oldSql = readFileSync(
    "supabase/migrations/202609230010_training_backfills.sql",
    "utf8",
  );
  await db.exec(
    oldSql.slice(
      oldSql.indexOf("create or replace function public.capture_report"),
      oldSql.indexOf("create or replace function public.register_report_file"),
    ),
  );
  await query("select capture_report($1)", [p]);
  const [original] = await query(
    "select * from report_snapshots where period_id=$1",
    [p],
  );
  expect(original.snapshot.completed).toBe(1);
  const jobsBefore = await query(
    "select id from notification_jobs order by id",
  );
  const migration = readFileSync(
    "supabase/migrations/202609230012_team_cancellations.sql",
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
  const reports = await query(
    "select * from report_snapshots where period_id=$1 order by version",
    [p],
  );
  expect(reports).toHaveLength(2);
  expect(reports[0]).toEqual(original);
  expect(reports[1].snapshot).toMatchObject({
    completed: 0,
    minutes: 0,
    suppress_delivery: true,
  });
  expect(await query("select id from notification_jobs order by id")).toEqual(
    jobsBefore,
  );
});
