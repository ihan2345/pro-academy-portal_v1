import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { beforeAll, afterAll, it, expect } from "vitest";
import { applyProductSchema } from "../scripts/products-local/schema.mjs";

let db: PGlite;
const id = (n: number) =>
  `c0590000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  await applyProductSchema((sql: string) => db.exec(sql));
});
afterAll(async () => db?.close());

const meta = async (uid: string) =>
  (
    await db.query<{ m: Record<string, unknown> | null }>(
      "select raw_user_meta_data m from auth.users where id=$1",
      [uid],
    )
  ).rows[0].m;

it("schreibt den Elternnamen beim Verknüpfen und bei Namensänderung ins Auth-Konto", async () => {
  await db.query(
    "insert into auth.users values($1,'abo@test.invalid',now(),'{\"trial_family_id\":\"x\"}')",
    [id(1)],
  );
  await db.query("insert into profiles(id,role) values($1,'parent')", [id(1)]);
  await db.query(
    "insert into parents(id,full_name,contact_email) values($1,'Laura Abo','abo@test.invalid')",
    [id(11)],
  );
  expect(await meta(id(1))).toEqual({ trial_family_id: "x" });
  await db.query("update parents set auth_user_id=$1 where id=$2", [
    id(1),
    id(11),
  ]);
  expect(await meta(id(1))).toEqual({
    trial_family_id: "x",
    full_name: "Laura Abo",
  });
  await db.query("update parents set full_name='Laura Neu' where id=$1", [
    id(11),
  ]);
  expect((await meta(id(1)))?.full_name).toBe("Laura Neu");
});

it("gibt Team-Konten den Namen und überspringt leere Namen", async () => {
  await db.query(
    "insert into auth.users values($1,'coach@test.invalid',now(),null)",
    [id(2)],
  );
  await db.query("insert into profiles(id,role) values($1,'staff')", [id(2)]);
  expect(await meta(id(2))).toBeNull();
  await db.query(
    "insert into staff_profiles(id,display_name) values($1,'Coach Max')",
    [id(2)],
  );
  expect((await meta(id(2)))?.full_name).toBe("Coach Max");
  await db.query("update profiles set full_name='Max Mustermann' where id=$1", [
    id(2),
  ]);
  expect((await meta(id(2)))?.full_name).toBe("Max Mustermann");
  await db.query("update profiles set full_name='' where id=$1", [id(2)]);
  expect((await meta(id(2)))?.full_name).toBe("Coach Max");
});

it("Clients können den Abgleich nicht selbst aufrufen", async () => {
  const r = await db.query<{ ok: boolean }>(
    "select has_function_privilege('authenticated','public.sync_auth_display_name(uuid)','execute') ok",
  );
  expect(r.rows[0].ok).toBe(false);
});

it("neue Login-Konten bekommen den Namen des noch nicht verknüpften Elternteils", async () => {
  await db.query(
    "insert into parents(id,full_name,contact_email) values($1,'Serkan Shop',' Shop@Test.invalid ')",
    [id(13)],
  );
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'shop@test.invalid',now())",
    [id(3)],
  );
  expect((await meta(id(3)))?.full_name).toBe("Serkan Shop");
  // Ohne passendes Elternteil bleibt das Konto unverändert.
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'fremd@test.invalid',now())",
    [id(4)],
  );
  expect(await meta(id(4))).toBeNull();
});

it("neu angelegte Profile mit Namen schreiben den Namen ins Auth-Konto", async () => {
  await db.query(
    "insert into profiles(id,role,full_name) values($1,'staff','Ayse Einsicht')",
    [id(4)],
  );
  expect((await meta(id(4)))?.full_name).toBe("Ayse Einsicht");
});
