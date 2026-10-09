import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("keeps subscription history private to the server and enforces the subscription reference", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role bypassrls; create table subscriptions(id uuid primary key);",
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/202610100002_profile_subscription_history.sql",
        "utf8",
      ),
    );
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.query<{ allowed: boolean }>(
        "select has_table_privilege($1,'profile_subscription_history','SELECT') as allowed",
        [role],
      );
      expect(rows[0].allowed).toBe(false);
    }
    await db.exec(
      "insert into subscriptions values('10000000-0000-4000-8000-000000000001');set role service_role;",
    );
    await db.exec(
      "insert into profile_subscription_history(subscription_id,source_signature,periods) values('10000000-0000-4000-8000-000000000001','v1','[]');",
    );
    expect(
      (await db.query("select * from profile_subscription_history")).rows,
    ).toHaveLength(1);
    await expect(
      db.exec("update profile_subscription_history set periods='{}'"),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
});
