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
  for (const f of [
    "011-age-import.sql",
    "012-free-booking-approval.sql",
    "013-discount-booking-approval.sql",
  ])
    await db.exec(readFileSync(`supabase/camp/${f}`, "utf8"));
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
    "011-subscription-package-changes.sql",
    "014-completed-subscription-reviews.sql",
    "015-legacy-tariff-confirmation.sql",
    "018-trial-profiles-feedback.sql",
    "019-trial-release-rules.sql",
    "020-trial-camp-access.sql",
  ])
    await db
      .exec(readFileSync(`supabase/release/${f}`, "utf8"))
      .catch((e: any) => {
        throw new Error(
          `${f}: ${e.message}, position ${e.position}, internal ${e.internalPosition} ${e.internalQuery ?? ""}`,
        );
      });
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
  expect(
    (
      await q(
        "select status from event_participants where trial_request_id=$1",
        [r.id],
      )
    )[0].status,
  ).toBe("planned");
  await q(
    "select set_attendance(participant_id,'attended_manual','Teilnahme geprüft',false) from trial_requests where id=$1",
    [r.id],
  );
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
  expect(await q("select * from players")).toHaveLength(0);
  expect(await q("select * from trial_players")).toHaveLength(3);
  expect(await q("select * from notification_jobs")).toHaveLength(1);
  expect(await q("select * from subscriptions")).toHaveLength(0);
  expect(await q("select * from entitlement_periods")).toHaveLength(0);
  // Matching email cannot create a second application for the same parent.
  await rejected(
    "select create_trial_request($1,'other-ip')",
    [{ ...input(11), email: "PARENT10@test.invalid" }],
    /TRIAL_MATCH/,
  );
  // Two criteria must match the same record (name+year, child+year, parent+child).
  await rejected(
    "select create_trial_request($1,'other-ip')",
    [{ ...input(11), parent_name: " FAMILIE 10 " }],
    /TRIAL_MATCH/,
  );
  await rejected(
    "select create_trial_request($1,'other-ip')",
    [{ ...input(11), children: input(10).children }],
    /TRIAL_MATCH/,
  );
  // Same phone alone and same birth year alone do not identify a family.
  await q("select create_trial_request($1,'other-ip')", [
    { ...input(11), phone: input(10).phone },
  ]);
  await rejected(
    "select create_trial_request($1,'other-ip')",
    [input(12, 4)],
    /Pflichtangaben/,
  );
});
it("assigns exactly one free participation, preserves calendar editing and rescheduling", async () => {
  const [r] = await apply();
  const e = await event();
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
  await q("update trial_requests set confirmed_at=now() where id=$1", [r.id]);
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
it("rechecks subscription and opt-out at delivery, uses feedback publication as day zero and cancels after corrected attendance", async () => {
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
    "update trial_requests set confirmed_at=now()-interval '20 days',feedback_at=now()-interval '8 days' where id=$1",
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
  ).toHaveLength(0);
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
    "update subscriptions set parent_id=(select parent_id from trial_families where id=$2) where id=$1",
    [id(90), id(10)],
  );
  expect(await allowed()).toBe(false);
  await q("update subscriptions set status='canceled' where id=$1", [id(90)]);
  expect(await allowed()).toBe(true);
  await q(
    "update trial_requests set feedback_at=now()-interval '15 days' where id=$1",
    [r.id],
  );
  await q("select plan_trial_notifications()");
  expect(
    await q("select * from notification_jobs where kind='trial_day14'"),
  ).toHaveLength(1);
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

it("promotes a matching trial profile atomically on approved active subscription assignment without losing data", async () => {
  const [r] = await apply();
  const [family] = await q("select * from trial_families");
  const future = await event();
  await manage({ action: "assign", request_id: r.id, event_id: future.id });
  await manage({
    action: "profile",
    request_id: r.id,
    first_name: "Übernommen",
    last_name: "Familie",
    birth_date: "2015-01-01",
    team: "U12",
    gender: "",
    club: "FC Test",
    position: "Sturm",
    strong_foot: "rechts",
    height_cm: 140,
    development_goals: "Ballkontrolle",
  });
  await campFixture();
  await trialCampDraft(r, family.parent_id);
  const item = {
    id: "si_trial_convert",
    price_id: "price_1RlBeSRoswKHkM76gM8jmUB5",
    quantity: 1,
    starts_at: new Date(Date.now() - 86400000).toISOString(),
    ends_at: new Date(Date.now() + 20 * 86400000).toISOString(),
  };
  await q(
    "insert into stripe_customer_registry(id,email,name) values('cus_convert','payer@test.invalid','Anderer Zahler')",
  );
  await q("select apply_stripe_package_sync($1)", [
    {
      stripe_subscription_id: "sub_convert",
      stripe_customer_id: "cus_convert",
      status: "active",
      subscription_created_at: "2025-01-01T00:00:00Z",
      retrieved_at: new Date().toISOString(),
      billing_cycle_anchor: item.starts_at,
      items: [item],
    },
  ]);
  const [review] = await q("select * from subscription_assignment_reviews");
  expect(review).toBeTruthy();
  await rejected(
    "select resolve_subscription_assignment($1)",
    [
      {
        review_id: review.id,
        signature: "0".repeat(32),
        player_id: r.player_id,
        previous_item_id: null,
      },
    ],
    /geändert/,
  );
  expect(await q("select * from players")).toHaveLength(1);
  expect(
    (await q("select converted_at from trial_players"))[0].converted_at,
  ).toBeNull();
  await q("select resolve_subscription_assignment($1)", [
    {
      review_id: review.id,
      signature: review.signature,
      player_id: r.player_id,
      previous_item_id: null,
      manual_trial_reason: "Familienzugehörigkeit telefonisch geprüft",
    },
  ]);
  const [p] = await q("select * from players");
  expect(p.id).toBe(r.player_id);
  expect(p.club).toBe("FC Test");
  expect(p.development_goals).toBe("Ballkontrolle");
  expect(
    (await q("select converted_player_id from trial_players"))[0]
      .converted_player_id,
  ).toBe(p.id);
  expect(
    await q("select * from entitlement_periods where player_id=$1", [p.id]),
  ).toHaveLength(1);
  expect(
    await q("select * from parent_players where player_id=$1", [p.id]),
  ).toHaveLength(1);
  await q("select plan_trial_notifications()");
  const [f] = await q("select * from trial_families");
  await q(
    "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
    [id(72), f.email],
  );
  await verify();
  await q("select trial_link_auth($1)", [f.id]);
  expect(
    (
      await q("select notifications_held from parents where id=$1", [
        f.parent_id,
      ])
    )[0].notifications_held,
  ).toBe(false);
  await q("select plan_trial_notifications()");
  const [customerNotice] = await q(
    "select * from notification_jobs where kind='trial_customer_planning'",
  );
  expect(customerNotice).toBeTruthy();
  expect(
    await q(
      "select * from event_participants where trial_request_id=$1 and period_id is null",
      [r.id],
    ),
  ).toHaveLength(1);
  await q("select set_config('request.jwt.claim.sub',$1,true)", [id(72)]);
  expect((await q("select trial_account_state() state"))[0].state).toBe(
    "subscriber",
  );
});

it("locks stars and permits exactly one later written comment on the same parent/child/event feedback", async () => {
  const r = await attended();
  await manage({
    action: "review",
    request_id: r.id,
    event_id: r.event_id,
    rating: 4,
    feedback: "Gute Teilnahme",
    ready: true,
  });
  const rated = {
    action: "feedback",
    request_id: r.id,
    event_id: r.event_id,
    rating: 5,
  };
  await q("select trial_parent_action($1,$2)", [id(10), rated]);
  await q("select trial_parent_action($1,$2)", [
    id(10),
    { ...rated, rating: 1, feedback: "Nicht überschreiben" },
  ]);
  await q("select trial_parent_action($1,$2)", [
    id(10),
    {
      action: "comment",
      request_id: r.id,
      event_id: r.event_id,
      feedback: "Hat Spaß gemacht",
    },
  ]);
  await q("select trial_parent_action($1,$2)", [
    id(10),
    {
      action: "comment",
      request_id: r.id,
      event_id: r.event_id,
      feedback: "Zweite Nachricht",
    },
  ]);
  const [saved] = await q(
    "select * from trial_feedback where author_type='parent'",
  );
  expect(saved.rating).toBe(5);
  expect(saved.feedback).toBe("Hat Spaß gemacht");
  expect(saved.comment_submitted_at).toBeTruthy();
  expect(saved.parent_id).toBe(
    (await q("select parent_id from trial_families"))[0].parent_id,
  );
});

it("bundles three children's offers per family, enforces consent and 48h delivery distance, and leaves no catch-up day7 after day14", async () => {
  const rows = await apply(10, 3);
  await verify();
  const e = await event();
  for (const r of rows)
    await manage({ action: "assign", request_id: r.id, event_id: e.id });
  await q(
    "update training_events set starts_at=now()-interval '10 days',ends_at=now()-interval '10 days'+interval '1 hour' where id=$1",
    [e.id],
  );
  for (const r of rows) {
    await manage({
      action: "attendance",
      request_id: r.id,
      status: "attended_manual",
    });
    await manage({
      action: "review",
      request_id: r.id,
      event_id: e.id,
      rating: 4,
      feedback: "Gutes Training",
      ready: true,
    });
  }
  await q("update trial_requests set feedback_at=now()-interval '8 days'");
  await q("select plan_trial_notifications()");
  await q(
    "update notification_jobs set status='sent' where kind='trial_feedback'",
  );
  await q("select plan_trial_notifications()");
  expect(
    await q("select * from notification_jobs where kind='trial_day7'"),
  ).toHaveLength(0);
  await db.exec(
    "alter table notification_jobs disable trigger touch_updated;update notification_jobs set updated_at=now()-interval '49 hours' where kind='trial_feedback';alter table notification_jobs enable trigger touch_updated;",
  );
  await q("update trial_families set marketing_consent=false");
  await q("select plan_trial_notifications()");
  expect(
    await q("select * from notification_jobs where kind='trial_day7'"),
  ).toHaveLength(0);
  await q("update trial_families set marketing_consent=true");
  await q("select plan_trial_notifications()");
  await q("select plan_trial_notifications()");
  const [offer] = await q(
    "select * from notification_jobs where kind='trial_day7'",
  );
  expect(offer.payload.family_sequence).toBe(true);
  expect(
    await q("select * from notification_jobs where kind='trial_day7'"),
  ).toHaveLength(1);
  await q("update trial_requests set feedback_at=now()-interval '15 days'");
  expect(
    (
      await q("select trial_delivery_allowed($1,$2,$3) allowed", [
        offer.recipient,
        offer.kind,
        offer.payload,
      ])
    )[0].allowed,
  ).toBe(false);
  await q("select plan_trial_notifications()");
  expect(
    await q("select * from notification_jobs where kind='trial_day14'"),
  ).toHaveLength(1);
});

it("uses one-time parent-bound account links and audited staff-only sibling exceptions with a three-child maximum", async () => {
  const [r] = await apply();
  const [f] = await q("select * from trial_families");
  const [access] = await q("select issue_trial_access($1) nonce", [f.id]);
  await rejected(
    "select consume_trial_access($1,$2,$3)",
    [access.nonce, f.id, id(999)],
    /Link/,
  );
  await q("select consume_trial_access($1,$2,$3)", [
    access.nonce,
    f.id,
    f.parent_id,
  ]);
  await rejected(
    "select consume_trial_access($1,$2,$3)",
    [access.nonce, f.id, f.parent_id],
    /Link/,
  );
  const sibling = {
    action: "add_child",
    family_id: f.id,
    first_name: "Zwilling",
    last_name: r.last_name,
    birth_date: r.birth_date,
    reason: "Identität persönlich geprüft",
  };
  await manage(sibling);
  await manage({ ...sibling, first_name: "Geschwister" });
  await rejected(
    "select manage_trial($1)",
    [{ ...sibling, first_name: "Viertes" }],
    /drei/,
  );
  expect(await q("select * from parents")).toHaveLength(1);
  expect(await q("select * from trial_players")).toHaveLength(3);
});

it("erases unsuccessful trial identities, feedback and audit copies after 180 days while retaining a shared regular family", async () => {
  const r = await attended();
  await manage({
    action: "review",
    request_id: r.id,
    event_id: r.event_id,
    rating: 4,
    feedback: "Zu löschende Rückmeldung",
    ready: true,
  });
  const [f] = await q("select * from trial_families");
  // This same parent also has an unrelated normal child: never erase the shared account.
  await q(
    "insert into players(id,first_name,last_name,birth_year) values($1,'Reguläres','Kind',2015)",
    [id(70)],
  );
  await q("insert into parent_players(parent_id,player_id) values($1,$2)", [
    f.parent_id,
    id(70),
  ]);
  await q("update trial_families set created_at=now()-interval '181 days'");
  expect((await q("select cleanup_trial_data() n"))[0].n).toBe(1);
  expect(await q("select * from trial_players")).toHaveLength(0);
  expect(await q("select * from trial_feedback")).toHaveLength(0);
  expect(await q("select * from trial_requests")).toHaveLength(0);
  expect((await q("select contact_email from parents"))[0].contact_email).toBe(
    f.email,
  );
  expect(await q("select * from players")).toHaveLength(1);
  expect(
    await q(
      "select * from audit_log where table_name in ('trial_requests','trial_players','trial_feedback')",
    ),
  ).toHaveLength(0);
});

it("retires a trial-only authenticated parent after retention without retaining login identities", async () => {
  await apply();
  await verify();
  const [f] = await q("select * from trial_families");
  await db.exec(
    "alter table auth.users add column raw_user_meta_data jsonb;alter table auth.users add column banned_until timestamptz;create table auth.sessions(user_id uuid);create table auth.refresh_tokens(user_id text);create table auth.identities(user_id uuid);create table auth.audit_log_entries(payload jsonb);alter table auth.users add column raw_app_meta_data jsonb;alter table auth.users add column encrypted_password text;alter table auth.users add column phone text;alter table auth.users add column phone_change text;alter table auth.users add column phone_change_token text;alter table auth.users add column email_change text;alter table auth.users add column email_change_token_new text;alter table auth.users add column email_change_token_current text;alter table auth.users add column confirmation_token text;alter table auth.users add column recovery_token text;alter table auth.users add column reauthentication_token text;alter table auth.users add column deleted_at timestamptz;",
  );
  await q(
    "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
    [id(71), f.email],
  );
  await q("select trial_link_auth($1)", [f.id]);
  await q("insert into auth.sessions values($1)", [id(71)]);
  await q("insert into auth.refresh_tokens values($1)", [id(71)]);
  await q("insert into auth.identities values($1)", [id(71)]);
  await q("update trial_families set created_at=now()-interval '181 days'");
  expect((await q("select cleanup_trial_data() n"))[0].n).toBe(1);
  expect(
    (await q("select email from auth.users where id=$1", [id(71)]))[0].email,
  ).toContain("@deleted.invalid");
  expect(await q("select * from auth.sessions")).toHaveLength(0);
  expect(await q("select * from auth.identities")).toHaveLength(0);
  expect(
    (await q("select contact_email from parents"))[0].contact_email,
  ).toContain("@deleted.invalid");
});

async function campFixture() {
  await q(
    "insert into camps(id,title,location,capacity,buffer_percent,min_age,max_age,days,status,payment_mode) values($1,'Trial-Camp','Platz',20,0,6,16,jsonb_build_array(jsonb_build_object('starts_at',now()+interval '30 days','ends_at',now()+interval '30 days 6 hours')),'open','test')",
    [id(80)],
  );
  await q(
    "insert into plans(id,name,included_units,generation,is_camp,camp_id,active) values($1,'Camp',0,'special',true,$2,false)",
    [id(81), id(80)],
  );
  await q(
    "insert into camp_offers(id,camp_id,plan_id,kind,stripe_price_id,stripe_product_id,stripe_payment_link_id,payment_url,amount,currency) values($1,$2,$3,'main','price_trialcamp','prod_trialcamp','plink_trialcamp','https://example.invalid/camp',10000,'eur')",
    [id(82), id(80), id(81)],
  );
}
async function trialCampDraft(r: any, parent: string) {
  await q(
    "insert into camp_bookings(id,camp_id,offer_id,parent_id,player_id,browser_token_hash,parent_data,child_data,customer_group,expected_amount,currency,stripe_price_id,stripe_payment_link_id) values($1,$2,$3,$4,$5,'local',jsonb_build_object('name','Familie 10','email','parent10@test.invalid'),$6,'new',10000,'eur','price_trialcamp','plink_trialcamp')",
    [
      id(83),
      id(80),
      id(82),
      parent,
      r.player_id,
      {
        first_name: r.first_name,
        last_name: r.last_name,
        birth_date: r.birth_date,
        gender: "keine Angabe",
        clothing_size: "140",
      },
    ],
  );
}
it("shares the same child identity with camps without Abo conversion, keeps camp history after trial retention and prevents foreign-family use", async () => {
  const [r] = await apply();
  await verify();
  await campFixture();
  const [f] = await q("select * from trial_families");
  await q(
    "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
    [id(75), f.email],
  );
  await q("select trial_link_auth($1)", [f.id]);
  await rejected(
    "select prepare_trial_camp_player($1,$2)",
    [id(999), r.player_id],
    /Familie/,
  );
  await trialCampDraft(r, f.parent_id);
  expect(await q("select * from players")).toHaveLength(1);
  expect((await q("select id from players"))[0].id).toBe(r.player_id);
  expect(
    (await q("select camp_player_id,converted_at from trial_players"))[0],
  ).toEqual({ camp_player_id: r.player_id, converted_at: null });
  await q("select set_config('request.jwt.claim.sub',$1,true)", [id(75)]);
  expect((await q("select trial_account_state() state"))[0].state).toBe(
    "trial",
  );
  await q("select camp_confirm_payment($1)", [
    {
      booking_id: id(83),
      session_id: "cs_test_trialcamp",
      payment_id: "pi_trialcamp",
      customer_id: "cus_trialcamp",
      livemode: false,
      payment_status: "paid",
      price_id: "price_trialcamp",
      payment_link_id: "plink_trialcamp",
      currency: "eur",
      quantity: 1,
      subtotal: 10000,
      total: 10000,
    },
  ]);
  expect((await q("select status from camp_bookings"))[0].status).toBe("paid");
  expect(await q("select * from players")).toHaveLength(1);
  await q("update trial_families set created_at=now()-interval '181 days'");
  expect((await q("select cleanup_trial_data() n"))[0].n).toBe(1);
  expect(await q("select * from trial_players")).toHaveLength(0);
  expect((await q("select status,player_id from camp_bookings"))[0]).toEqual({
    status: "paid",
    player_id: r.player_id,
  });
  expect((await q("select contact_email from parents"))[0].contact_email).toBe(
    f.email,
  );
  expect(await q("select * from players")).toHaveLength(1);
  expect((await q("select trial_account_state() state"))[0].state).toBe("none");
});

it("reuses a trial child during a manually reviewed paid Camp import and rolls back identity creation when payment proof fails", async () => {
  const [r] = await apply();
  await verify();
  await campFixture();
  const [f] = await q("select * from trial_families");
  await q("update camps set payment_mode='live' where id=$1", [id(80)]);
  const body = {
    camp_id: id(80),
    actor_id: id(1),
    parent_id: f.parent_id,
    player_id: null,
    new_child: true,
    child: {
      first_name: r.first_name,
      last_name: r.last_name,
      birth_date: r.birth_date,
      gender: "keine Angabe",
      clothing_size: "140",
    },
    parent: { name: f.parent_name, email: f.email, phone: f.phone },
    session_id: "cs_live_trialimport",
    payment_id: "pi_trialimport",
    customer_id: "cus_trialimport",
    payment_link_id: "plink_trialcamp",
    price_id: "price_trialcamp",
    product_id: "prod_trialcamp",
    livemode: true,
    payment_status: "paid",
    refunded: false,
    disputed: false,
    quantity: 1,
    currency: "eur",
    amount: 10000,
    subtotal: 10000,
    paid_at: new Date().toISOString(),
    evidence: { discount: 0 },
    customer_group: "new",
    benefit_percent: 0,
  };
  await rejected(
    "select camp_import_review_booking($1)",
    [{ ...body, price_id: "wrong" }],
    /source|payment/i,
  );
  expect(await q("select * from players")).toHaveLength(0);
  await q("select camp_import_review_booking($1)", [body]);
  expect((await q("select player_id from camp_bookings"))[0].player_id).toBe(
    r.player_id,
  );
  expect(await q("select * from players")).toHaveLength(1);
  expect(
    (await q("select converted_at from trial_players"))[0].converted_at,
  ).toBeNull();
  await q("update players set first_name='Campname' where id=$1", [
    r.player_id,
  ]);
  expect(
    (await q("select first_name,original_data from trial_players"))[0]
      .first_name,
  ).toBe("Campname");
  expect(
    (await q("select original_data from trial_players"))[0].original_data
      .first_name,
  ).toBe(r.first_name);
  await q("update trial_players set first_name='Trialname' where id=$1", [
    r.player_id,
  ]);
  expect((await q("select first_name from players"))[0].first_name).toBe(
    "Trialname",
  );
});

it("does not keep an unsuccessful trial account alive solely because of an abandoned camp checkout", async () => {
  const [r] = await apply();
  await verify();
  await campFixture();
  const [f] = await q("select * from trial_families");
  await trialCampDraft(r, f.parent_id);
  await q("update trial_families set created_at=now()-interval '181 days'");
  expect((await q("select cleanup_trial_data() n"))[0].n).toBe(1);
  expect(await q("select * from players")).toHaveLength(0);
  expect(await q("select * from camp_bookings")).toHaveLength(0);
  expect(
    (await q("select contact_email from parents"))[0].contact_email,
  ).toContain("@deleted.invalid");
});
