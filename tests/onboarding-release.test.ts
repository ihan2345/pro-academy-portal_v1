import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
const admin = "f0000000-0000-4000-8000-000000000001",
  user = "f0000000-0000-4000-8000-000000000002",
  parent = "f0000000-0000-4000-8000-000000000003";
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
  await db.exec(readFileSync("supabase/release/010-portal-domain.sql", "utf8"));
  await db.query(
    "insert into auth.users values($1,'admin@example.invalid',now()),($2,'first@example.invalid',now())",
    [admin, user],
  );
  await db.query(
    "insert into profiles(id,role)values($1,'admin'),($2,'parent')",
    [admin, user],
  );
  await db.query(
    "insert into parents(id,full_name,contact_email,auth_user_id,notifications_held) values($1,'First Parent','first@example.invalid',$2,true)",
    [parent, user],
  );
  await db.query(
    "insert into parent_stripe_customers(parent_id,stripe_customer_id)values($1,'cus_first')",
    [parent],
  );
});
afterAll(async () => db.close());
const invitation = () => ({
  parent_id: parent,
  actor_id: admin,
  token_hash: "a".repeat(64),
  url: "https://portal.proacademy-ak.com/einladung?token=local_only",
});
it("requires release, verifies manual recipient and holds all automatic invitations", async () => {
  await expect(
    db.query("select release_parent_invitation($1)", [invitation()]),
  ).rejects.toThrow("Recipient not released");
  await db.query(
    "update system_settings set value=$1 where key='portal_delivery_release'",
    [
      {
        enabled: true,
        recipients: ["first@example.invalid"],
        invitation_recipients: ["first@example.invalid"],
        automatic_invitations: false,
      },
    ],
  );
  await db.query(
    "insert into notification_jobs(idempotency_key,kind,recipient,payload)values('auto','invitation','first@example.invalid','{}'),('foreign','report','other@example.invalid','{}'),('before','report','first@example.invalid','{}')",
  );
  expect((await db.query("select status from notification_jobs")).rows).toEqual(
    [{ status: "held" }, { status: "held" }, { status: "held" }],
  );
  const r = await db.query("select release_parent_invitation($1) id", [
    invitation(),
  ]);
  expect(r.rows).toHaveLength(1);
  const claims = await db.query<{
    kind: string;
    payload: Record<string, unknown>;
  }>("select * from claim_notifications(100)");
  expect(claims.rows).toHaveLength(1);
  expect(claims.rows[0].kind).toBe("invitation");
  expect(claims.rows[0].payload.manual_release).toBe(true);
});
it("acceptance activates only this family, never flushes historical held messages", async () => {
  await db.exec("begin;set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
  await db.query("select accept_invitation($1)", ["a".repeat(64)]);
  await db.exec("commit");
  expect(
    (
      await db.query("select notifications_held from parents where id=$1", [
        parent,
      ])
    ).rows,
  ).toEqual([{ notifications_held: false }]);
  await db.query(
    "insert into notification_jobs(idempotency_key,kind,recipient,payload)values('after','report','first@example.invalid','{}')",
  );
  const claimed = await db.query(
    "select idempotency_key from claim_notifications(100)",
  );
  expect(claimed.rows).toEqual([{ idempotency_key: "after" }]);
  expect(
    (
      await db.query(
        "select status from notification_jobs where idempotency_key='before'",
      )
    ).rows,
  ).toEqual([{ status: "held" }]);
  await db.query("update parents set notifications_held=true where id=$1", [
    parent,
  ]);
  await db.query(
    "insert into notification_jobs(idempotency_key,kind,recipient,payload)values('paused','report','first@example.invalid','{}')",
  );
  expect(
    (await db.query("select * from claim_notifications(100)")).rows,
  ).toHaveLength(0);
});
it("does not grant public execution or permit a staff account to adopt a family", async () => {
  await db.exec("begin;set local role authenticated");
  try {
    await expect(
      db.query("select release_parent_invitation($1)", [invitation()]),
    ).rejects.toThrow("permission denied");
  } finally {
    await db.exec("rollback");
  }
});

it("rejects the retired worker domain for new invitations", async () => {
  await db.query(
    "update system_settings set value=$1 where key='portal_delivery_release'",
    [
      {
        enabled: true,
        recipients: ["first@example.invalid"],
        invitation_recipients: ["first@example.invalid"],
      },
    ],
  );
  await expect(
    db.query("select release_parent_invitation($1)", [
      {
        ...invitation(),
        url: "https://proacademy-portal.proacademy-by-ak.workers.dev/einladung?token=local_only",
      },
    ]),
  ).rejects.toThrow("Invalid invitation link");
});
