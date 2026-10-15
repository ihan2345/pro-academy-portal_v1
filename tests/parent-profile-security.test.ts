import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
let db: PGlite;
const parent = "10000000-0000-4000-8000-000000000001",
  foreign = "10000000-0000-4000-8000-000000000002",
  admin = "10000000-0000-4000-8000-000000000003",
  staff = "10000000-0000-4000-8000-000000000004";
async function asUser(user: string, sql: string, params: unknown[] = []) {
  await db.exec("begin;set local role authenticated;");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    const r = await db.query(sql, params);
    await db.exec("commit");
    return r.rows;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create type app_role as enum('parent','staff','admin');
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
create table profiles(id uuid primary key,role app_role);
create function public.current_role() returns app_role language sql security definer set search_path=public as $$select role from profiles where id=auth.uid()$$;
create table parents(id uuid primary key,auth_user_id uuid,archived_at timestamptz,contact_email text);
alter table parents enable row level security;grant select,update on parents to authenticated;
create policy own_read on parents for select to authenticated using(auth_user_id=auth.uid());
`);
  await db.exec(
    readFileSync("supabase/migrations/202610080001_parent_profile.sql", "utf8"),
  );
  await db.exec(`create table players(id uuid primary key,first_name text,last_name text,birth_year integer,team text,archived_at timestamptz);
create table parent_players(id uuid primary key,parent_id uuid references parents,player_id uuid references players);
alter table players enable row level security;grant select,update on players to authenticated;
create policy read_players on players for select to authenticated using(true);`);
  await db.exec(
    readFileSync(
      "supabase/migrations/202610100001_parent_child_edit.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/202610150001_child_optional_details.sql",
      "utf8",
    ),
  );
  for (const [id, role] of [
    [parent, "parent"],
    [foreign, "parent"],
    [admin, "admin"],
    [staff, "staff"],
  ])
    await db.query("insert into profiles values($1,$2)", [id, role]);
  await db.query(
    "insert into parents(id,auth_user_id,contact_email)values($1,$1,'original@example.invalid'),($2,$2,'foreign@example.invalid')",
    [parent, foreign],
  );
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec(
    "update parents set phone=null,city=null,profile_self_service_updated_at=null,archived_at=null",
  );
});
it("allows own edit, rejects immediate second changed request and preserves email", async () => {
  await asUser(parent, "select update_parent_profile($1,'123','Berlin')", [
    parent,
  ]);
  await expect(
    asUser(parent, "select update_parent_profile($1,'456','Bonn')", [parent]),
  ).rejects.toThrow("sieben Tagen");
  expect(
    (
      await db.query("select contact_email,phone from parents where id=$1", [
        parent,
      ])
    ).rows[0],
  ).toEqual({ contact_email: "original@example.invalid", phone: "123" });
});
it("rejects foreign parent and coach including direct RPC", async () => {
  for (const actor of [foreign, staff])
    await expect(
      asUser(actor, "select update_parent_profile($1,'123','Bonn')", [parent]),
    ).rejects.toThrow();
});
it("does not grant direct table updates or permit a timestamp bypass", async () => {
  await asUser(
    parent,
    "update parents set phone='hack',profile_self_service_updated_at=now()-interval '10 days' where id=$1",
    [parent],
  );
  expect(
    (await db.query("select phone from parents where id=$1", [parent])).rows[0],
  ).toEqual({ phone: null });
});
it("admin edit leaves parent quota intact and does not consume a new quota", async () => {
  await asUser(admin, "select update_parent_profile($1,'admin','Bonn')", [
    parent,
  ]);
  expect(
    (
      await db.query(
        "select profile_self_service_updated_at from parents where id=$1",
        [parent],
      )
    ).rows[0],
  ).toEqual({ profile_self_service_updated_at: null });
  await asUser(parent, "select update_parent_profile($1,'parent','Köln')", [
    parent,
  ]);
  const before = (
    await db.query(
      "select profile_self_service_updated_at from parents where id=$1",
      [parent],
    )
  ).rows[0];
  await asUser(admin, "select update_parent_profile($1,'admin2','Bonn')", [
    parent,
  ]);
  expect(
    (
      await db.query(
        "select profile_self_service_updated_at from parents where id=$1",
        [parent],
      )
    ).rows[0],
  ).toEqual(before);
});
it("allows no-op without moving quota, and editing after seven days", async () => {
  await asUser(parent, "select update_parent_profile($1,null,null)", [parent]);
  expect(
    (
      await db.query(
        "select profile_self_service_updated_at from parents where id=$1",
        [parent],
      )
    ).rows[0],
  ).toEqual({ profile_self_service_updated_at: null });
  await db.query(
    "update parents set profile_self_service_updated_at=now()-interval '168 hours' where id=$1",
    [parent],
  );
  await expect(
    asUser(parent, "select update_parent_profile($1,'123','Bonn')", [parent]),
  ).resolves.toHaveLength(1);
});
it("rejects archived parents and oversized input", async () => {
  await expect(
    asUser(parent, "select update_parent_profile($1,$2,'Bonn')", [
      parent,
      "x".repeat(51),
    ]),
  ).rejects.toThrow();
  await db.query("update parents set archived_at=now() where id=$1", [parent]);
  await expect(
    asUser(parent, "select update_parent_profile($1,'123','Bonn')", [parent]),
  ).rejects.toThrow();
});

it("own child RPC permits only a current parent link and whitelisted fields", async () => {
  await db.query(
    "insert into players(id,first_name,last_name,birth_year,team,archived_at) values($1,'Original','Kind',2015,'U10',null)",
    [parent],
  );
  await db.query("insert into parent_players values($1,$1,$1)", [parent]);
  const sql =
    "select update_own_child_profile($1,$1,'Neuer','Name',2016,'U11')";
  await asUser(parent, sql, [parent]);
  expect(
    (
      await db.query(
        "select first_name,birth_year,team from players where id=$1",
        [parent],
      )
    ).rows[0],
  ).toEqual({ first_name: "Neuer", birth_year: 2016, team: "U11" });
  for (const user of [foreign, staff, admin])
    await expect(asUser(user, sql, [parent])).rejects.toThrow();
  await asUser(
    parent,
    "update players set archived_at=now(),first_name='Hack' where id=$1",
    [parent],
  );
  expect(
    (
      await db.query("select first_name,archived_at from players where id=$1", [
        parent,
      ])
    ).rows[0],
  ).toEqual({ first_name: "Neuer", archived_at: null });
  await expect(
    asUser(
      parent,
      "select update_own_child_profile($1,$1,'','Name',2016,'U11')",
      [parent],
    ),
  ).rejects.toThrow("Ungültige");
  await db.query("update players set archived_at=now() where id=$1", [parent]);
  await expect(asUser(parent, sql, [parent])).rejects.toThrow();
  await db.query("update players set archived_at=null where id=$1", [parent]);
  await db.query("update parents set archived_at=now() where id=$1", [parent]);
  await expect(asUser(parent, sql, [parent])).rejects.toThrow();
  await db.query("update parents set archived_at=null where id=$1", [parent]);
  await db.query("delete from parent_players where id=$1", [parent]);
  await expect(asUser(parent, sql, [parent])).rejects.toThrow();
});

it("saves optional child details atomically, rejects foreign access and permits clearing", async () => {
  const child = "10000000-0000-4000-8000-000000000099";
  await db.query(
    "insert into players(id,first_name,last_name,birth_year,team) values($1,'Ada','Test',2015,'U11')",
    [child],
  );
  await db.query(
    "insert into parent_players(id,parent_id,player_id) values($1,$2,$1)",
    [child, parent],
  );
  const sql =
    "select update_own_child_profile_details($1,$2,'Ada','Test',2015,'U11',$3)";
  const details = {
    gender: "weiblich",
    club: "FC Beispiel",
    position: "Mittelfeld",
    strong_foot: "links",
    height_cm: 145,
    development_goals: "Ballkontrolle verbessern",
  };
  await asUser(parent, sql, [parent, child, details]);
  expect(
    (
      await db.query(
        "select gender,club,position,strong_foot,height_cm,development_goals from players where id=$1",
        [child],
      )
    ).rows[0],
  ).toEqual(details);
  for (const user of [foreign, staff, admin])
    await expect(
      asUser(user, sql, [parent, child, { club: "Unberechtigt" }]),
    ).rejects.toThrow();
  await expect(
    asUser(parent, sql, [parent, child, { club: "Änderung", height_cm: 999 }]),
  ).rejects.toThrow();
  expect(
    (await db.query("select club from players where id=$1", [child])).rows[0],
  ).toEqual({ club: "FC Beispiel" });
  await expect(
    asUser(parent, sql, [parent, child, { archived_at: null }]),
  ).rejects.toThrow();
  await asUser(parent, sql, [parent, child, {}]);
  expect(
    (await db.query("select height_cm from players where id=$1", [child]))
      .rows[0],
  ).toEqual({ height_cm: 145 });
  await asUser(parent, sql, [
    parent,
    child,
    Object.fromEntries(Object.keys(details).map((k) => [k, null])),
  ]);
  expect(
    (
      await db.query(
        "select gender,club,position,strong_foot,height_cm,development_goals from players where id=$1",
        [child],
      )
    ).rows[0],
  ).toEqual(Object.fromEntries(Object.keys(details).map((k) => [k, null])));
});
