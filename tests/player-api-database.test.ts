import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
const a = "a".repeat(64),
  b = "b".repeat(64),
  c = "c".repeat(64);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
  create function public.is_admin() returns boolean language sql as $$select current_setting('test.role',true)='admin'$$;`);
  await db.exec(
    readFileSync(
      "supabase/migrations/202610150002_player_api_share.sql",
      "utf8",
    ),
  );
});
afterAll(async () => db.close());
async function run(
  role: string,
  identity: string,
  query: string,
  params: unknown[] = [],
) {
  await db.exec(`begin; set local role ${role}`);
  try {
    await db.query("select set_config('test.role',$1,true)", [identity]);
    const r = await db.query(query, params);
    await db.exec("commit");
    return r.rows as any[];
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const manage = (action: string, token = a) =>
  run("authenticated", "admin", "select manage_player_api_share($1,$2) value", [
    token,
    action,
  ]);
const valid = async (token: string) =>
  (
    await run("service_role", "", "select player_api_token_valid($1) value", [
      token,
    ])
  )[0].value;
it("only admin can manage/read tokens; service-only validation; no initial link", async () => {
  expect(await valid(a)).toBe(false);
  await expect(
    run("anon", "", "select manage_player_api_share($1,'create')", [a]),
  ).rejects.toThrow("permission denied");
  for (const role of ["parent", "staff"]) {
    await expect(
      run(
        "authenticated",
        role,
        "select manage_player_api_share($1,'create')",
        [a],
      ),
    ).rejects.toThrow("Forbidden");
    expect(
      await run("authenticated", role, "select * from player_api_share"),
    ).toEqual([]);
  }
  await expect(
    run("authenticated", "admin", "select player_api_token_valid($1)", [a]),
  ).rejects.toThrow("permission denied");
});
it("copy remains stable, rotation revokes, disabling revokes, reactivation uses a new token", async () => {
  await manage("create");
  expect(await valid(a)).toBe(true);
  await manage("create", b);
  expect(await valid(a)).toBe(true);
  expect(await valid(b)).toBe(false);
  await manage("rotate", b);
  expect(await valid(a)).toBe(false);
  expect(await valid(b)).toBe(true);
  await manage("disable");
  expect(await valid(b)).toBe(false);
  await manage("create", c);
  expect(await valid(b)).toBe(false);
  expect(await valid(c)).toBe(true);
});
