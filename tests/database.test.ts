import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
let db: PGlite;
const ids = {
  parent: "30000000-0000-0000-0000-000000000001",
  foreign: "30000000-0000-0000-0000-000000000002",
  staff: "30000000-0000-0000-0000-000000000003",
  admin: "30000000-0000-0000-0000-000000000004",
  invite: "30000000-0000-0000-0000-000000000005",
  p1: "40000000-0000-0000-0000-000000000001",
  p2: "40000000-0000-0000-0000-000000000002",
  p3: "40000000-0000-0000-0000-000000000003",
  child1: "50000000-0000-0000-0000-000000000001",
  child2: "50000000-0000-0000-0000-000000000002",
  child3: "50000000-0000-0000-0000-000000000003",
  sub: "60000000-0000-0000-0000-000000000001",
  period: "70000000-0000-0000-0000-000000000001",
  period2: "70000000-0000-0000-0000-000000000002",
  location: "20000000-0000-0000-0000-000000000001",
};
async function asUser<T = Record<string, unknown>>(
  id: string,
  sql: string,
  params: unknown[] = [],
) {
  await db.exec("begin; set local role authenticated;");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    const result = await db.query<T>(sql, params);
    await db.exec("commit");
    return result.rows;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
async function adminQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
) {
  return (await db.query<T>(sql, params)).rows;
}
const input = (children = [ids.child1]) => ({
  title: "Testtraining",
  starts_at: "2025-07-15T14:30:00Z",
  ends_at: "2025-07-15T16:00:00Z",
  location_id: ids.location,
  trainer_id: ids.staff,
  event_type: "Gruppentraining",
  player_ids: children,
  note: "Geheime interne Notiz",
  notify_parents: true,
});
let eventId: string, participantId: string, reportId: string;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth; create schema storage; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,service_role; grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;
 `);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.exec(readFileSync("supabase/seed.sql", "utf8"));
  for (const [id, email] of [
    [ids.parent, "parent@test.invalid"],
    [ids.foreign, "foreign@test.invalid"],
    [ids.staff, "staff@test.invalid"],
    [ids.admin, "admin@test.invalid"],
    [ids.invite, "invited@test.invalid"],
  ])
    await db.query("insert into auth.users values($1,$2,now())", [id, email]);
  for (const [id, role] of [
    [ids.parent, "parent"],
    [ids.foreign, "parent"],
    [ids.staff, "staff"],
    [ids.admin, "admin"],
  ])
    await db.query("insert into profiles(id,full_name,role) values($1,$2,$3)", [
      id,
      role,
      role,
    ]);
  await db.query("insert into staff_profiles(id,display_name) values($1,$2)", [
    ids.staff,
    "Test Coach",
  ]);
  await db.query(
    `insert into parents(id,auth_user_id,full_name,contact_email,stripe_customer_id) values($1,$2,'Parent One','parent@test.invalid','cus_test_1'),($3,$4,'Parent Two','foreign@test.invalid','cus_test_2'),($5,null,'Invited Parent','invited@test.invalid','cus_test_3')`,
    [ids.p1, ids.parent, ids.p2, ids.foreign, ids.p3],
  );
  for (const child of [ids.child1, ids.child2, ids.child3])
    await db.query(
      "insert into players(id,first_name,last_name,birth_year) values($1,'Test','Kind',2015)",
      [child],
    );
  await db.query(
    "insert into parent_players(parent_id,player_id) values($1,$2),($3,$4),($1,$5)",
    [ids.p1, ids.child1, ids.p2, ids.child2, ids.child3],
  );
  await db.query(
    "insert into subscriptions(id,stripe_customer_id,stripe_subscription_id,status) values($1,'cus_test_1','sub_test','active')",
    [ids.sub],
  );
  await db.query(
    `insert into entitlement_periods(id,player_id,subscription_id,stripe_customer_id,stripe_item_id,stripe_price_id,product_name,starts_at,ends_at,included_units) values($1,$2,$3,'cus_test_1','si_1','price_test','GameChanger','2025-07-12T00:00:00+02','2025-08-12T00:00:00+02',8),($4,$5,$3,'cus_test_2','si_2','price_test','GameChanger','2025-07-12T00:00:00+02','2025-08-12T00:00:00+02',8)`,
    [ids.period, ids.child1, ids.sub, ids.period2, ids.child2],
  );
});
afterAll(async () => {
  await db?.close();
});
describe("PostgreSQL integration and isolation", () => {
  it("applies all migrations and RLS to every personal table", async () => {
    const rows = await adminQuery<{ relname: string; relrowsecurity: boolean }>(
      "select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'",
    );
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
  it("never exposes a foreign child; supports multiple own children", async () => {
    const rows = await asUser<{ id: string }>(
      ids.parent,
      "select id from players",
    );
    expect(rows.map((r) => r.id).sort()).toEqual([ids.child1, ids.child3]);
    expect(
      await asUser(ids.parent, "select * from players where id=$1", [
        ids.child2,
      ]),
    ).toHaveLength(0);
  });
  it("staff cannot see billing/contact parents or change roles", async () => {
    expect(await asUser(ids.staff, "select * from parents")).toHaveLength(0);
    await expect(
      asUser(ids.staff, "select change_role($1,'admin')", [ids.staff]),
    ).rejects.toThrow("Forbidden");
    await asUser(ids.staff, "update profiles set role='admin' where id=$1", [
      ids.staff,
    ]);
    expect(
      (
        await adminQuery<{ role: string }>(
          "select role from profiles where id=$1",
          [ids.staff],
        )
      )[0].role,
    ).toBe("staff");
  });
  it("parent cannot bypass API via direct writes or privileged jobs", async () => {
    await expect(
      asUser(ids.parent, "select save_training($1)", [JSON.stringify(input())]),
    ).rejects.toThrow("Forbidden");
    await expect(
      asUser(ids.parent, "select auto_attendance()"),
    ).rejects.toThrow("permission denied");
    await expect(
      asUser(
        ids.parent,
        "insert into players(first_name,last_name,birth_year) values('Attack','User',2015)",
      ),
    ).rejects.toThrow("row-level security");
  });
  it("creates event, assigns child, queues planning mail and audits in one transaction", async () => {
    const rows = await asUser<{ save_training: string }>(
      ids.staff,
      "select save_training($1)",
      [JSON.stringify(input([ids.child1, ids.child2]))],
    );
    eventId = rows[0].save_training;
    const participants = await adminQuery<{ id: string; player_id: string }>(
      "select id,player_id from event_participants where event_id=$1",
      [eventId],
    );
    participantId = participants.find((p) => p.player_id === ids.child1)!.id;
    expect(participants).toHaveLength(2);
    expect(
      await adminQuery(
        "select id from notification_jobs where kind='planning'",
      ),
    ).toHaveLength(2);
    expect(
      await adminQuery(
        "select id from audit_log where table_name='training_events'",
      ),
    ).toHaveLength(1);
  });
  it("parents see own participation only, never internal notes or other participants", async () => {
    expect(
      await asUser(ids.parent, "select * from training_events where id=$1", [
        eventId,
      ]),
    ).toHaveLength(1);
    expect(
      await asUser(
        ids.parent,
        "select * from event_participants where event_id=$1",
        [eventId],
      ),
    ).toHaveLength(1);
    expect(
      await asUser(ids.parent, "select * from event_private_notes"),
    ).toHaveLength(0);
  });
  it("enforces unique child per event at database level", async () => {
    await expect(
      db.query(
        "insert into event_participants(event_id,player_id,period_id) values($1,$2,$3)",
        [eventId, ids.child1, ids.period],
      ),
    ).rejects.toThrow("unique");
  });
  it("allows staff exceptions before automated confirmation", async () => {
    await asUser(
      ids.staff,
      "select set_attendance($1,'excused','Krankheitsbedingt',false)",
      [participantId],
    );
    const rows = await adminQuery<{ status: string }>(
      "select status from event_participants where id=$1",
      [participantId],
    );
    expect(rows[0].status).toBe("excused");
  });
  it("catches up old due events, respects exceptions, and never duplicates attendance mails", async () => {
    expect(
      (
        await adminQuery<{ auto_attendance: number }>(
          "select auto_attendance()",
        )
      )[0].auto_attendance,
    ).toBe(1);
    expect(
      (
        await adminQuery<{ auto_attendance: number }>(
          "select auto_attendance()",
        )
      )[0].auto_attendance,
    ).toBe(0);
    expect(
      await adminQuery(
        "select id from notification_jobs where kind='attendance'",
      ),
    ).toHaveLength(1);
    expect(
      (
        await adminQuery<{ status: string }>(
          "select status from event_participants where id=$1",
          [participantId],
        )
      )[0].status,
    ).toBe("excused");
  });
  it("supports correction after auto confirmation and preserves mail history", async () => {
    const rows = await adminQuery<{ id: string }>(
      "select id from event_participants where event_id=$1 and player_id=$2",
      [eventId, ids.child2],
    );
    await asUser(
      ids.staff,
      "select set_attendance($1,'absent','Trainer hat Abwesenheit bestätigt',true)",
      [rows[0].id],
    );
    expect(
      await adminQuery(
        "select id from notification_jobs where kind='attendance'",
      ),
    ).toHaveLength(1);
    expect(
      await adminQuery(
        "select id from notification_jobs where kind='correction'",
      ),
    ).toHaveLength(1);
  });
  it("stores immutable, versioned report snapshots, with pending status intact", async () => {
    await asUser(
      ids.staff,
      "select set_attendance($1,'planned','Prüfung noch offen',false)",
      [participantId],
    );
    reportId = (
      await adminQuery<{ capture_report: string }>(
        "select capture_report($1,false,$2)",
        [ids.period, "490000000"],
      )
    )[0].capture_report;
    const rows = await adminQuery<{
      snapshot: { completed: number; events: { status: string }[] };
    }>("select snapshot from report_snapshots where id=$1", [reportId]);
    expect(rows[0].snapshot.completed).toBe(0);
    expect(rows[0].snapshot.events[0].status).toBe("planned");
    expect(
      (
        await adminQuery<{ capture_report: string }>(
          "select capture_report($1)",
          [ids.period],
        )
      )[0].capture_report,
    ).toBe(reportId);
    const next = (
      await adminQuery<{ capture_report: string }>(
        "select capture_report($1,true)",
        [ids.period],
      )
    )[0].capture_report;
    expect(next).not.toBe(reportId);
  });
  it("private PDF RLS denies foreign parent and staff", async () => {
    await db.query("select register_report_file($1,$2,$3)", [
      reportId,
      "private/report.pdf",
      "abc",
    ]);
    await db.query(
      "insert into storage.objects(bucket_id,name) values('reports','private/report.pdf')",
    );
    expect(await asUser(ids.parent, "select * from report_files")).toHaveLength(
      1,
    );
    expect(
      await asUser(ids.foreign, "select * from report_files"),
    ).toHaveLength(0);
    expect(
      await asUser(ids.staff, "select * from report_snapshots"),
    ).toHaveLength(0);
    expect(
      await asUser(ids.parent, "select * from storage.objects"),
    ).toHaveLength(1);
    expect(
      await asUser(ids.foreign, "select * from storage.objects"),
    ).toHaveLength(0);
  });
  it("registration is idempotent and report resend retains separate history", async () => {
    await db.query("select register_report_file($1,$2,$3)", [
      reportId,
      "private/report.pdf",
      "abc",
    ]);
    expect(
      await adminQuery("select * from report_deliveries where snapshot_id=$1", [
        reportId,
      ]),
    ).toHaveLength(1);
    const request = "90000000-0000-0000-0000-000000000001";
    await db.query("select resend_report($1,$2,$3)", [
      reportId,
      request,
      ids.admin,
    ]);
    await db.query("select resend_report($1,$2,$3)", [
      reportId,
      request,
      ids.admin,
    ]);
    expect(
      await adminQuery("select * from report_deliveries where snapshot_id=$1", [
        reportId,
      ]),
    ).toHaveLength(2);
  });
  it("historical entitlements resist tariff changes", async () => {
    await expect(
      db.query("update entitlement_periods set included_units=4 where id=$1", [
        ids.period,
      ]),
    ).rejects.toThrow("immutable");
  });
  it("claims outbox once, quarantines ambiguous expired SMTP lease", async () => {
    const first = await adminQuery<{ id: string }>(
      "select * from claim_notifications(100)",
    );
    expect(first.length).toBeGreaterThan(2);
    expect(
      await adminQuery("select * from claim_notifications(100)"),
    ).toHaveLength(0);
    await db.query(
      "update notification_jobs set locked_at=now()-interval '1 hour' where id=$1",
      [first[0].id],
    );
    await adminQuery("select * from claim_notifications(100)");
    const result = await adminQuery<{ status: string }>(
      "select status from notification_jobs where id=$1",
      [first[0].id],
    );
    expect(result[0].status).toBe("uncertain");
  });
  it("deduplicates webhook IDs and recovers a crashed Stripe lease", async () => {
    const insert =
      "insert into stripe_webhook_events(stripe_event_id,type,payload,stripe_created) values('evt_test','invoice.paid','{}',1) on conflict do nothing";
    await db.exec(insert);
    await db.exec(insert);
    expect(
      await adminQuery("select * from stripe_webhook_events"),
    ).toHaveLength(1);
    expect(await adminQuery("select * from claim_stripe()")).toHaveLength(1);
    expect(await adminQuery("select * from claim_stripe()")).toHaveLength(0);
    await db.exec(
      "update stripe_webhook_events set locked_at=now()-interval '1 hour'",
    );
    expect(await adminQuery("select * from claim_stripe()")).toHaveLength(1);
  });
  it("invitation rejects a different verified email, then consumes token exactly once", async () => {
    await db.query(
      "insert into parent_invitations(parent_id,email,token_hash,expires_at) values($1,'invited@test.invalid','hash-once',now()+interval '1 day')",
      [ids.p3],
    );
    await expect(
      asUser(ids.foreign, "select accept_invitation('hash-once')"),
    ).rejects.toThrow("ungültig");
    expect(
      (
        await asUser<{ accept_invitation: string }>(
          ids.invite,
          "select accept_invitation('hash-once')",
        )
      )[0].accept_invitation,
    ).toBe(ids.p3);
    await expect(
      asUser(ids.invite, "select accept_invitation('hash-once')"),
    ).rejects.toThrow("ungültig");
  });
  it("SQL and TypeScript buffer implementations agree over DST and every example", async () => {
    const { calculateAutoAttendanceAt, localToUtc } =
      await import("../src/lib/domain");
    for (const day of ["2026-09-09", "2026-03-28", "2026-10-24"])
      for (const time of [
        "00:00",
        "00:30",
        "04:00",
        "06:00",
        "10:00",
        "12:00",
        "18:00",
        "20:00",
        "23:00",
      ]) {
        const end = localToUtc(day, time),
          result = await adminQuery<{ deadline: Date }>(
            "select calculate_auto_at($1) deadline",
            [end],
          );
        expect(result[0].deadline.toISOString()).toBe(
          new Date(calculateAutoAttendanceAt(end)).toISOString(),
        );
      }
  });
  it("cancel is soft, audited, and parent cannot cancel directly", async () => {
    await expect(
      asUser(ids.parent, "select cancel_training($1,'Unbefugt')", [eventId]),
    ).rejects.toThrow("Forbidden");
    await asUser(ids.staff, "select cancel_training($1,'Platz gesperrt')", [
      eventId,
    ]);
    expect(
      (
        await adminQuery<{ status: string }>(
          "select status from training_events where id=$1",
          [eventId],
        )
      )[0].status,
    ).toBe("cancelled");
    expect(
      (
        await adminQuery<{ status: string }>(
          "select status from event_participants where event_id=$1",
          [eventId],
        )
      ).every((p) => p.status === "cancelled"),
    ).toBe(true);
  });
});

it("rolls back the complete event and outbox if one child lacks entitlement", async () => {
  const before = await adminQuery("select id from training_events");
  await expect(
    asUser(ids.staff, "select save_training($1)", [
      JSON.stringify(input([ids.child1, ids.child3])),
    ]),
  ).rejects.toThrow("Leistungszeitraum");
  expect(await adminQuery("select id from training_events")).toHaveLength(
    before.length,
  );
});
it("Stripe sync freezes historical units, deduplicates periods and flags tariff changes", async () => {
  await db.query(
    "update plans set stripe_price_id='price_test' where name='GameChanger' and generation='legacy' and billing_interval='month'",
  );
  await db.query(
    "insert into subscription_players(subscription_id,stripe_item_id,player_id) values($1,'si_1',$2)",
    [ids.sub, ids.child1],
  );
  const sync = {
    stripe_subscription_id: "sub_test",
    subscription_created_at: "2025-07-11T22:00:00Z",
    stripe_customer_id: "cus_test_1",
    status: "active",
    billing_cycle_anchor: "2025-07-11T22:00:00Z",
    retrieved_at: "2026-09-09T10:00:00Z",
    items: [
      {
        id: "si_1",
        price_id: "price_test",
        starts_at: "2025-08-11T22:00:00Z",
        ends_at: "2025-09-11T22:00:00Z",
      },
    ],
  };
  await db.query("select apply_stripe($1)", [JSON.stringify(sync)]);
  await db.query("select apply_stripe($1)", [JSON.stringify(sync)]);
  expect(
    await adminQuery(
      "select * from entitlement_periods where player_id=$1 and starts_at='2025-08-11T22:00:00Z'",
      [ids.child1],
    ),
  ).toHaveLength(1);
  await db.query(
    "update plans set stripe_price_id='price_first' where name='FirstTouch' and generation='legacy'",
  );
  sync.items[0].price_id = "price_first";
  sync.retrieved_at = "2026-09-09T11:00:00Z";
  await db.query("select apply_stripe($1)", [JSON.stringify(sync)]);
  expect(
    (
      await adminQuery<{ included_units: number }>(
        "select included_units from entitlement_periods where player_id=$1 and starts_at='2025-08-11T22:00:00Z'",
        [ids.child1],
      )
    )[0].included_units,
  ).toBe(8);
  expect(
    (
      await adminQuery<{ needs_review: boolean }>(
        "select needs_review from subscriptions where id=$1",
        [ids.sub],
      )
    )[0].needs_review,
  ).toBe(true);
});
it("staff deactivation revokes database capabilities immediately", async () => {
  await db.query("update staff_profiles set active=false where id=$1", [
    ids.staff,
  ]);
  expect(
    (await asUser<{ is_team: boolean }>(ids.staff, "select is_team()"))[0]
      .is_team,
  ).toBe(false);
  await expect(
    asUser(ids.staff, "select save_training($1)", [JSON.stringify(input())]),
  ).rejects.toThrow("Forbidden");
  await db.query("update staff_profiles set active=true where id=$1", [
    ids.staff,
  ]);
});
it("finishes notification atomically and rejects a second completion with the same lease", async () => {
  await db.exec(
    "insert into notification_jobs(idempotency_key,kind,recipient,payload) values('finish-test','invitation','test@example.invalid','{\"url\":\"https://private.example/token\"}')",
  );
  const job = (
    await adminQuery<{ id: string; lease_token: string }>(
      "select * from claim_notifications(100)",
    )
  )[0];
  const finish = {
    id: job.id,
    lease_token: job.lease_token,
    recipient: "own-test@example.invalid",
    provider: "capture",
    status: "sent",
    message_id: "test-id",
  };
  await db.query("select finish_notification($1)", [JSON.stringify(finish)]);
  await expect(
    db.query("select finish_notification($1)", [JSON.stringify(finish)]),
  ).rejects.toThrow("ungültig");
  expect(
    await adminQuery("select * from notification_deliveries where job_id=$1", [
      job.id,
    ]),
  ).toHaveLength(1);
  expect(
    (
      await adminQuery<{ payload: Record<string, string> }>(
        "select payload from notification_jobs where id=$1",
        [job.id],
      )
    )[0].payload.url,
  ).toBeUndefined();
});
