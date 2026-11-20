import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
import { applyProductSchema } from "../scripts/products-local/schema.mjs";

let db: PGlite;
const id = (n: number) =>
  `c0570000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const active = "aktiv@test.invalid",
  listed = "liste@test.invalid",
  unconfirmed = "offen@test.invalid",
  held = "gehalten@test.invalid";
const kid = (parent: number) => id(parent + 20);

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  await applyProductSchema((sql: string) => db.exec(sql));
  await db.query(
    "update system_settings set value=$1 where key='portal_delivery_release'",
    [
      {
        enabled: true,
        recipients: [listed],
        invitation_recipients: [],
        automatic_invitations: false,
      },
    ],
  );
  const families: [string, boolean, boolean][] = [
    [active, true, false],
    [listed, true, false],
    [unconfirmed, false, false],
    [held, true, true],
  ];
  for (const [n, [mail, confirmed, isHeld]] of families.entries()) {
    const uid = id(n + 1),
      pid = id(n + 11);
    await db.query(
      `insert into auth.users values($1,$2,${confirmed ? "now()" : "null"})`,
      [uid, mail],
    );
    await db.query("insert into profiles(id,role) values($1,'parent')", [uid]);
    await db.query(
      "insert into parents(id,auth_user_id,full_name,contact_email,notifications_held) values($1,$2,'Eltern',$3,$4)",
      [pid, uid, mail, isHeld],
    );
    await db.query(
      "insert into players(id,first_name,last_name,birth_year) values($1,'Test','Kind',2016)",
      [kid(n + 11)],
    );
    await db.query(
      "insert into parent_players(parent_id,player_id) values($1,$2)",
      [pid, kid(n + 11)],
    );
  }
});
afterAll(async () => db?.close());

const allowed = async (recipient: string, kind: string, parent: number) =>
  (
    await db.query<{ ok: boolean }>(
      "select parent_delivery_allowed($1,$2,$3) ok",
      [
        recipient,
        kind,
        { player_id: kid(parent), parent_id: id(parent), event_id: id(99) },
      ],
    )
  ).rows[0].ok;
const setSwitch = (on: boolean) =>
  db.query(
    "update platform_features set enabled=$1 where key='parent_auto_mail'",
    [on],
  );
const kinds = [
  "planning",
  "change",
  "training_removed",
  "training_reminder",
  "attendance",
  "report",
  "stamp_card",
];

it("starts disabled: only listed recipients get family mail", async () => {
  for (const kind of kinds) {
    expect(await allowed(listed, kind, 12)).toBe(true);
    expect(await allowed(active, kind, 11)).toBe(false);
  }
});

it("when enabled, sends to every active parent but not unconfirmed or held ones", async () => {
  await setSwitch(true);
  for (const kind of kinds) {
    expect(await allowed(active, kind, 11)).toBe(true);
    expect(await allowed(listed, kind, 12)).toBe(true);
    expect(await allowed(unconfirmed, kind, 13)).toBe(false);
    expect(await allowed(held, kind, 14)).toBe(false);
  }
  await setSwitch(false);
});

it("keeps invitations, the global switch and personal opt-out in force", async () => {
  await setSwitch(true);
  expect(await allowed(active, "invitation", 11)).toBe(false);
  await db.query(
    "insert into parent_email_preferences(parent_id,enabled) values($1,false)",
    [id(11)],
  );
  expect(await allowed(active, "planning", 11)).toBe(false);
  await db.query("delete from parent_email_preferences where parent_id=$1", [
    id(11),
  ]);
  await db.exec(
    "update system_settings set value=jsonb_set(value,'{enabled}','false') where key='portal_delivery_release'",
  );
  expect(await allowed(active, "planning", 11)).toBe(false);
  expect(await allowed(listed, "planning", 12)).toBe(false);
  await db.exec(
    "update system_settings set value=jsonb_set(value,'{enabled}','true') where key='portal_delivery_release'",
  );
  await setSwitch(false);
});

it("never releases mail that was already held", async () => {
  await db.query(
    "insert into notification_jobs(idempotency_key,kind,recipient,payload) values('alt-1','report',$1,$2)",
    [active, { player_id: kid(11), parent_id: id(11) }],
  );
  await setSwitch(true);
  const { rows } = await db.query<{ status: string }>(
    "select status from notification_jobs where idempotency_key='alt-1'",
  );
  expect(rows[0].status).toBe("held");
  await setSwitch(false);
});

it("refuses to apply twice", async () => {
  await expect(
    db.exec(readFileSync("supabase/release/057-parent-auto-mail.sql", "utf8")),
  ).rejects.toThrow(/already/);
});
