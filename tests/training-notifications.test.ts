import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";

let db: PGlite;
const id = (n: number) =>
  `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create schema storage;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
  create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  // Match the live release order: base schema, onboarding/Camp, then V2.
  const migrations = readdirSync("supabase/migrations").sort();
  for (const f of migrations.filter((f) => f < "202609230010"))
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec(
    readFileSync("supabase/release/001-onboarding-mail.sql", "utf8"),
  );
  for (const f of readdirSync("supabase/camp")
    .filter((f) => /^00[1-9]-/.test(f) && f !== "001-down.sql")
    .sort())
    await db.exec(readFileSync(`supabase/camp/${f}`, "utf8"));
  await db.exec(readFileSync("supabase/camp/010-team-import.sql", "utf8"));
  for (const f of migrations.filter((f) => f >= "202609230010"))
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec(
    readFileSync("supabase/release/002-v2-backfill-mail.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/release/005-training-notifications.sql", "utf8"),
  );
  await db.exec(
    readFileSync(
      "supabase/release/006-manual-training-recipient-exception.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      "supabase/release/007-staff-training-confirmations.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync("supabase/release/008-training-planning-grace.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/release/009-parent-email-preference.sql", "utf8"),
  );
});
afterAll(async () => db.close());
const query = async (sql: string, args: unknown[] = []) =>
  (await db.query<any>(sql, args)).rows;
beforeEach(async () => {
  await db.exec("begin");
  await db.query(
    "insert into auth.users values($1,'coach@test.invalid',now())",
    [id(1)],
  );
  await db.query("insert into profiles(id,role) values($1,'admin')", [id(1)]);
  await db.query(
    "insert into staff_profiles(id,display_name) values($1,'Trainer')",
    [id(1)],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id(1)]);
  await db.query(
    "insert into locations(id,name,address) values($1,'Platz','Weg 1'),($2,'Halle','Weg 2')",
    [id(2), id(3)],
  );
  for (const n of [1, 2, 3]) {
    await db.query("insert into auth.users values($1,$2,now())", [
      id(100 + n),
      `parent${n}@test.invalid`,
    ]);
    await db.query("insert into profiles(id,role) values($1,'parent')", [
      id(100 + n),
    ]);
    await db.query(
      "insert into players(id,first_name,last_name,birth_year) values($1,$2,'Kind',2015)",
      [id(10 + n), "Kind " + n],
    );
    await db.query(
      "insert into parents(id,full_name,contact_email,auth_user_id,notifications_held) values($1,'Eltern',$2,$3,false)",
      [id(20 + n), `parent${n}@test.invalid`, id(100 + n)],
    );
    await db.query(
      "insert into parent_players(parent_id,player_id) values($1,$2)",
      [id(20 + n), id(10 + n)],
    );
  }
  await db.query(
    "insert into subscriptions(id,stripe_customer_id,stripe_subscription_id,status) values($1,'cus_test','sub_test','active')",
    [id(30)],
  );
  for (const n of [1, 2, 3])
    await db.query(
      "insert into entitlement_periods(player_id,subscription_id,stripe_customer_id,stripe_item_id,stripe_price_id,product_name,starts_at,ends_at,included_units) values($1,$2,'cus_test',$3,'price_test','GameChanger',now()-interval '1 year',now()+interval '1 year',8)",
      [id(10 + n), id(30), "si_" + n],
    );
  await db.query(
    "update system_settings set value=$1 where key='portal_delivery_release'",
    [
      {
        enabled: true,
        recipients: [1, 2, 3].map((n) => `parent${n}@test.invalid`),
        invitation_recipients: [],
      },
    ],
  );
  await db.exec(
    "update system_settings set value=jsonb_build_object('starts_after',now()-interval '2 days') where key='training_reminder_release'",
  );
});
afterEach(async () => db.exec("rollback"));
async function save(
  children = [1],
  event?: string,
  overrides: Record<string, unknown> = {},
) {
  const prior = event
    ? (await query("select * from training_events where id=$1", [event]))[0]
    : null;
  const input = {
    id: event,
    revision: prior?.revision,
    title: prior?.title ?? "Training",
    starts_at:
      prior?.starts_at ?? new Date(Date.now() + 3 * 86400000).toISOString(),
    ends_at:
      prior?.ends_at ??
      new Date(Date.now() + 3 * 86400000 + 3600000).toISOString(),
    location_id: prior?.location_id ?? id(2),
    trainer_id: id(1),
    event_type: "Gruppentraining",
    notify_parents: true,
    player_ids: children.map((n) => id(10 + n)),
    ...overrides,
  };
  return (await query("select save_training($1) id", [input]))[0].id as string;
}
async function deactivate(n = 1) {
  await db.query(
    "update parents set auth_user_id=null,notifications_held=true where id=$1",
    [id(20 + n)],
  );
}
async function options(event: string) {
  return (
    await query("select training_notification_options($1) result", [event])
  )[0].result;
}
const choice = (n: number, kind = "planning") => ({
  parent_id: id(20 + n),
  player_id: id(10 + n),
  kind,
});
async function submit(event: string, selections: ReturnType<typeof choice>[]) {
  return (
    await query("select submit_training_notifications($1,$2) result", [
      event,
      selections,
    ])
  )[0].result;
}
async function manual(event: string) {
  const preview = await options(event);
  const result = await submit(
    event,
    preview.rows
      .filter((r: any) => r.kind === "planning" && !r.activated)
      .map(({ parent_id, player_id, kind }: any) => ({
        parent_id,
        player_id,
        kind,
      })),
  );
  return { queued: result.queued, blocked: result.blocked };
}
const pending = () =>
  query(
    "select * from notification_jobs where status='pending' order by recipient,created_at,id",
  );
async function sendAll() {
  const sent = [];
  for (let pass = 0; pass < 5; pass++) {
    const jobs = await query("select * from claim_notifications(100)");
    if (!jobs.length) break;
    for (const job of jobs) {
      const ready = (
        await query(
          `select ${job.kind === "training_staff_attendance" ? "prepare_staff_training_notification" : "prepare_training_notification"}($1,$2) job`,
          [job.id, job.lease_token],
        )
      )[0].job;
      if (!ready) continue;
      await query("select finish_notification($1)", [
        {
          id: job.id,
          lease_token: job.lease_token,
          status: "sent",
          provider: "proton",
          recipient: job.recipient,
          message_id: "local-test",
        },
      ]);
      sent.push(ready);
    }
  }
  return sent;
}
it("sends first plans only to newly added children, not existing families", async () => {
  const event = await save();
  expect((await sendAll()).map((j) => j.kind)).toEqual(["planning"]);
  await save([1, 2], event);
  expect((await pending()).map((j) => [j.kind, j.recipient])).toEqual([
    ["planning", "parent2@test.invalid"],
  ]);
  await save([1, 2], event, { note: "Interne Notiz" });
  expect(await pending()).toHaveLength(1);
  expect((await sendAll()).map((j) => j.recipient)).toEqual([
    "parent2@test.invalid",
  ]);
  await save([1, 2], event);
  expect(await pending()).toHaveLength(0);
});
it("coalesces unsent plans and only sends updates to families already informed", async () => {
  const event = await save([1, 2]);
  const first = (await pending())[0].id;
  await save([1, 2], event, { location_id: id(3) });
  expect(await pending()).toHaveLength(2);
  expect((await pending())[0].id).toBe(first);
  expect((await sendAll()).map((j) => j.kind)).toEqual([
    "planning",
    "planning",
  ]);
  await save([1, 2, 3], event, { title: "Neuer Titel" });
  expect((await sendAll()).map((j) => [j.recipient, j.kind]).sort()).toEqual([
    ["parent1@test.invalid", "change"],
    ["parent2@test.invalid", "change"],
    ["parent3@test.invalid", "planning"],
  ]);
});
it("notifies only a removed child and never sends a second initial plan when re-added", async () => {
  const event = await save([1, 2]);
  await sendAll();
  await save([1], event);
  expect((await sendAll()).map((j) => [j.recipient, j.kind]).sort()).toEqual([
    ["parent2@test.invalid", "training_removed"],
  ]);
  await save([1, 2], event);
  expect((await sendAll()).map((j) => [j.recipient, j.kind]).sort()).toEqual([
    ["parent2@test.invalid", "change"],
  ]);
});
it("drops unsent plans on removal and coalesces remove/re-add before delivery", async () => {
  const event = await save([1, 2]);
  await save([1], event);
  expect((await sendAll()).map((j) => j.recipient)).toEqual([
    "parent1@test.invalid",
  ]);
  await save([1, 2], event);
  expect((await sendAll()).map((j) => j.kind)).toEqual(["planning"]);
  await save([1], event);
  await save([1, 2], event);
  expect(await pending()).toHaveLength(0);
});
it("keeps global releases and other mail gates for manually requested plans", async () => {
  await deactivate();
  const event = await save();
  await manual(event);
  const job = (await pending())[0];
  expect(
    (
      await query("select parent_delivery_allowed($1,$2,$3) ok", [
        job.recipient,
        "planning",
        job.payload,
      ])
    )[0].ok,
  ).toBe(true);
  for (const kind of [
    "report",
    "stamp_card",
    "training_backfill",
    "invitation",
  ])
    expect(
      (
        await query("select parent_delivery_allowed($1,$2,$3) ok", [
          job.recipient,
          kind,
          job.payload,
        ])
      )[0].ok,
    ).toBe(false);
  await db.exec(
    "update system_settings set value=jsonb_set(value,'{enabled}','false') where key='portal_delivery_release'",
  );
  expect(await query("select * from claim_notifications(100)")).toHaveLength(0);
  await db.exec(
    "update system_settings set value=jsonb_set(value,'{enabled}','true') where key='portal_delivery_release'",
  );
  const claimed = (await query("select * from claim_notifications(100)"))[0];
  await db.query("delete from parent_players where player_id=$1", [id(11)]);
  expect(
    (
      await query("select prepare_training_notification($1,$2) job", [
        claimed.id,
        claimed.lease_token,
      ])
    )[0].job,
  ).toBeNull();
});
it("serializes concurrent followups and stops on uncertain SMTP results", async () => {
  const event = await save();
  const claimed = (await query("select * from claim_notifications(100)"))[0];
  await save([1], event, { location_id: id(3) });
  expect(await query("select * from claim_notifications(100)")).toHaveLength(0);
  await query("select finish_notification($1)", [
    {
      id: claimed.id,
      lease_token: claimed.lease_token,
      status: "uncertain",
      provider: "proton",
      recipient: claimed.recipient,
    },
  ]);
  expect(await query("select * from claim_notifications(100)")).toHaveLength(0);
});
it("rechecks stale claimed snapshots and sends just the latest plan", async () => {
  const event = await save();
  const claimed = (await query("select * from claim_notifications(100)"))[0];
  await save([1], event, { location_id: id(3) });
  expect(
    (
      await query("select prepare_training_notification($1,$2) job", [
        claimed.id,
        claimed.lease_token,
      ])
    )[0].job,
  ).toBeNull();
  const sent = await sendAll();
  expect(sent).toHaveLength(1);
  expect(sent[0].kind).toBe("planning");
  expect(sent[0].payload.notice_details.location_name).toBe("Halle");
});
async function dueReminder(children = [1]) {
  const start = new Date(Date.now() + 23 * 3600000).toISOString(),
    end = new Date(Date.now() + 24 * 3600000).toISOString();
  const event = await save(children, undefined, {
    starts_at: start,
    ends_at: end,
  });
  await sendAll();
  await db.query(
    "update event_participants set mail_joined_at=now()-interval '2 days' where event_id=$1",
    [event],
  );
  return event;
}
it("queues one 24h reminder per child/recipient and excludes short-notice additions", async () => {
  const event = await dueReminder();
  await save([1, 2], event);
  await sendAll();
  expect((await query("select plan_training_reminders() n"))[0].n).toBe(1);
  expect((await query("select plan_training_reminders() n"))[0].n).toBe(0);
  expect((await sendAll()).map((j) => [j.kind, j.recipient])).toEqual([
    ["training_reminder", "parent1@test.invalid"],
  ]);
  expect((await query("select plan_training_reminders() n"))[0].n).toBe(0);
});
it("delays reminders after rescheduling, while allowing the change mail to go first", async () => {
  const event = await dueReminder();
  await query("select plan_training_reminders()");
  await save([1], event, {
    starts_at: new Date(Date.now() + 72 * 3600000).toISOString(),
    ends_at: new Date(Date.now() + 73 * 3600000).toISOString(),
  });
  expect((await sendAll()).map((j) => j.kind)).toEqual(["change"]);
  const reminders = await query(
    "select * from notification_jobs where kind='training_reminder'",
  );
  expect(reminders[0].status).toBe("pending");
  expect(new Date(reminders[0].available_at).getTime()).toBeGreaterThan(
    Date.now() + 47 * 3600000,
  );
});
it("does not send reminders for removed/cancelled or opted-out trainings", async () => {
  const event = await dueReminder([1, 2]);
  await query("select plan_training_reminders()");
  await save([1], event);
  await db.query("update training_events set status='cancelled' where id=$1", [
    event,
  ]);
  expect(await sendAll()).toHaveLength(0);
});
it("retains manual/automatic attendance and their twelve-active-hour deadline", async () => {
  const event = await save([1], undefined, {
    starts_at: new Date(Date.now() - 3 * 3600000).toISOString(),
    ends_at: new Date(Date.now() - 2 * 3600000).toISOString(),
  });
  const ep = (
    await query("select * from event_participants where event_id=$1", [event])
  )[0];
  await query("select set_attendance($1,'attended_manual','Anwesend',false)", [
    ep.id,
  ]);
  expect((await pending()).filter((j) => j.kind === "attendance")).toHaveLength(
    1,
  );
  await query("select set_attendance($1,'attended_manual','Anwesend',false)", [
    ep.id,
  ]);
  expect((await pending()).filter((j) => j.kind === "attendance")).toHaveLength(
    1,
  );
  const example = await query(
    "select calculate_auto_at('2026-10-05 18:00 Europe/Berlin'::timestamptz) at time zone 'Europe/Berlin' deadline",
  );
  expect(new Date(example[0].deadline).getHours()).toBe(12);
});
it("does not grant public access to delivery helpers", async () => {
  const rows = await query(
    "select has_function_privilege('authenticated','public.queue_training_notice(uuid,uuid,boolean,boolean,uuid)','execute') allowed",
  );
  expect(rows[0].allowed).toBe(false);
});
it("does not hold permitted training mail again when onboarding marks a parent as held", async () => {
  await deactivate();
  const event = await save();
  await manual(event);
  await db.query("update parents set notifications_held=true where id=$1", [
    id(21),
  ]);
  expect((await pending()).map((j) => j.kind)).toEqual(["planning"]);
  await db.query(
    "insert into auth.users values($1,'parent1@test.invalid',now())",
    [id(51)],
  );
  await db.query("insert into profiles(id,role) values($1,'parent')", [id(51)]);
  await db.query(
    "update parents set auth_user_id=$1,notifications_held=true where id=$2",
    [id(51), id(21)],
  );
  expect(await pending()).toHaveLength(0);
});
it("does not resend plans when a parent activates the portal later", async () => {
  await deactivate();
  const event = await save();
  await manual(event);
  await sendAll();
  await db.query(
    "insert into auth.users values($1,'parent1@test.invalid',now())",
    [id(51)],
  );
  await db.query("insert into profiles(id,role) values($1,'parent')", [id(51)]);
  await db.query(
    "update parents set auth_user_id=$1,notifications_held=false where id=$2",
    [id(51), id(21)],
  );
  await save([1], event);
  expect(await pending()).toHaveLength(0);
});
it("brings a deferred unsent reminder forward again, without scheduling a second sent reminder", async () => {
  const event = await dueReminder();
  await query("select plan_training_reminders()");
  await save([1], event, {
    starts_at: new Date(Date.now() + 72 * 3600000).toISOString(),
    ends_at: new Date(Date.now() + 73 * 3600000).toISOString(),
  });
  await sendAll();
  await save([1], event, {
    starts_at: new Date(Date.now() + 23 * 3600000).toISOString(),
    ends_at: new Date(Date.now() + 24 * 3600000).toISOString(),
  });
  await query("select plan_training_reminders()");
  expect(
    (await sendAll()).filter((j) => j.kind === "training_reminder"),
  ).toHaveLength(1);
  await save([1], event, {
    starts_at: new Date(Date.now() + 22 * 3600000).toISOString(),
    ends_at: new Date(Date.now() + 23 * 3600000).toISOString(),
  });
  await query("select plan_training_reminders()");
  expect(
    (await sendAll()).filter((j) => j.kind === "training_reminder"),
  ).toHaveLength(0);
});
it("stops reminder transmission if details change during mail composition", async () => {
  const event = await dueReminder();
  await query("select plan_training_reminders()");
  const claimed = (await query("select * from claim_notifications(100)"))[0];
  const prepared = (
    await query("select prepare_training_notification($1,$2) job", [
      claimed.id,
      claimed.lease_token,
    ])
  )[0].job;
  await save([1], event, { location_id: id(3) });
  expect(
    (
      await query("select prepare_training_notification($1,$2,$3) job", [
        claimed.id,
        claimed.lease_token,
        prepared.payload.notice_details,
      ])
    )[0].job,
  ).toBeNull();
  expect(
    (await sendAll()).filter((j) => j.kind === "training_reminder")[0].payload
      .notice_details.location_name,
  ).toBe("Halle");
});
it("preserves released invitations/reports and never flushes historical held jobs", async () => {
  const event = await save();
  const initial = (await pending())[0];
  await db.query("update notification_jobs set status='held' where id=$1", [
    initial.id,
  ]);
  await db.query(
    "insert into auth.users values($1,'parent1@test.invalid',now())",
    [id(51)],
  );
  await db.query("insert into profiles(id,role) values($1,'parent')", [id(51)]);
  await db.query(
    "update parents set auth_user_id=$1,notifications_held=false where id=$2",
    [id(51), id(21)],
  );
  await db.query(
    "insert into parent_invitations(id,parent_id,email,token_hash,expires_at) values($1,$2,'parent1@test.invalid','hash',now()+interval '1 day')",
    [id(61), id(21)],
  );
  await db.exec(
    `update system_settings set value=jsonb_set(value,'{invitation_recipients}','["parent1@test.invalid"]') where key='portal_delivery_release'`,
  );
  for (const kind of [
    "report",
    "stamp_card",
    "training_backfill",
    "invitation",
    "camp_booking_confirmation",
    "camp_reminder_24h",
  ]) {
    const body = {
      ...initial.payload,
      manual_release: true,
      invitation_id: id(61),
      booking_id: id(91),
    };
    const [row] = await query(
      "select parent_delivery_allowed($1,$2,$3) current,parent_delivery_allowed_before_training($1,$2,$3) previous",
      ["parent1@test.invalid", kind, body],
    );
    expect(row.current).toBe(row.previous);
    if (
      ["report", "stamp_card", "training_backfill", "invitation"].includes(kind)
    )
      expect(row.current).toBe(true);
  }
  expect(await query("select * from claim_notifications(100)")).toHaveLength(0);
  expect(
    (
      await query("select status from notification_jobs where id=$1", [
        initial.id,
      ])
    )[0].status,
  ).toBe("held");
});
it("does not mistake captured or test-redirected mail for a planning delivered to the parent", async () => {
  const event = await save([1, 2]);
  const jobs = await query("select * from claim_notifications(100)");
  for (const job of jobs)
    await query("select finish_notification($1)", [
      {
        id: job.id,
        lease_token: job.lease_token,
        status: "sent",
        provider:
          job.recipient === "parent1@test.invalid" ? "capture" : "proton",
        recipient: "test-inbox@test.invalid",
      },
    ]);
  await save([1, 2], event, { location_id: id(3) });
  expect((await sendAll()).map((j) => j.kind)).toEqual([
    "planning",
    "planning",
  ]);
});
it("sends unactivated parents no automatic training mail and the event button skips activated parents", async () => {
  await deactivate(2);
  const event = await save([1, 2]);
  expect((await sendAll()).map((j) => j.recipient)).toEqual([
    "parent1@test.invalid",
  ]);
  expect(await manual(event)).toEqual({ queued: 1, blocked: 0 });
  expect(await manual(event)).toEqual({ queued: 0, blocked: 0 });
  expect((await sendAll()).map((j) => [j.recipient, j.kind])).toEqual([
    ["parent2@test.invalid", "planning"],
  ]);
  expect(await manual(event)).toEqual({ queued: 0, blocked: 0 });
  await save([1, 2], event, { location_id: id(3) });
  expect((await sendAll()).map((j) => j.recipient)).toEqual([
    "parent1@test.invalid",
  ]);
  expect(await manual(event)).toEqual({ queued: 1, blocked: 0 });
  expect((await sendAll()).map((j) => [j.recipient, j.kind])).toEqual([
    ["parent2@test.invalid", "change"],
  ]);
  const body = {
    parent_id: id(22),
    player_id: id(12),
    manual_training_notice: true,
  };
  for (const kind of [
    "attendance",
    "training_reminder",
    "training_removed",
    "report",
    "stamp_card",
  ])
    expect(
      (
        await query("select parent_delivery_allowed($1,$2,$3) allowed", [
          "parent2@test.invalid",
          kind,
          body,
        ])
      )[0].allowed,
    ).toBe(false);
});
it("requires a fresh manual action after details change before sending", async () => {
  await deactivate();
  const event = await save();
  await manual(event);
  await save([1], event, { location_id: id(3) });
  expect(await sendAll()).toHaveLength(0);
  expect(await manual(event)).toEqual({ queued: 1, blocked: 0 });
  expect((await sendAll())[0].payload.notice_details.location_name).toBe(
    "Halle",
  );
});
it("allows an explicit event notice with automatic notifications disabled, but preserves global recipient holds", async () => {
  await deactivate();
  const event = await save([1], undefined, { notify_parents: false });
  expect(await manual(event)).toEqual({ queued: 1, blocked: 0 });
  expect((await sendAll()).map((j) => j.kind)).toEqual(["planning"]);
  await db.exec(
    "update system_settings set value=jsonb_set(value,'{enabled}','false') where key='portal_delivery_release'",
  );
  expect(await manual(event)).toEqual({ queued: 0, blocked: 1 });
});
it("rejects manual event notifications from parents and for cancelled or past events", async () => {
  await deactivate();
  const event = await save();
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    id(102),
  ]);
  await db.exec("savepoint forbidden");
  await expect(manual(event)).rejects.toThrow("Forbidden");
  await db.exec("rollback to savepoint forbidden");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id(1)]);
  await db.query("update training_events set status='cancelled' where id=$1", [
    event,
  ]);
  await db.exec("savepoint cancelled");
  await expect(manual(event)).rejects.toThrow("Termin nicht verfügbar");
  await db.exec("rollback to savepoint cancelled");
});

it("previews without sending and releases only selected parent/action combinations", async () => {
  await deactivate(1);
  await deactivate(2);
  const event = await save([1, 2, 3]);
  const preview = await options(event);
  expect(preview.rows).toHaveLength(9);
  expect(
    preview.rows
      .filter((r: any) => r.parent_id === id(23))
      .every((r: any) => !r.enabled && r.activated),
  ).toBe(true);
  expect(
    preview.rows
      .filter((r: any) => r.parent_id === id(21))
      .every((r: any) => r.enabled),
  ).toBe(true);
  expect((await pending()).map((j) => j.recipient)).toEqual([
    "parent3@test.invalid",
  ]);
  expect(await submit(event, [choice(1)])).toEqual({
    queued: 1,
    approved: 0,
    blocked: 0,
  });
  expect(await submit(event, [choice(1)])).toEqual({
    queued: 0,
    approved: 0,
    blocked: 0,
  });
  expect((await sendAll()).map((j) => j.recipient).sort()).toEqual([
    "parent1@test.invalid",
    "parent3@test.invalid",
  ]);
  expect(
    (await options(event)).rows.find(
      (r: any) => r.parent_id === id(21) && r.kind === "planning",
    ).state,
  ).toBe("sent");
  expect(await query("select * from training_mail_approvals")).toHaveLength(0);
});
it("locks new reminder/attendance approvals inside 24h on the server but keeps planning available", async () => {
  await deactivate();
  const event = await save();
  await db.query(
    "update training_events set starts_at=now()+interval '23 hours',ends_at=now()+interval '24 hours' where id=$1",
    [event],
  );
  const result = await submit(event, [
    choice(1),
    choice(1, "training_reminder"),
    choice(1, "attendance"),
  ]);
  expect(result).toEqual({ queued: 1, approved: 0, blocked: 2 });
  expect((await sendAll()).map((j) => j.kind)).toEqual(["planning"]);
  expect(await query("select * from training_mail_approvals")).toHaveLength(0);
});
it("executes previously selected reminders/attendance once, without enabling other unactivated parents", async () => {
  await deactivate(1);
  await deactivate(2);
  const event = await save([1, 2]);
  expect(
    await submit(event, [
      choice(1, "training_reminder"),
      choice(1, "attendance"),
    ]),
  ).toEqual({ queued: 0, approved: 2, blocked: 0 });
  expect(await pending()).toHaveLength(0);
  await db.query(
    "update training_events set starts_at=now()+interval '23 hours',ends_at=now()+interval '24 hours' where id=$1",
    [event],
  );
  await db.query(
    "update event_participants set mail_joined_at=now()-interval '2 days' where event_id=$1",
    [event],
  );
  await query("select plan_training_reminders()");
  expect((await sendAll()).map((j) => [j.kind, j.recipient])).toEqual([
    ["training_reminder", "parent1@test.invalid"],
  ]);
  await db.query(
    "update training_events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",
    [event],
  );
  await query("select confirm_planned_training_attendance($1,true)", [event]);
  expect((await sendAll()).map((j) => [j.kind, j.recipient])).toEqual([
    ["attendance", "parent1@test.invalid"],
  ]);
  expect(await submit(event, [choice(1, "attendance")])).toEqual({
    queued: 0,
    approved: 0,
    blocked: 0,
  });
  expect(await sendAll()).toHaveLength(0);
});
it("requires actual attendance even during/after the buffer and reuses the existing held attendance job", async () => {
  await deactivate();
  const event = await save();
  await db.query(
    "update training_events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",
    [event],
  );
  let preview = await options(event);
  expect(preview.ended).toBe(true);
  expect(preview.buffer_active).toBe(true);
  expect(preview.rows[0].state).toBe("unconfirmed");
  expect(await submit(event, [choice(1, "attendance")])).toEqual({
    queued: 0,
    approved: 0,
    blocked: 1,
  });
  await db.query(
    "update training_events set auto_attendance_at=now()-interval '1 minute' where id=$1",
    [event],
  );
  expect((await options(event)).rows[0].state).toBe("unconfirmed");
  await query("select confirm_planned_training_attendance($1,true)", [event]);
  const held = (
    await query("select * from notification_jobs where kind='attendance'")
  )[0];
  expect(held.status).toBe("held");
  expect(await submit(event, [choice(1, "attendance")])).toEqual({
    queued: 1,
    approved: 1,
    blocked: 0,
  });
  const sent = await sendAll();
  expect(sent).toHaveLength(1);
  expect(sent[0].id).toBe(held.id);
  expect(await submit(event, [choice(1, "attendance")])).toEqual({
    queued: 0,
    approved: 0,
    blocked: 0,
  });
});
it("bulk confirmation preserves exceptions/removals and only confirms planned participants once", async () => {
  const event = await save([1, 2, 3]);
  await db.query(
    "update training_events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",
    [event],
  );
  await db.query(
    "update event_participants set status='excused' where event_id=$1 and player_id=$2",
    [event, id(12)],
  );
  await db.query(
    "update event_participants set removed_from_event=true where event_id=$1 and player_id=$2",
    [event, id(13)],
  );
  const result = (
    await query("select confirm_planned_training_attendance($1,true) result", [
      event,
    ])
  )[0].result;
  expect(result.confirmed).toBe(1);
  expect(
    result.participants.find((p: any) => p.player_id === id(12)).status,
  ).toBe("excused");
  expect(
    result.participants.find((p: any) => p.player_id === id(13)).status,
  ).toBe("planned");
  expect(
    (
      await query(
        "select confirm_planned_training_attendance($1,true) result",
        [event],
      )
    )[0].result.confirmed,
  ).toBe(0);
  expect((await sendAll()).map((j) => j.kind)).toEqual(["attendance"]);
});
it("preserves recipient gates, rejects unauthorized RPCs, and protects the approvals table", async () => {
  await deactivate();
  const event = await save();
  await db.exec(
    "update system_settings set value=jsonb_set(value,'{enabled}','false') where key='portal_delivery_release'",
  );
  expect(await submit(event, [choice(1, "attendance")])).toEqual({
    queued: 0,
    approved: 0,
    blocked: 1,
  });
  for (const call of [
    "training_notification_options($1)",
    "submit_training_notifications($1,'[]')",
    "confirm_planned_training_attendance($1,true)",
  ]) {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      id(102),
    ]);
    await db.exec("savepoint denied");
    await expect(query(`select ${call}`, [event])).rejects.toThrow("Forbidden");
    await db.exec("rollback to savepoint denied");
  }
  expect(
    (
      await query(
        "select has_table_privilege('authenticated','training_mail_approvals','insert') allowed",
      )
    )[0].allowed,
  ).toBe(false);
  expect(
    (
      await query(
        "select has_function_privilege('anon','training_notification_options(uuid)','execute') allowed",
      )
    )[0].allowed,
  ).toBe(false);
});
it("requires the bulk confirmation flag and rejects future/cancelled events", async () => {
  const event = await save();
  for (const flag of [false, true]) {
    await db.exec("savepoint invalid");
    await expect(
      query("select confirm_planned_training_attendance($1,$2)", [event, flag]),
    ).rejects.toThrow();
    await db.exec("rollback to savepoint invalid");
  }
  await db.query(
    "update training_events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour',status='cancelled' where id=$1",
    [event],
  );
  await db.exec("savepoint cancelled");
  await expect(
    query("select confirm_planned_training_attendance($1,true)", [event]),
  ).rejects.toThrow("nicht abgesagte");
  await db.exec("rollback to savepoint cancelled");
});
it("revokes approvals on removal and suppresses a queued confirmation after attendance is corrected", async () => {
  await deactivate();
  const event = await save();
  await submit(event, [choice(1, "attendance")]);
  await save([2], event);
  expect(await query("select * from training_mail_approvals")).toHaveLength(0);
  await save([1], event);
  await db.query(
    "update training_events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",
    [event],
  );
  await query("select confirm_planned_training_attendance($1,true)", [event]);
  await submit(event, [choice(1, "attendance")]);
  await db.query(
    "update event_participants set status='excused' where event_id=$1",
    [event],
  );
  expect(await sendAll()).toHaveLength(0);
});
it("does not send attendance twice when a manually notified parent activates the portal", async () => {
  await deactivate();
  const event = await save();
  await db.query(
    "update training_events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",
    [event],
  );
  await query("select confirm_planned_training_attendance($1,true)", [event]);
  await submit(event, [choice(1, "attendance")]);
  expect((await sendAll()).map((j) => j.kind)).toEqual(["attendance"]);
  await db.query(
    "update parents set auth_user_id=$1,notifications_held=false where id=$2",
    [id(101), id(21)],
  );
  const ep = (
    await query("select id from event_participants where event_id=$1", [event])
  )[0];
  await query("select set_attendance($1,'planned','Korrektur',false)", [ep.id]);
  await query(
    "select set_attendance($1,'attended_manual','Anwesenheit bestätigt',false)",
    [ep.id],
  );
  expect(await sendAll()).toHaveLength(0);
  expect(
    (await options(event)).rows.every(
      (row: any) => row.activated && !row.enabled,
    ),
  ).toBe(true);
  expect(
    await query("select * from notification_jobs where kind='attendance'"),
  ).toHaveLength(1);
});
it("rejects selections from another family instead of granting broader access", async () => {
  await deactivate();
  const event = await save();
  await db.exec("savepoint invalid_selection");
  await expect(submit(event, [choice(2, "attendance")])).rejects.toThrow(
    "gehört nicht zum Termin",
  );
  await db.exec("rollback to savepoint invalid_selection");
  expect(await query("select * from training_mail_approvals")).toHaveLength(0);
});

it("bypasses the recipient allowlist only for explicitly selected manual plans, with no automatic follow-ups", async () => {
  await deactivate(1);
  await deactivate(2);
  await db.exec(
    "update system_settings set value=jsonb_set(value,'{recipients}','[]') where key='portal_delivery_release'",
  );
  const event = await save([1, 2, 3]);
  const queuedBefore = await query(
    "select id,status from notification_jobs order by id",
  );
  const preview = await options(event);
  expect(
    preview.rows.find(
      (r: any) => r.parent_id === id(21) && r.kind === "planning",
    ).enabled,
  ).toBe(true);
  expect(
    preview.rows.find(
      (r: any) => r.parent_id === id(23) && r.kind === "planning",
    ).enabled,
  ).toBe(false);
  expect(
    await query("select id,status from notification_jobs order by id"),
  ).toEqual(queuedBefore);
  expect(await sendAll()).toHaveLength(0);
  expect(await submit(event, [choice(1)])).toEqual({
    queued: 1,
    approved: 0,
    blocked: 0,
  });
  expect((await sendAll()).map((j) => [j.recipient, j.kind])).toEqual([
    ["parent1@test.invalid", "planning"],
  ]);
  expect(await submit(event, [choice(1)])).toEqual({
    queued: 0,
    approved: 0,
    blocked: 0,
  });
  await save([1, 2, 3], event, { location_id: id(3) });
  expect(await sendAll()).toHaveLength(0);
  await submit(event, [choice(1)]);
  expect((await sendAll()).map((j) => [j.recipient, j.kind])).toEqual([
    ["parent1@test.invalid", "change"],
  ]);
  expect(
    (
      await query(
        "select value->'recipients' recipients from system_settings where key='portal_delivery_release'",
      )
    )[0].recipients,
  ).toEqual([]);
});
it("bypasses the recipient allowlist for explicitly selected attendance only, leaving other kinds and families blocked", async () => {
  await deactivate(1);
  await deactivate(2);
  await db.exec(
    "update system_settings set value=jsonb_set(value,'{recipients}','[]') where key='portal_delivery_release'",
  );
  const event = await save([1, 2, 3]);
  await db.query(
    "update training_events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",
    [event],
  );
  await query("select confirm_planned_training_attendance($1,true)", [event]);
  expect(await sendAll()).toHaveLength(0);
  expect(await submit(event, [choice(1, "attendance")])).toEqual({
    queued: 1,
    approved: 1,
    blocked: 0,
  });
  const job = (await pending()).find((j) => j.kind === "attendance");
  for (const kind of [
    "planning",
    "change",
    "training_removed",
    "training_reminder",
    "invitation",
    "correction",
    "report",
    "stamp_card",
    "training_backfill",
    "camp_confirmation",
  ]) {
    expect(
      (
        await query("select parent_delivery_allowed($1,$2,$3) allowed", [
          job.recipient,
          kind,
          job.payload,
        ])
      )[0].allowed,
    ).toBe(false);
  }
  expect((await sendAll()).map((j) => [j.recipient, j.kind])).toEqual([
    ["parent1@test.invalid", "attendance"],
  ]);
  expect(await submit(event, [choice(1, "attendance")])).toEqual({
    queued: 0,
    approved: 0,
    blocked: 0,
  });
  expect(await sendAll()).toHaveLength(0);
});
it("requires a separate reminder approval without opening automatic reminders or later attendance", async () => {
  await deactivate(1);
  await deactivate(2);
  await db.exec(
    "update system_settings set value=jsonb_set(value,'{recipients}','[]') where key='portal_delivery_release'",
  );
  const event = await save([1, 2, 3]);
  await submit(event, [choice(1, "training_reminder")]);
  expect(await pending()).toHaveLength(0);
  await db.query(
    "update training_events set starts_at=now()+interval '23 hours',ends_at=now()+interval '24 hours' where id=$1",
    [event],
  );
  await db.query(
    "update event_participants set mail_joined_at=now()-interval '2 days' where event_id=$1",
    [event],
  );
  await query("select plan_training_reminders()");
  expect((await sendAll()).map((j) => [j.recipient, j.kind])).toEqual([
    ["parent1@test.invalid", "training_reminder"],
  ]);
  await db.query(
    "update training_events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",
    [event],
  );
  await query("select confirm_planned_training_attendance($1,true)", [event]);
  expect(await sendAll()).toHaveLength(0);
});
it("still enforces the global switch and current family link for manual non-allowlisted recipients", async () => {
  await deactivate();
  await db.exec(
    "update system_settings set value=jsonb_set(value,'{recipients}','[]') where key='portal_delivery_release'",
  );
  const event = await save();
  await submit(event, [choice(1)]);
  await db.exec(
    "update system_settings set value=jsonb_set(value,'{enabled}','false') where key='portal_delivery_release'",
  );
  expect(await sendAll()).toHaveLength(0);
  await db.exec(
    "update system_settings set value=jsonb_set(value,'{enabled}','true') where key='portal_delivery_release'",
  );
  await db.query("delete from parent_players where player_id=$1", [id(11)]);
  expect(await sendAll()).toHaveLength(0);
});

async function staffAccount(
  n: number,
  role = "staff",
  confirmed = true,
  active = true,
) {
  const email = `coach${n}@test.invalid`;
  await db.query("insert into auth.users values($1,$2,$3)", [
    id(n),
    email,
    confirmed ? new Date().toISOString() : null,
  ]);
  await db.query("insert into profiles(id,role) values($1,$2)", [id(n), role]);
  if (role !== "parent")
    await db.query(
      "insert into staff_profiles(id,display_name,active) values($1,$2,$3)",
      [id(n), email, active],
    );
  return email;
}
async function finishedTraining(children = [1, 2, 3]) {
  const event = await save(children);
  await db.query(
    "update training_events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",
    [event],
  );
  return event;
}
async function staffSubmit(
  event: string,
  emails: string[],
  selections: ReturnType<typeof choice>[] = [],
) {
  return (
    await query(
      "select submit_training_notifications_with_staff($1,$2,$3) result",
      [event, selections, emails],
    )
  )[0].result;
}
it("accepts multiple confirmed staff/admin recipients, deduplicates addresses, and includes only attended children", async () => {
  const coach = await staffAccount(201);
  const event = await finishedTraining();
  await db.query(
    "update event_participants set status='attended_manual' where event_id=$1 and player_id=$2",
    [event, id(11)],
  );
  await db.query(
    "update event_participants set status='excused' where event_id=$1 and player_id=$2",
    [event, id(12)],
  );
  await db.query(
    "update event_participants set removed_from_event=true where event_id=$1 and player_id=$2",
    [event, id(13)],
  );
  const before = await query("select count(*) n from notification_jobs");
  expect(
    (
      await query("select validate_training_staff_recipients($1) emails", [
        [coach.toUpperCase(), ` ${coach} `, "coach@test.invalid"],
      ])
    )[0].emails.sort(),
  ).toEqual([coach, "coach@test.invalid"].sort());
  expect(await query("select count(*) n from notification_jobs")).toEqual(
    before,
  );
  expect(
    (
      await staffSubmit(event, [
        coach,
        coach.toUpperCase(),
        "coach@test.invalid",
      ])
    ).staff_queued,
  ).toBe(2);
  const delivered = (await sendAll()).filter(
    (j) => j.kind === "training_staff_attendance",
  );
  expect(delivered).toHaveLength(2);
  expect(delivered[0].payload.notice_details.participants).toEqual([
    { id: id(11), name: "Kind 1 Kind" },
  ]);
  expect(
    (await staffSubmit(event, [coach, "coach@test.invalid"])).staff_skipped,
  ).toBe(2);
  expect(
    (await sendAll()).filter((j) => j.kind === "training_staff_attendance"),
  ).toHaveLength(0);
});
it("rejects third parties, unconfirmed accounts, parents and inactive coaches atomically with parent selections", async () => {
  const unconfirmed = await staffAccount(201, "staff", false),
    inactive = await staffAccount(202, "staff", true, false);
  await deactivate(1);
  const event = await finishedTraining([1]);
  await query("select confirm_planned_training_attendance($1,true)", [event]);
  for (const email of [
    "outsider@test.invalid",
    unconfirmed,
    inactive,
    "parent2@test.invalid",
  ]) {
    await db.exec("savepoint rejected");
    await expect(
      staffSubmit(
        event,
        ["coach@test.invalid", email],
        [choice(1, "attendance")],
      ),
    ).rejects.toThrow("Nur bestätigte aktive Coach-/Admin-Konten");
    await db.exec("rollback to savepoint rejected");
  }
  expect(
    await query(
      "select * from notification_jobs where kind='training_staff_attendance'",
    ),
  ).toHaveLength(0);
  expect(await query("select * from training_mail_approvals")).toHaveLength(0);
});
it("requires an ended training with actual attendance and respects the global delivery switch", async () => {
  const event = await save();
  await db.exec("savepoint future");
  await expect(staffSubmit(event, ["coach@test.invalid"])).rejects.toThrow(
    "beendete",
  );
  await db.exec("rollback to savepoint future");
  await db.query(
    "update training_events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",
    [event],
  );
  await db.exec("savepoint planned");
  await expect(staffSubmit(event, ["coach@test.invalid"])).rejects.toThrow(
    "Teilnahme bestätigen",
  );
  await db.exec("rollback to savepoint planned");
  await query("select confirm_planned_training_attendance($1,true)", [event]);
  await db.exec(
    "update system_settings set value=jsonb_set(value,'{enabled}','false') where key='portal_delivery_release'",
  );
  await db.exec("savepoint disabled");
  await expect(staffSubmit(event, ["coach@test.invalid"])).rejects.toThrow(
    "global gesperrt",
  );
  await db.exec("rollback to savepoint disabled");
});
it("rechecks a staff recipient after claim and prevents sending after role removal", async () => {
  const coach = await staffAccount(201);
  const event = await finishedTraining([1]);
  await query("select confirm_planned_training_attendance($1,true)", [event]);
  await staffSubmit(event, [coach]);
  const job = (await query("select * from claim_notifications(100)")).find(
    (j) => j.kind === "training_staff_attendance",
  );
  expect(
    (
      await query("select prepare_staff_training_notification($1,$2) job", [
        job.id,
        job.lease_token,
      ])
    )[0].job,
  ).not.toBeNull();
  await db.query("update profiles set role='parent' where id=$1", [id(201)]);
  expect(
    (
      await query("select prepare_staff_training_notification($1,$2) job", [
        job.id,
        job.lease_token,
      ])
    )[0].job,
  ).toBeNull();
  expect(
    (
      await query("select status from notification_jobs where id=$1", [job.id])
    )[0].status,
  ).toBe("held");
});
it("rechecks changed participants immediately before SMTP and requires a fresh composition", async () => {
  const event = await finishedTraining([1, 2]);
  await query("select confirm_planned_training_attendance($1,true)", [event]);
  await staffSubmit(event, ["coach@test.invalid"]);
  const job = (await query("select * from claim_notifications(100)")).find(
    (j) => j.kind === "training_staff_attendance",
  );
  const prepared = (
    await query("select prepare_staff_training_notification($1,$2) job", [
      job.id,
      job.lease_token,
    ])
  )[0].job;
  await db.query(
    "update event_participants set status='excused' where event_id=$1 and player_id=$2",
    [event, id(12)],
  );
  expect(
    (
      await query("select prepare_staff_training_notification($1,$2,$3) job", [
        job.id,
        job.lease_token,
        prepared.payload.notice_details,
      ])
    )[0].job,
  ).toBeNull();
  const sent = (await sendAll()).find(
    (j) => j.kind === "training_staff_attendance",
  );
  expect(sent.payload.notice_details.participants).toEqual([
    { id: id(11), name: "Kind 1 Kind" },
  ]);
});
it("coalesces unsent staff summaries and blocks retries with uncertain delivery", async () => {
  const event = await finishedTraining([1, 2]);
  await db.query(
    "update event_participants set status='attended_manual' where event_id=$1 and player_id=$2",
    [event, id(11)],
  );
  await staffSubmit(event, ["coach@test.invalid"]);
  await query("select confirm_planned_training_attendance($1,true)", [event]);
  await staffSubmit(event, ["coach@test.invalid"]);
  expect(
    (await pending()).filter((j) => j.kind === "training_staff_attendance"),
  ).toHaveLength(1);
  await db.query(
    "update notification_jobs set status='uncertain' where kind='training_staff_attendance' and status='pending'",
  );
  await db.exec("savepoint uncertain");
  await expect(staffSubmit(event, ["coach@test.invalid"])).rejects.toThrow(
    "unklar",
  );
  await db.exec("rollback to savepoint uncertain");
});
it("protects staff-recipient validation and submission from parents and public callers", async () => {
  const event = await finishedTraining([1]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    id(102),
  ]);
  for (const sql of [
    "select validate_training_staff_recipients(array['coach@test.invalid'])",
    `select submit_training_notifications_with_staff('${event}','[]',array['coach@test.invalid'])`,
  ]) {
    await db.exec("savepoint forbidden");
    await expect(query(sql)).rejects.toThrow("Forbidden");
    await db.exec("rollback to savepoint forbidden");
  }
  expect(
    (
      await query(
        "select has_function_privilege('anon','public.validate_training_staff_recipients(text[])','execute') allowed",
      )
    )[0].allowed,
  ).toBe(false);
  expect(
    (
      await query(
        "select has_function_privilege('authenticated','public.training_staff_recipient(text)','execute') allowed",
      )
    )[0].allowed,
  ).toBe(false);
});

// Planning grace runs against the full released schema, including mail approvals.
async function graceFixture(startsAt = "2026-10-08T23:59:59+02:00") {
  await query(
    "update entitlement_periods set status='void' where player_id=$1 and id<>$2",
    [id(11), id(900)],
  );
  await query(
    "insert into entitlement_periods(id,player_id,subscription_id,stripe_customer_id,stripe_item_id,stripe_price_id,product_name,starts_at,ends_at,included_units) values($1,$2,$3,'cus_test','si_grace','price_test','Pro-Player','2026-09-07T12:40:49Z','2026-10-07T12:40:49Z',10) on conflict do nothing",
    [id(900), id(11), id(30)],
  );
  const period = { id: id(900) };
  const confirmation = {
    player_id: id(11),
    period_id: period.id,
    period_ends_at: "2026-10-07T12:40:49Z",
    starts_at: startsAt,
    event_type: "Gruppentraining",
  };
  return {
    starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + 3600000).toISOString(),
    grace_confirmations: [confirmation],
  };
}
async function rejectedGrace(
  overrides: Record<string, unknown>,
  message: string,
  event?: string,
) {
  await db.exec("savepoint grace_rejected");
  await expect(save([1], event, overrides)).rejects.toThrow(message);
  await db.exec("rollback to savepoint grace_rejected");
}
it("requires matching confirmation, persists its audit evidence and keeps actual entitlement dates", async () => {
  const input = await graceFixture();
  for (const grace_confirmations of [
    [],
    [{}],
    [{ ...input.grace_confirmations[0], player_id: id(12) }],
    [{ ...input.grace_confirmations[0], period_id: id(999) }],
    [{ ...input.grace_confirmations[0], starts_at: "2026-10-08T16:00:00Z" }],
    [
      {
        ...input.grace_confirmations[0],
        period_ends_at: "2026-10-06T12:40:49Z",
      },
    ],
    [{ ...input.grace_confirmations[0], event_type: "Einzeltraining" }],
  ]) {
    await rejectedGrace({ ...input, grace_confirmations }, "Bestätigung");
  }
  const event = await save([1], undefined, input);
  const [participant] = await query(
    "select * from event_participants where event_id=$1",
    [event],
  );
  expect(participant.period_id).toBe(input.grace_confirmations[0].period_id);
  expect(participant.planning_grace_confirmation.confirmed_by).toBe(id(1));
  expect(participant.planning_grace_confirmation.confirmed_at).toBeTruthy();
  const [period] = await query(
    "select ends_at from entitlement_periods where id=$1",
    [participant.period_id],
  );
  expect(new Date(period.ends_at).toISOString()).toBe(
    "2026-10-07T12:40:49.000Z",
  );
  expect(
    (
      await query(
        "select * from audit_log where record_id=$1 and new_value->'planning_grace_confirmation'->>'confirmed_by'=$2",
        [participant.id, id(1)],
      )
    ).length,
  ).toBeGreaterThan(0);
  // Saving alone must still not approve outbound notices.
  expect(
    (
      await query("select * from training_mail_approvals where event_id=$1", [
        event,
      ])
    ).length,
  ).toBe(0);
  await db.exec("savepoint invalid_participant");
  await expect(
    query(
      "update event_participants set planning_grace_confirmation=null where id=$1",
      [participant.id],
    ),
  ).rejects.toThrow("Kein passender Leistungszeitraum");
  await db.exec("rollback to savepoint invalid_participant");
  await query("select cancel_training($1,'Trainer verhindert')", [event]);
  expect(
    (
      await query("select status from event_participants where id=$1", [
        participant.id,
      ])
    )[0].status,
  ).toBe("cancelled");
});
it("accepts the end instant with confirmation and refuses the midnight after the following day", async () => {
  const input = await graceFixture("2026-10-07T12:40:49Z");
  await rejectedGrace({ ...input, grace_confirmations: [] }, "Bestätigung");
  await save([1], undefined, input);
  const expired = await graceFixture("2026-10-09T00:00:00+02:00");
  await rejectedGrace(expired, "Kein aktiver Leistungszeitraum");
});
it("requires fresh confirmation when moving a training or changing its type", async () => {
  const input = await graceFixture("2026-10-08T14:00:00Z");
  const event = await save([1], undefined, input);
  const moved = { ...input, starts_at: "2026-10-08T14:30:00Z" };
  await rejectedGrace(moved, "Bestätigung", event);
  expect(
    new Date(
      (
        await query("select starts_at from training_events where id=$1", [
          event,
        ])
      )[0].starts_at,
    ).toISOString(),
  ).toBe("2026-10-08T14:00:00.000Z");
  await rejectedGrace(
    { ...input, event_type: "Einzeltraining" },
    "Bestätigung",
    event,
  );
  await save([1], event, {
    ...moved,
    grace_confirmations: [
      { ...input.grace_confirmations[0], starts_at: moved.starts_at },
    ],
  });
});
it("does not bypass suspension or discipline entitlement and prefers a regular period", async () => {
  const input = await graceFixture();
  await query(
    "update entitlement_periods set status='suspended' where player_id=$1",
    [id(11)],
  );
  await rejectedGrace(input, "Kein aktiver Leistungszeitraum");
  await query("update entitlement_periods set status='active' where id=$1", [
    id(900),
  ]);
  await rejectedGrace(
    { ...input, event_type: "Athletiktraining" },
    "Kein aktiver Leistungszeitraum",
  );
  const [regular] = await query(
    "insert into entitlement_periods(player_id,subscription_id,stripe_customer_id,stripe_item_id,stripe_price_id,product_name,starts_at,ends_at,included_units) values($1,$2,'cus_test','si_regular','price_test','GameChanger','2026-10-07T12:40:49Z','2026-11-07T12:40:49Z',8) returning id",
    [id(11), id(30)],
  );
  const event = await save([1], undefined, {
    ...input,
    grace_confirmations: [],
  });
  const [participant] = await query(
    "select * from event_participants where event_id=$1",
    [event],
  );
  expect(participant.period_id).toBe(regular.id);
  expect(participant.planning_grace_confirmation).toBeNull();
});
it("uses Berlin calendar days across clock changes in PostgreSQL too", async () => {
  for (const [end, boundary] of [
    ["2026-03-28T12:00:00+01:00", "2026-03-30T00:00:00+02:00"],
    ["2026-10-24T12:00:00+02:00", "2026-10-26T00:00:00+01:00"],
  ]) {
    const [row] = await query("select training_planning_end($1) boundary", [
      end,
    ]);
    expect(new Date(row.boundary).toISOString()).toBe(
      new Date(boundary).toISOString(),
    );
  }
});
it("keeps grace attendance and reporting charged to the original period", async () => {
  await query(
    "update entitlement_periods set status='void' where player_id=$1",
    [id(11)],
  );
  await query(
    "insert into entitlement_periods(id,player_id,subscription_id,stripe_customer_id,stripe_item_id,stripe_price_id,product_name,starts_at,ends_at,included_units) values($1,$2,$3,'cus_test','si_past_grace','price_test','Pro-Player','2025-09-07T12:40:49Z','2025-10-07T12:40:49Z',10)",
    [id(901), id(11), id(30)],
  );
  const event = await save([1], undefined, {
    starts_at: "2025-10-08T14:00:00Z",
    ends_at: "2025-10-08T15:00:00Z",
    grace_confirmations: [
      {
        player_id: id(11),
        period_id: id(901),
        period_ends_at: "2025-10-07T12:40:49Z",
        starts_at: "2025-10-08T14:00:00Z",
        event_type: "Gruppentraining",
      },
    ],
  });
  await query("select auto_attendance(now())");
  const [participant] = await query(
    "select * from event_participants where event_id=$1",
    [event],
  );
  expect(participant.status).toBe("attended_auto");
  await query(
    "select set_attendance($1,'attended_manual','Teilnahme geprüft',false)",
    [participant.id],
  );
  const [report] = await query("select capture_report($1) id", [id(901)]);
  const [row] = await query(
    "select snapshot from report_snapshots where id=$1",
    [report.id],
  );
  expect(row.snapshot.completed).toBe(1);
  expect(row.snapshot.minutes).toBe(60);
  expect(row.snapshot.events[0].id).toBe(event);
  expect(new Date(row.snapshot.ends_at).toISOString()).toBe(
    "2025-10-07T12:40:49.000Z",
  );
});

it("defaults to enabled and saves only the signed-in parent's preference without opening release gates", async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    id(101),
  ]);
  expect((await query("select my_email_preference() enabled"))[0].enabled).toBe(
    true,
  );
  await db.exec("select set_my_email_preference(false)");
  expect((await query("select my_email_preference() enabled"))[0].enabled).toBe(
    false,
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    id(102),
  ]);
  expect((await query("select my_email_preference() enabled"))[0].enabled).toBe(
    true,
  );
  expect(
    (await query("select count(*)::int n from parent_email_preferences"))[0].n,
  ).toBe(1);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    id(101),
  ]);
  await db.exec(
    "select set_my_email_preference(true); update parents set notifications_held=true",
  );
  expect(
    (
      await query(
        "select parent_delivery_allowed('parent1@test.invalid','stamp_card','{}') allowed",
      )
    )[0].allowed,
  ).toBe(false);
});
it("holds existing and new opt-out mail permanently, while allowing fresh mail after reactivation", async () => {
  const event = await save();
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    id(101),
  ]);
  await db.exec("select set_my_email_preference(false)");
  const old = (
    await query(
      "select status,payload from notification_jobs where kind='planning'",
    )
  )[0];
  expect(old.status).toBe("held");
  expect(old.payload.email_preference_discarded).toBe(true);
  await db.exec(
    "insert into notification_jobs(idempotency_key,kind,recipient,payload) values('while-off','stamp_card','parent1@test.invalid','{}')",
  );
  expect(
    (
      await query(
        "select payload from notification_jobs where idempotency_key='while-off'",
      )
    )[0].payload.email_preference_discarded,
  ).toBe(true);
  // Manual approval is subordinate to a parent's personal opt-out.
  expect(
    (
      await query(
        "select parent_delivery_allowed('parent1@test.invalid','planning',$1) allowed",
        [
          {
            event_id: event,
            player_id: id(11),
            parent_id: id(21),
            manual_training_notice: true,
          },
        ],
      )
    )[0].allowed,
  ).toBe(false);
  await db.exec("select set_my_email_preference(true)");
  expect(
    (
      await query(
        "select email_preference_allows('parent1@test.invalid','stamp_card',payload) allowed from notification_jobs where idempotency_key='while-off'",
      )
    )[0].allowed,
  ).toBe(false);
  expect(
    (
      await query(
        "select parent_delivery_allowed('parent1@test.invalid','stamp_card','{}') allowed",
      )
    )[0].allowed,
  ).toBe(true);
});
it("rejects unlinked users and direct preference-table writes", async () => {
  await db.exec("savepoint unauthorized; set local role authenticated");
  await expect(
    db.exec("select set_my_email_preference(false)"),
  ).rejects.toThrow();
  await db.exec(
    "rollback to savepoint unauthorized; savepoint direct_write; set local role authenticated",
  );
  await expect(
    db.exec(
      "insert into parent_email_preferences(parent_id,enabled) values('a0000000-0000-4000-8000-000000000021',false)",
    ),
  ).rejects.toThrow();
  await db.exec("rollback to savepoint direct_write");
});

it("keeps an already claimed message suppressed through opt-out and immediate reactivation", async () => {
  await save();
  const claimed = (await query("select * from claim_notifications(20)"))[0];
  expect(claimed).toBeTruthy();
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    id(101),
  ]);
  await db.exec(
    "select set_my_email_preference(false); select set_my_email_preference(true)",
  );
  expect(
    (
      await query("select email_job_preference_allows($1) allowed", [
        claimed.id,
      ])
    )[0].allowed,
  ).toBe(false);
  expect(
    (
      await query("select status from notification_jobs where id=$1", [
        claimed.id,
      ])
    )[0].status,
  ).toBe("processing");
});
