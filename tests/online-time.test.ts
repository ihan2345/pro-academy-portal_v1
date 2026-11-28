import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { beforeAll, afterAll, it, expect, describe } from "vitest";
import { applyProductSchema } from "../scripts/products-local/schema.mjs";
import { formatOnlineTime, spellOnlineTime } from "../src/lib/online-time";

describe("formatOnlineTime", () => {
  it("zeigt tt:hh:mm", () => {
    expect(formatOnlineTime(0)).toBe("00:00:00");
    expect(formatOnlineTime(59)).toBe("00:00:00");
    expect(formatOnlineTime(61)).toBe("00:00:01");
    expect(formatOnlineTime(3 * 3600 + 5 * 60)).toBe("00:03:05");
    expect(formatOnlineTime(86400 + 3600 + 60)).toBe("01:01:01");
    expect(formatOnlineTime(123 * 86400)).toBe("123:00:00");
    expect(formatOnlineTime(null)).toBe("00:00:00");
    expect(spellOnlineTime(86400 + 2 * 3600 + 120)).toBe(
      "1 Tag, 2 Std., 2 Min.",
    );
  });
});

let db: PGlite;
const id = (n: number) =>
  `c0650000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const as = (user: string) =>
  db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`,
  );
const reset = () => db.exec("reset role");

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  await applyProductSchema((sql: string) => db.exec(sql));
  for (const [n, role, name] of [
    [1, "admin", "Chef"],
    [2, "admin", "Co-Admin"],
    [3, "parent", ""],
  ] as const) {
    await db.query("insert into auth.users values($1,$2,now())", [
      id(n),
      `u${n}@test.invalid`,
    ]);
    await db.query("insert into profiles(id,role,full_name) values($1,$2,$3)", [
      id(n),
      role,
      name,
    ]);
  }
  await db.query(
    "insert into parents(full_name,contact_email,auth_user_id) values('Familie Test','u3@test.invalid',$1)",
    [id(3)],
  );
  await db.query(
    "insert into platform_permissions(user_id,permission) values($1,'manage_features')",
    [id(1)],
  );
});
afterAll(() => db?.close());

const seconds = async (n: number) =>
  (
    await db.query<{ s: string }>(
      "select online_seconds::text s from user_activity where user_id=$1",
      [id(n)],
    )
  ).rows[0]?.s;
const back = (n: number, by: string) =>
  db.query(
    `update user_activity set last_seen_at=now()-interval '${by}' where user_id=$1`,
    [id(n)],
  );

it("zählt Lebenszeichen bis 150 s, Pausen und doppelte Tabs nicht", async () => {
  await as(id(3));
  await db.exec("select touch_user_activity()");
  await reset();
  expect(await seconds(3)).toBe("0");
  // Zweiter Tab gleich danach: nichts dazu.
  await as(id(3));
  await db.exec("select touch_user_activity()");
  await reset();
  expect(await seconds(3)).toBe("0");
  await back(3, "60 seconds");
  await as(id(3));
  await db.exec("select touch_user_activity()");
  await reset();
  expect(await seconds(3)).toBe("60");
  await back(3, "140 seconds");
  await as(id(3));
  await db.exec("select touch_user_activity()");
  await reset();
  expect(await seconds(3)).toBe("200");
  // Pause von 10 Minuten: neue Sitzung, zählt nicht.
  await back(3, "10 minutes");
  await as(id(3));
  await db.exec("select touch_user_activity()");
  await reset();
  expect(await seconds(3)).toBe("200");
});

it("Übersicht nur für Super-Admins, mit Elternname", async () => {
  await as(id(2));
  await expect(db.query("select online_time_overview()")).rejects.toThrow(
    /Forbidden/,
  );
  await reset();
  await as(id(1));
  const { rows } = await db.query<{ o: { rows: Record<string, unknown>[] } }>(
    "select online_time_overview() o",
  );
  await reset();
  const list = rows[0].o.rows;
  expect(list[0]).toMatchObject({
    user_id: id(3),
    name: "Familie Test",
    role: "parent",
    online_seconds: 200,
  });
  expect(list[0].parent_id).toBeTruthy();
  expect(list.find((r) => r.user_id === id(1))).toMatchObject({
    online_seconds: 0,
    last_seen_at: null,
  });
});
