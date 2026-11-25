import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { beforeAll, afterAll, it, expect } from "vitest";
import { applyProductSchema } from "../scripts/products-local/schema.mjs";
import { accessNotes, noteCat } from "../src/design-2026/notifications";
import type { PortalAccessEvent } from "../src/lib/portal-events";

let db: PGlite;
const id = (n: number) =>
  `c0640000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  await applyProductSchema((sql: string) => db.exec(sql));
  await db.exec(`alter table auth.users add column if not exists created_at timestamptz default now();
 alter table auth.users add column if not exists last_sign_in_at timestamptz;
 create table if not exists auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid);
 alter table auth.sessions add column if not exists created_at timestamptz default now();
 alter table auth.sessions add column if not exists updated_at timestamptz default now();`);
  // 1 neu (erstes Mal), 2 alt + gerade aktiv, 3 Team
  const user = async (n: number, role: string, created: string) => {
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at,created_at) values($1,$2,now(),$3)",
      [id(n), `u${n}@test.invalid`, created],
    );
    await db.query(
      "insert into profiles(id,role,full_name) values($1,$2,$3) on conflict(id) do update set role=excluded.role,full_name=excluded.full_name",
      [id(n), role, `Person ${n}`],
    );
  };
  await user(1, "parent", ago(30));
  await user(2, "parent", ago(60 * 24 * 40));
  await user(3, "staff", ago(60 * 24 * 40));
  for (const n of [1, 2])
    await db.query(
      "insert into parents(id,full_name,contact_email,auth_user_id) values($1,$2,$3,$4)",
      [id(n + 10), `Eltern ${n}`, `u${n}@test.invalid`, id(n)],
    );
  await db.query(
    "insert into parents(id,full_name,contact_email) values($1,'Eltern 9','u9@test.invalid')",
    [id(19)],
  );
  await db.query(
    "insert into auth.sessions(user_id,created_at,updated_at) values($1,$2,$2),($3,$4,$5),($6,$7,$7)",
    [id(1), ago(20), id(2), ago(300), ago(5), id(3), ago(200)],
  );
  // Abgemeldet: nur noch last_sign_in_at
  await db.query("update auth.users set last_sign_in_at=$2 where id=$1", [
    id(3),
    ago(60 * 24 * 2),
  ]);
  await db.exec("set session_replication_role='replica'");
  await db.query(
    "insert into parent_invitations(id,parent_id,email,token_hash,expires_at,consumed_at) values($1,$2,'u1@test.invalid','a',now()+interval '1 day',$3),($4,$5,'u9@test.invalid','b',now()+interval '1 day',null)",
    [id(21), id(11), ago(25), id(22), id(19)],
  );
  await db.query(
    `insert into notification_jobs(idempotency_key,kind,recipient,payload,status,updated_at) values
     ('w1','invitation','u1@test.invalid',$1,'sent',$3),
     ('w2','invitation','u9@test.invalid',$2,'failed',$3),
     ('h1','invitation','x@test.invalid','{}','held',$3)`,
    [
      { invitation_id: id(21), invitation_wave: true },
      { invitation_id: id(22), invitation_wave: true },
      ago(60),
    ],
  );
  await db.query(
    "insert into audit_log(actor_id,actor_type,action,table_name,record_id,new_value) values($1,'user','PARENT_SELF_ACTIVATED','parents',$2,'{}')",
    [id(2), id(12)],
  );
  await db.exec("set session_replication_role='origin'");
});
afterAll(async () => db?.close());

const events = async () =>
  (
    await db.query<PortalAccessEvent>(
      "select * from portal_access_events(14) order by at desc",
    )
  ).rows;

it("liefert Einladungen, Annahmen, Anmeldungen und gerade Aktive", async () => {
  const rows = await events();
  const pick = (kind: string) =>
    rows
      .filter((r) => r.kind === kind)
      .map((r) => [r.name, r.wave, r.first, r.role]);
  expect(pick("invite_sent")).toEqual([["Eltern 1", true, false, "parent"]]);
  expect(pick("invite_failed")).toEqual([["Eltern 9", true, false, "parent"]]);
  expect(pick("invite_accepted")).toEqual([
    ["Eltern 1", true, false, "parent"],
  ]);
  expect(pick("self_activated")).toEqual([
    ["Eltern 2", false, false, "parent"],
  ]);
  expect(
    pick("login").sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ).toEqual([
    ["Eltern 1", false, true, "parent"],
    ["Eltern 2", false, false, "parent"],
    ["Person 3", false, false, "staff"],
    ["Person 3", false, false, "staff"],
  ]);
  expect(
    pick("online")
      .map((r) => r[0])
      .sort(),
  ).toEqual(["Eltern 1", "Eltern 2"]);
});

it("ist nur für den Server-Zugang ausführbar", async () => {
  await db.exec("set role authenticated");
  await expect(
    db.query("select * from portal_access_events(14)"),
  ).rejects.toThrow();
  await db.exec("reset role");
});

it("fasst die Welle und viele Anmeldungen zusammen", () => {
  const now = Date.now();
  const ev = (
    kind: PortalAccessEvent["kind"],
    n: number,
    extra: Partial<PortalAccessEvent> = {},
  ): PortalAccessEvent => ({
    kind,
    at: new Date(now - n * 60000).toISOString(),
    user_id: `u${n}`,
    parent_id: `p${n}`,
    name: `Name ${n}`,
    role: "parent",
    wave: false,
    test: false,
    first: false,
    ...extra,
  });
  const wave = Array.from({ length: 120 }, (_, i) =>
    ev("invite_sent", 10 + (i % 5), { wave: true, user_id: null }),
  );
  const logins = Array.from({ length: 5 }, (_, i) => ev("login", 2 + i));
  const notes = accessNotes(
    [
      ...wave,
      ev("invite_failed", 9, { wave: true }),
      ...logins,
      ev("login", 1, { first: true, user_id: "neu" }),
      ev("invite_accepted", 3),
      ev("online", 1),
      ev("login", 3, { role: "staff", name: "Trainer", user_id: "t" }),
    ],
    now,
  );
  expect(notes.every((n) => noteCat(n) === "portal")).toBe(true);
  const titles = notes.map((n) => n.title);
  expect(titles).toContain("Einladungswelle: 120 Einladungen verschickt");
  expect(notes.find((n) => n.key.startsWith("portal:wave"))?.text).toMatch(
    /1 Einladung konnte nicht verschickt werden\. Dazu 112 weitere\./,
  );
  expect(titles).toContain("Zum ersten Mal im Portal");
  expect(titles).toContain("Einladung angenommen");
  expect(titles).toContain("6 Anmeldungen im Portal");
  expect(notes.find((n) => n.key.startsWith("portal:login"))?.text).toBe(
    "5 Familien, 1 aus dem Team angemeldet.",
  );
  expect(titles).toContain("Gerade im Portal: 1");
  // Wochenalte Ereignisse fallen raus.
  expect(accessNotes([ev("invite_accepted", 60 * 24 * 8)], now)).toEqual([]);
});
