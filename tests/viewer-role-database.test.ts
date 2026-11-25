import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { beforeAll, afterAll, it, expect } from "vitest";
import { applyProductSchema } from "../scripts/products-local/schema.mjs";

let db: PGlite;
const id = (n: number) =>
  `c0610000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb,last_sign_in_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  await applyProductSchema((sql: string) => db.exec(sql));
  await db.query(
    "insert into auth.users(id,email) values($1,'admin@test.invalid'),($2,'berater@test.invalid'),($3,'mama@test.invalid'),($4,'coach@test.invalid')",
    [id(1), id(2), id(3), id(4)],
  );
  await db.query(
    "insert into profiles(id,role,full_name) values($1,'admin','Admin'),($2,'parent','Mama'),($3,'staff','Coach')",
    [id(1), id(3), id(4)],
  );
  await db.query(
    "insert into parents(full_name,contact_email,auth_user_id) values('Mama Muster','mama@test.invalid',$1)",
    [id(3)],
  );
});
afterAll(async () => db?.close());

async function as<T>(uid: string, fn: () => Promise<T>) {
  await db.exec(`set request.jwt.claim.sub='${uid}'; set role authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role; reset request.jwt.claim.sub;");
  }
}
const role = (uid: string) =>
  as(
    uid,
    async () =>
      (
        await db.query<{ r: string | null }>(
          "select public.current_role()::text r",
        )
      ).rows[0].r,
  );

it("Admin vergibt Lesezugriff, die Rolle hat selbst keine Datenbank-Leserechte", async () => {
  const target = await as(
    id(1),
    async () =>
      (
        await db.query<{ v: string }>(
          "select public.set_viewer_access('Berater@test.invalid','Berater',false,true) v",
        )
      ).rows[0].v,
  );
  expect(target).toBe(id(2));
  expect(await role(id(2))).toBe("viewer");
  const seen = await as(id(2), async () => ({
    team: (await db.query<{ t: boolean }>("select public.is_team() t")).rows[0]
      .t,
    parents: (await db.query("select * from parents")).rows.length,
    own: (await db.query("select clear_names from viewer_access")).rows,
  }));
  expect(seen).toEqual({
    team: false,
    parents: 0,
    own: [{ clear_names: false }],
  });
  await expect(
    as(id(2), () => db.query("update viewer_access set clear_names=true")),
  ).rejects.toThrow();
});

it("Klarnamen-Schalter und Sperren wirken sofort", async () => {
  await as(id(1), () =>
    db.query(
      "select public.set_viewer_access('berater@test.invalid','Berater',true,false)",
    ),
  );
  expect(await role(id(2))).toBeNull();
  const list = await as(
    id(1),
    async () =>
      (
        await db.query<{
          email: string;
          clear_names: boolean;
          active: boolean;
        }>("select email,clear_names,active from public.list_viewer_access()")
      ).rows,
  );
  expect(list).toEqual([
    { email: "berater@test.invalid", clear_names: true, active: false },
  ]);
});

it("lehnt Eltern-, Team- und fremde Aufrufe ab", async () => {
  await expect(
    as(id(1), () =>
      db.query(
        "select public.set_viewer_access('mama@test.invalid','x',false,true)",
      ),
    ),
  ).rejects.toThrow(/Elternprofil/);
  await expect(
    as(id(1), () =>
      db.query(
        "select public.set_viewer_access('coach@test.invalid','x',false,true)",
      ),
    ),
  ).rejects.toThrow(/Coach oder Admin/);
  await expect(
    as(id(4), () =>
      db.query(
        "select public.set_viewer_access('neu@test.invalid','x',false,true)",
      ),
    ),
  ).rejects.toThrow(/Forbidden/);
  await expect(
    as(id(1), () =>
      db.query(
        "select public.set_viewer_access('neu@test.invalid','x',false,true)",
      ),
    ),
  ).rejects.toThrow(/kein Konto/);
});
