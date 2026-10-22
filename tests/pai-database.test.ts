import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
let db: PGlite;
const parent = "30000000-0000-0000-0000-000000000001",
  other = "30000000-0000-0000-0000-000000000002",
  admin = "30000000-0000-0000-0000-000000000003";
const rid = (n: number) =>
  `90000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function user(id: string, sql: string, args: unknown[] = []) {
  await db.exec("begin;set local role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    const r = await db.query<any>(sql, args);
    await db.exec("commit");
    return r.rows;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
async function reserve(n: number, max = 10, uid = parent) {
  return db.query<any>(
    "select pai_reserve($1,$2,'hash','parent',$3,date_trunc('day',now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin',(select version from pai_config),0.2,'gpt-5.4-mini') as result",
    [uid, rid(n), max],
  );
}
async function finish(n: number, ok = true, uncertain = false) {
  return db.query(
    "select pai_finish($1,$2,$3,0.001,100,50,'Question','Answer',$4,$5)",
    [parent, rid(n), ok, ok ? null : "FAILED", uncertain],
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`,
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.exec("update platform_features set enabled=true where key='pai'");
  for (const [id, role] of [
    [parent, "parent"],
    [other, "parent"],
    [admin, "admin"],
  ]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id,
      `${role}@test.invalid`,
    ]);
    await db.query(
      "insert into profiles(id,full_name,role) values($1,$2::text,$2::text::app_role)",
      [id, role],
    );
  }
  await db.query(
    "insert into parents(auth_user_id,full_name,contact_email) values($1,'One','one@test.invalid'),($2,'Two','two@test.invalid')",
    [parent, other],
  );
});
afterAll(() => db.close());
it("defaults enabled; only the authenticated parent can change its own preference", async () => {
  expect(
    (await user(parent, "select pai_preference() as enabled"))[0].enabled,
  ).toBe(true);
  await user(parent, "select pai_preference(false)");
  expect(
    (await user(other, "select pai_preference() as enabled"))[0].enabled,
  ).toBe(true);
  await expect(reserve(1)).rejects.toThrow("DISABLED");
  await expect(user(admin, "select pai_preference(false)")).rejects.toThrow();
  await user(parent, "select pai_preference(true)");
});
it("blocks direct access and privileged reservation functions", async () => {
  await expect(user(parent, "select * from pai_requests")).rejects.toThrow();
  await expect(user(parent, "select pai_cleanup()")).rejects.toThrow();
  await expect(
    user(parent, "select pai_save_override($1,100,'day','test',null,true)", [
      parent,
    ]),
  ).rejects.toThrow();
});
it("atomically caps simultaneous requests and deduplicates", async () => {
  const results = await Promise.allSettled([reserve(10, 1), reserve(11, 1)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const n = results[0].status === "fulfilled" ? 10 : 11;
  expect((await reserve(n, 1)).rows[0].result.duplicate).toBe(true);
  await expect(reserve(n, 1, other)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  await finish(n, false);
  expect((await reserve(12, 1)).rows[0].result.duplicate).toBe(false);
  await finish(12);
});
it("keeps successful use across limit changes and settles only once", async () => {
  await expect(reserve(13, 1)).rejects.toThrow("QUOTA");
  await reserve(13, 2);
  await finish(13);
  await finish(13);
  const rows = await db.query<any>(
    "select count(*)::int as n from pai_requests where status='completed'",
  );
  expect(rows.rows[0].n).toBe(2);
});
it("overrides and config are audited, invalidate snapshots, and enforce budget", async () => {
  await user(
    admin,
    "select pai_save_override($1,7,'month','Local test',null,true)",
    [parent],
  );
  expect(
    (
      await db.query<any>(
        "select count(*)::int as n from audit_log where table_name='pai_overrides'",
      )
    ).rows[0].n,
  ).toBe(1);
  const c = (await db.query<any>("select * from pai_config")).rows[0];
  c.value.budgetUsd = 0.1;
  await user(admin, "select pai_save_config($1,$2)", [
    JSON.stringify(c.value),
    c.version,
  ]);
  await expect(reserve(14)).rejects.toThrow("BUDGET");
  c.value.budgetUsd = 5;
  await user(admin, "select pai_save_config($1,$2)", [
    JSON.stringify(c.value),
    c.version + 1,
  ]);
});
it("refunds timeout questions while preserving uncertain budget and deletes expired content", async () => {
  await reserve(20);
  await db.query(
    "update pai_requests set lease_until=now()-interval '1 second' where id=$1",
    [rid(20)],
  );
  await reserve(21);
  await finish(21, false, true);
  const row = (
    await db.query<any>("select * from pai_requests where id=$1", [rid(20)])
  ).rows[0];
  expect(row.status).toBe("failed");
  expect(Number(row.reserve_usd)).toBe(0.2);
  await db.exec(
    "update pai_requests set expires_at=now()-interval '1 second';select pai_cleanup()",
  );
  expect(
    (
      await db.query<any>(
        "select count(*)::int as n from pai_requests where answer is not null",
      )
    ).rows[0].n,
  ).toBe(0);
});
it("monthly counting includes earlier days and expired overrides fall back to the standard", async () => {
  await db.query(
    "insert into pai_requests(id,user_id,role,fingerprint,status,created_at,reserve_usd,model,expires_at) select gen_random_uuid(),$1,'parent','monthly','completed',(date_trunc('month',now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin'),0,'gpt-5.4-mini',now()+interval '30 days' from generate_series(1,10)",
    [other],
  );
  await expect(
    db.query(
      "select pai_reserve($1,$2,'monthly-new','parent',10,date_trunc('month',now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin',(select version from pai_config),0.2,'gpt-5.4-mini')",
      [other, rid(30)],
    ),
  ).rejects.toThrow("QUOTA");
  await user(
    admin,
    "select pai_save_override($1,11,'month','Temporary test',null,true)",
    [other],
  );
  expect((await reserve(31, 0, other)).rows[0].result.duplicate).toBe(false);
  await db.query(
    "update pai_overrides set expires_at=now()-interval '1 second' where user_id=$1",
    [other],
  );
  await expect(reserve(32, 0, other)).rejects.toThrow("QUOTA");
});
it("analytics session reads cannot see another family's players or payment mapping", async () => {
  const one = "80000000-0000-4000-8000-000000000001",
    two = "80000000-0000-4000-8000-000000000002";
  await db.query(
    "insert into players(id,first_name,last_name) values($1,'Own','Child'),($2,'Foreign','Child')",
    [one, two],
  );
  await db.query(
    "insert into parent_players(parent_id,player_id) select id,case when auth_user_id=$1 then $3::uuid else $4::uuid end from parents where auth_user_id in($1,$2)",
    [parent, other, one, two],
  );
  await db.query(
    "insert into parent_stripe_customers(parent_id,stripe_customer_id) select id,case when auth_user_id=$1 then 'cus_paiOwn' else 'cus_paiForeign' end from parents where auth_user_id in($1,$2)",
    [parent, other],
  );
  const own = await user(parent, "select id from players where id in($1,$2)", [
    one,
    two,
  ]);
  expect(own.map((p) => p.id)).toEqual([one]);
  const customers = await user(
    parent,
    "select stripe_customer_id from parent_stripe_customers",
  );
  expect(customers.map((c) => c.stripe_customer_id)).toEqual(["cus_paiOwn"]);
  expect(
    await user(parent, "select id from players where id=$1", [two]),
  ).toEqual([]);
});
it("restricts global switches to a current admin with manage_features and audits changes", async () => {
  await db.query(
    "insert into platform_permissions(user_id,permission) values($1,'manage_features')",
    [admin],
  );
  for (const id of [parent, other]) {
    expect(
      (await user(id, "select can_manage_features() as allowed"))[0].allowed,
    ).toBe(false);
    expect(await user(id, "select * from platform_features")).toEqual([]);
    await expect(
      user(id, "select set_platform_feature('pai',false,true)"),
    ).rejects.toThrow("Forbidden");
    await expect(
      user(
        id,
        "insert into platform_permissions(user_id,permission) values($1,'manage_features')",
        [id],
      ),
    ).rejects.toThrow();
  }
  expect(
    (await user(admin, "select can_manage_features() as allowed"))[0].allowed,
  ).toBe(true);
  await expect(
    user(admin, "update platform_features set enabled=false"),
  ).rejects.toThrow();
  await user(admin, "select set_platform_feature('pai',false,true)");
  await expect(reserve(999)).rejects.toThrow("DISABLED");
  await expect(user(parent, "select pai_preference(true)")).rejects.toThrow(
    "DISABLED",
  );
  const audit = await db.query<any>(
    "select actor_id,old_value,new_value from audit_log where table_name='platform_features' order by created_at desc limit 1",
  );
  expect(audit.rows[0].actor_id).toBe(admin);
  expect(audit.rows[0].old_value.enabled).toBe(true);
  expect(audit.rows[0].new_value.enabled).toBe(false);
  await expect(
    user(admin, "select set_platform_feature('pai',true,true)"),
  ).rejects.toThrow("FEATURE_CHANGED");
  await user(admin, "select set_platform_feature('pai',true,false)");
  await db.query("delete from platform_permissions where user_id=$1", [admin]);
  await expect(
    user(admin, "select set_platform_feature('pai',false,true)"),
  ).rejects.toThrow("Forbidden");
  await db.query(
    "insert into platform_permissions(user_id,permission) values($1,'manage_features')",
    [parent],
  );
  expect(
    (await user(parent, "select can_manage_features() as allowed"))[0].allowed,
  ).toBe(false);
});
it("keeps the mascot dependent on pAi, including operator writes, and requires manage_features", async () => {
  await db.query(
    "insert into platform_permissions(user_id,permission) values($1,'manage_features') on conflict do nothing",
    [admin],
  );
  await user(admin, "select set_platform_feature('pai_mascot',true,false)");
  await expect(
    user(other, "select set_platform_feature('pai_mascot',false,true)"),
  ).rejects.toThrow("Forbidden");
  await user(admin, "select set_platform_feature('pai',false,true)");
  expect(
    (
      await db.query<any>(
        "select enabled from platform_features where key='pai_mascot'",
      )
    ).rows[0].enabled,
  ).toBe(false);
  await expect(
    user(admin, "select set_platform_feature('pai_mascot',true,false)"),
  ).rejects.toThrow("PAI_DISABLED");
  await expect(
    db.exec("update platform_features set enabled=true where key='pai_mascot'"),
  ).rejects.toThrow("PAI_DISABLED");
  await user(admin, "select set_platform_feature('pai',true,false)");
  expect(
    (
      await db.query<any>(
        "select enabled from platform_features where key='pai_mascot'",
      )
    ).rows[0].enabled,
  ).toBe(false);
  await user(admin, "select set_platform_feature('pai_mascot',true,false)");
  // The privileged CLI changes the same row; its disable also cascades.
  await db.exec("update platform_features set enabled=false where key='pai'");
  expect(
    (
      await db.query<any>(
        "select enabled from platform_features where key='pai_mascot'",
      )
    ).rows[0].enabled,
  ).toBe(false);
});
