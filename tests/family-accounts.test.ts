import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
import {
  sameFamilyContact,
  selectBillingCustomer,
  subscriptionLinkIssue,
} from "../src/lib/family-accounts";
import { adminSchemas } from "../src/lib/server/schemas";

let db: PGlite;
const owner = "91000000-0000-0000-0000-000000000001";
const stranger = "91000000-0000-0000-0000-000000000002";
let parent: string, child1: string, child2: string;
const query = async (sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as Record<string, any>[];
async function asUser(id: string, sql: string, params: unknown[] = []) {
  await db.exec("begin; set local role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    const result = await query(sql, params);
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
async function link(
  customer: string,
  player: string,
  name = "Family Parent",
  email = "family@example.invalid",
  parentId?: string,
) {
  await query(
    "insert into subscriptions(stripe_customer_id,stripe_subscription_id,status) values($1,$2,'active') on conflict do nothing",
    [customer, `sub_${customer}`],
  );
  return (
    await query("select link_stripe_family($1) id", [
      JSON.stringify({
        customer_id: customer,
        subscription_id: `sub_${customer}`,
        item_id: `si_${customer}`,
        player_id: player,
        parent_name: name,
        email,
        parent_id: parentId,
        actor_id: owner,
      }),
    ])
  )[0].id as string;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,service_role; grant execute on function auth.uid() to authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security; grant usage on schema storage to authenticated,service_role; grant select on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  for (const id of [owner, stranger]) {
    await query("insert into auth.users values($1,$2,now())", [
      id,
      `${id}@example.invalid`,
    ]);
    await query(
      "insert into profiles(id,full_name,role) values($1,'Test','parent')",
      [id],
    );
  }
  child1 = (
    await query(
      "insert into players(first_name,last_name) values('One','Child') returning id",
    )
  )[0].id;
  child2 = (
    await query(
      "insert into players(first_name,last_name) values('Two','Child') returning id",
    )
  )[0].id;
  parent = await link("cus_family_one", child1);
  expect(
    await link(
      "cus_family_two",
      child2,
      "  FAMILY   Parent  ",
      " FAMILY@example.invalid ",
    ),
  ).toBe(parent);
  await query("update parents set auth_user_id=$1 where id=$2", [
    owner,
    parent,
  ]);
});
afterAll(async () => {
  await db?.close();
});

it("creates children without a year, permits clearing it, and rejects invalid years", async () => {
  const base = { first_name: "New", last_name: "Child", team: "" };
  expect(adminSchemas.players.safeParse(base).success).toBe(true);
  expect(
    adminSchemas.players.safeParse({ ...base, birth_year: null }).success,
  ).toBe(true);
  for (const year of [0, 1899, 2101, 2015.5, "2015"])
    expect(
      adminSchemas.players.safeParse({ ...base, birth_year: year }).success,
    ).toBe(false);
  expect(
    (await query("select birth_year from players where id=$1", [child1]))[0]
      .birth_year,
  ).toBeNull();
  await expect(
    query("update players set birth_year=0 where id=$1", [child1]),
  ).rejects.toThrow();
});

it("keeps two Stripe IDs and two children in one account, including repeated imports", async () => {
  expect(await link("cus_family_two", child2)).toBe(parent);
  const links = await query(
    "select stripe_customer_id from parent_stripe_customers where parent_id=$1 order by stripe_customer_id",
    [parent],
  );
  expect(links.map((r) => r.stripe_customer_id)).toEqual([
    "cus_family_one",
    "cus_family_two",
  ]);
  expect(
    await query("select id from parent_players where parent_id=$1", [parent]),
  ).toHaveLength(2);
  expect(
    await query(
      "select id from subscription_players where player_id in ($1,$2)",
      [child1, child2],
    ),
  ).toHaveLength(2);
  expect(
    (
      await query("select stripe_customer_id from parents where id=$1", [
        parent,
      ])
    )[0].stripe_customer_id,
  ).toBe("cus_family_one");
});

it("requires both name and email; never silently chooses among duplicate parents", async () => {
  expect(await link("cus_different_name", child1, "Other Person")).not.toBe(
    parent,
  );
  expect(
    await link(
      "cus_different_email",
      child1,
      "Family Parent",
      "other@example.invalid",
    ),
  ).not.toBe(parent);
  await expect(
    link(
      "cus_explicit_mismatch",
      child1,
      "Wrong Name",
      "family@example.invalid",
      parent,
    ),
  ).rejects.toThrow("Name und E-Mail");
  await query(
    "insert into parents(full_name,contact_email) values('Duplicate','duplicate@example.invalid'),('Duplicate','duplicate@example.invalid')",
  );
  await expect(
    link("cus_duplicate", child1, "Duplicate", "duplicate@example.invalid"),
  ).rejects.toThrow("Mehrere passende");
});

it("does not reassign an existing subscription or item", async () => {
  await expect(link("cus_family_one", child2)).rejects.toThrow("anderen Kind");
  await expect(
    link("cus_family_one", child1, "Unrelated", "unrelated@example.invalid"),
  ).rejects.toThrow("anderen Elternkonto");
  expect(
    await query(
      "select id from parents where contact_email='unrelated@example.invalid'",
    ),
  ).toHaveLength(0);
});

it("shows both billing accounts only to their owner and rejects forged billing selections", async () => {
  expect(
    await asUser(owner, "select * from parent_stripe_customers"),
  ).toHaveLength(2);
  expect(await asUser(owner, "select * from subscriptions")).toHaveLength(2);
  expect(
    await asUser(stranger, "select * from parent_stripe_customers"),
  ).toHaveLength(0);
  expect(await asUser(stranger, "select * from subscriptions")).toHaveLength(0);
  expect(selectBillingCustomer(["cus_one", "cus_two"], "cus_two")).toBe(
    "cus_two",
  );
  expect(
    selectBillingCustomer(["cus_one", "cus_two"], "cus_foreign"),
  ).toBeNull();
  expect(selectBillingCustomer(["cus_one", "cus_two"])).toBeNull();
  expect(selectBillingCustomer(["cus_one"])).toBe("cus_one");
  await query("update parents set archived_at=now() where id=$1", [parent]);
  expect(
    await asUser(owner, "select * from parent_stripe_customers"),
  ).toHaveLength(0);
  await query("update parents set archived_at=null where id=$1", [parent]);
});

it("queues one held invitation per family without starting a token expiry", async () => {
  const input = JSON.stringify({ parent_id: parent, actor_id: owner });
  const first = (
    await query("select queue_parent_invitation($1) id", [input])
  )[0].id;
  expect(
    (await query("select queue_parent_invitation($1) id", [input]))[0].id,
  ).toBe(first);
  const job = (
    await query("select * from notification_jobs where id=$1", [first])
  )[0];
  expect(job.status).toBe("held");
  expect(job.attempts).toBe(0);
  expect(job.payload).toEqual({
    parent_id: parent,
    parent_name: "Family Parent",
  });
  expect(
    await query("select id from parent_invitations where parent_id=$1", [
      parent,
    ]),
  ).toHaveLength(0);
  expect(
    (await query("select * from claim_notifications(100)")).find(
      (r) => r.id === first,
    ),
  ).toBeUndefined();
  await expect(
    asUser(owner, "select queue_parent_invitation($1)", [input]),
  ).rejects.toThrow("permission denied");
});

it("holds future reports and training messages and cannot release them by restarting the worker", async () => {
  for (const kind of ["report", "planning", "attendance"])
    await query(
      "insert into notification_jobs(idempotency_key,kind,recipient,payload) values($1,$2,'family@example.invalid','{}')",
      [`held-${kind}`, kind],
    );
  await query(
    "insert into notification_jobs(idempotency_key,kind,recipient,payload) values('unrelated-mail','report','unrelated@example.invalid','{}')",
  );
  const held = await query(
    "select * from notification_jobs where recipient='family@example.invalid'",
  );
  expect(held.length).toBeGreaterThanOrEqual(4);
  expect(held.every((r) => r.status === "held" && r.attempts === 0)).toBe(true);
  expect(
    (await query("select * from claim_notifications(100)")).map(
      (r) => r.idempotency_key,
    ),
  ).toEqual(["unrelated-mail"]);
  await query(
    "update notification_jobs set status='pending' where recipient='family@example.invalid'",
  );
  expect(await query("select * from claim_notifications(100)")).toHaveLength(0);
  await query(
    "update parents set notifications_held=false where contact_email='family@example.invalid'",
  );
  expect(await query("select * from claim_notifications(100)")).toHaveLength(0);
  expect(
    (
      await query(
        "select status,attempts from notification_jobs where recipient='family@example.invalid'",
      )
    ).every((r) => r.status === "held" && r.attempts === 0),
  ).toBe(true);
});

it("moves pre-existing pending notifications to held when an account is staged", async () => {
  await query(
    "insert into notification_jobs(idempotency_key,kind,recipient,payload) values('before-family','report','future@example.invalid','{}')",
  );
  await link("cus_future", child1, "Future Parent", "future@example.invalid");
  expect(
    (
      await query(
        "select status from notification_jobs where idempotency_key='before-family'",
      )
    )[0].status,
  ).toBe("held");
});

it("suggests only matching names and email addresses, not email-only or spelling guesses", () => {
  const p = {
    full_name: "Family Parent",
    contact_email: "family@example.invalid",
  };
  expect(
    sameFamilyContact(p, {
      name: " FAMILY   PARENT ",
      email: "FAMILY@example.invalid",
    }),
  ).toBe(true);
  expect(
    sameFamilyContact(p, { name: "Other Person", email: p.contact_email }),
  ).toBe(false);
  expect(
    sameFamilyContact(p, { name: p.full_name, email: "other@example.invalid" }),
  ).toBe(false);
  expect(sameFamilyContact(p, { name: null, email: p.contact_email })).toBe(
    false,
  );
  expect(
    sameFamilyContact(
      { full_name: "Sevgi Karalioglu", contact_email: p.contact_email },
      { name: "Sevgi Karalıoğlu", email: p.contact_email },
    ),
  ).toBe(false);
});

it("rejects unverified customers, items and quantities before an import", () => {
  const input = { customer_id: "cus_family", item_id: "si_child" };
  const subscription = {
    customer: "cus_family",
    items: { data: [{ id: "si_child", quantity: 1 }] },
  };
  expect(subscriptionLinkIssue(subscription, input)).toBeNull();
  expect(
    subscriptionLinkIssue({ ...subscription, customer: "cus_other" }, input),
  ).toMatch(/stimmt nicht/);
  expect(
    subscriptionLinkIssue(subscription, { ...input, item_id: "si_other" }),
  ).toMatch(/stimmt nicht/);
  expect(
    subscriptionLinkIssue(
      { ...subscription, items: { data: [{ id: "si_child", quantity: 2 }] } },
      input,
    ),
  ).toMatch(/Menge/);
  expect(
    subscriptionLinkIssue(
      { ...subscription, items: { data: [{ id: "si_child" }] } },
      input,
    ),
  ).toMatch(/Menge/);
});
