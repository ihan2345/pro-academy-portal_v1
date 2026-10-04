import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
let db: PGlite;
const child = "a0000000-0000-4000-8000-000000000001",
  otherChild = "a0000000-0000-4000-8000-000000000002";
const parent = "b0000000-0000-4000-8000-000000000001",
  otherParent = "b0000000-0000-4000-8000-000000000002";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
 create table players(id uuid primary key);
 create table parent_players(id uuid primary key default gen_random_uuid(),parent_id uuid not null,player_id uuid not null references players(id),unique(parent_id,player_id));`);
  await db.exec(
    readFileSync(
      "supabase/migrations/202610040013_single_parent_assignment.sql",
      "utf8",
    ),
  );
  await db.query("insert into players values($1),($2)", [child, otherChild]);
});
beforeEach(async () => {
  await db.exec("delete from parent_players");
  await db.query(
    "insert into parent_players(parent_id,player_id) values($1,$2)",
    [parent, child],
  );
});
afterAll(async () => db.close());
it.each(["", "on conflict do nothing"])(
  "rejects a second parent even with %s",
  async (conflict) => {
    await expect(
      db.query(
        `insert into parent_players(parent_id,player_id) values($1,$2) ${conflict}`,
        [otherParent, child],
      ),
    ).rejects.toThrow("zuerst die bestehende Zuordnung aufheben");
    expect((await db.query("select * from parent_players")).rows).toHaveLength(
      1,
    );
  },
);
it("allows retrying the same pair and adding a sibling to the same parent", async () => {
  await db.query(
    "insert into parent_players(parent_id,player_id) values($1,$2) on conflict do nothing",
    [parent, child],
  );
  await db.query(
    "insert into parent_players(parent_id,player_id) values($1,$2)",
    [parent, otherChild],
  );
  expect((await db.query("select * from parent_players")).rows).toHaveLength(2);
});
it("rejects changing either side in place", async () => {
  await expect(
    db.query("update parent_players set parent_id=$1", [otherParent]),
  ).rejects.toThrow("zuerst die bestehende");
  await expect(
    db.query("update parent_players set player_id=$1", [otherChild]),
  ).rejects.toThrow("zuerst die bestehende");
});
it("allows assigning a new parent only after removing the old link", async () => {
  await db.query("delete from parent_players where player_id=$1", [child]);
  await db.query(
    "insert into parent_players(parent_id,player_id) values($1,$2)",
    [otherParent, child],
  );
  expect((await db.query("select parent_id from parent_players")).rows).toEqual(
    [{ parent_id: otherParent }],
  );
});
it("enforces uniqueness at index level as the concurrency backstop", async () => {
  const result = await db.query<{ indisunique: boolean }>(
    "select indisunique from pg_index where indexrelid='parent_players_one_parent_per_player'::regclass",
  );
  expect(result.rows[0].indisunique).toBe(true);
});
