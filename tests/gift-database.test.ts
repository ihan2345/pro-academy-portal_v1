import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { applyProductSchema } from "../scripts/products-local/schema.mjs";
import { emptyProduct } from "../src/lib/products/domain";
let db: PGlite;
const id = (n: number) =>
  `b7000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let counter = 100;
const uid = id(1),
  pid = id(2),
  kid = id(3),
  otherUid = id(4),
  otherPid = id(5),
  productId = id(6);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  await applyProductSchema((sql: string) => db.exec(sql));
  await db.exec(
    "update platform_features set enabled=true where key='product_shop'",
  );
  await db.query(
    "insert into auth.users values($1,'a@example.invalid',now()),($2,'b@example.invalid',now())",
    [uid, otherUid],
  );
  await db.query(
    "insert into profiles(id,role)values($1,'parent'),($2,'parent')",
    [uid, otherUid],
  );
  await db.query(
    "insert into parents(id,auth_user_id,full_name,contact_email)values($1,$2,'Test A','a@example.invalid'),($3,$4,'Test B','b@example.invalid')",
    [pid, uid, otherPid, otherUid],
  );
  await db.query(
    "insert into players(id,first_name,last_name,birth_year)values($1,'Test','Kind',2016)",
    [kid],
  );
  await db.query(
    "insert into parent_players(parent_id,player_id) values($1,$2)",
    [pid, kid],
  );
  const p = {
    ...emptyProduct(),
    kind: "other",
    status: "active",
    name: "Guthabenkauf",
    repeatable: true,
    price: {
      id: "price_gift_test",
      product_id: "prod_gift_test",
      amount: 3500,
      currency: "eur",
      livemode: false,
      interval: null,
      interval_count: 1,
      source: "stripe",
      checked_at: new Date().toISOString(),
      product_name: "Test",
    },
  };
  await db.query(
    "insert into catalog_products(id,name,kind,draft,published,published_revision)values($1,'Guthabenkauf','other',$2,$2,1)",
    [productId, p],
  );
});
afterAll(async () => db?.close());
async function issue(amount = 5000, paidAt = new Date().toISOString()) {
  const order = id(counter++),
    hash = `hash-${order}`;
  await db.query(
    "insert into gift_orders(id,buyer,recipient,amount,livemode,access_hash,access_cipher,stripe_product_id,stripe_price_id,session_id,status)values($1,'{}','{}',$2,false,'hash','cipher','prod_gift','price_gift',$3,'checkout')",
    [order, amount, `cs_${order}`],
  );
  const input = {
    id: order,
    session_id: `cs_${order}`,
    amount,
    livemode: false,
    currency: "eur",
    payment_id: `pi_${order}`,
    paid_at: paidAt,
    code_hash: hash,
    code_cipher: "cipher",
  };
  const gift = (
    await db.query<any>("select (gift_issue_paid_order($1)).*", [input])
  ).rows[0];
  return { gift, input, hash };
}
async function claim(hash: string, parent = pid, user = uid) {
  return db.query<any>("select gift_claim($1) id", [
    { code_hash: hash, parent_id: parent, auth_id: user, livemode: false },
  ]);
}
async function reserve(use = true) {
  const r = {
    id: id(counter++),
    product_id: productId,
    revision: 1,
    parent_id: pid,
    auth_id: uid,
    player_id: kid,
    amount: 3500,
    channel: "catalog",
    use_gift_credit: use,
  };
  const i = (
    await db.query<any>("select (reserve_product_purchase($1)).*", [r])
  ).rows[0];
  return { i, r };
}
async function wallet(gift: string) {
  return (
    await db.query<any>("select * from gift_wallet_credits where gift_id=$1", [
      gift,
    ])
  ).rows[0];
}
it("issues once from verified references, keeps the same code on replay and queues exactly two messages", async () => {
  const { gift, input } = await issue();
  expect(
    (
      await db.query<any>("select (gift_issue_paid_order($1)).id", [
        { ...input, code_hash: "different" },
      ])
    ).rows[0].id,
  ).toBe(gift.id);
  expect(
    (
      await db.query("select * from gift_messages where order_id=$1", [
        input.id,
      ])
    ).rows,
  ).toHaveLength(2);
  await expect(
    db.query("select gift_issue_paid_order($1)", [{ ...input, amount: 1 }]),
  ).rejects.toThrow(/passt nicht/);
});
it("expires at the end of the third year after the purchase year, independent of delayed delivery", async () => {
  const { gift } = await issue(5000, "2024-02-29T12:00:00Z");
  expect(new Date(gift.expires_at).toISOString()).toBe(
    "2027-12-31T22:59:59.999Z",
  );
});
it.each([
  ["2026-12-31T22:59:59Z", "2029-12-31T22:59:59.999Z"],
  ["2026-12-31T23:00:00Z", "2030-12-31T22:59:59.999Z"],
])(
  "uses the German purchase year at the year boundary: %s",
  async (paid, expected) => {
    const result = await db.query<{ expiry: Date }>(
      "select gift_expiry($1) expiry",
      [paid],
    );
    expect(new Date(result.rows[0].expiry).toISOString()).toBe(expected);
  },
);
it("claims a code once, permits same-owner retries and rejects a different family or mismatched identity", async () => {
  const { gift, hash } = await issue();
  expect((await claim(hash)).rows[0].id).toBe(gift.id);
  expect((await claim(hash)).rows[0].id).toBe(gift.id);
  await expect(claim(hash, otherPid, otherUid)).rejects.toThrow(/bereits/);
  await expect(claim(hash, pid, otherUid)).rejects.toThrow(/passt nicht/);
  expect((await wallet(gift.id)).remaining).toBe(5000);
});
it("preserves expired paid value but refuses redemption after the deadline", async () => {
  const { gift, hash } = await issue(5000, "2020-01-01T00:00:00Z");
  await expect(claim(hash)).rejects.toThrow(/Einlösefrist/);
  expect(
    (
      await db.query<any>("select amount,status from gift_cards where id=$1", [
        gift.id,
      ])
    ).rows[0],
  ).toEqual({ amount: 5000, status: "issued" });
});
it("holds credit once per intent, spends only on fulfillment and retains a partial remainder", async () => {
  // Isolate this wallet from the prior claimed fixture.
  await db.exec("update gift_wallet_credits set frozen=true");
  const { gift, hash } = await issue();
  await claim(hash);
  const { i, r } = await reserve();
  expect(i.gift_credit_amount).toBe(3500);
  expect(i.expected_amount).toBe(0);
  expect((await wallet(gift.id)).reserved).toBe(3500);
  await db.query("select reserve_product_purchase($1)", [r]);
  expect((await wallet(gift.id)).reserved).toBe(3500);
  const proof = {
    session_id: `cs_${i.id}`,
    livemode: false,
    payment_status: "paid",
    gift_invoice_id: `in_${i.id}`,
    gift_payment_record_id: `pr_${i.id}`,
    gift_credit_amount: i.gift_credit_amount,
    gift_invoice_total: i.expected_amount + i.gift_credit_amount,
    price_id: "price_gift_test",
    product_id: "prod_gift_test",
    currency: "eur",
    total: 0,
    subtotal: 3500,
    quantity: 1,
    customer_id: "cus_gift_credit",
    payment_id: `cs_${i.id}`,
  };
  await db.query(
    "update product_purchase_intents set session_id=$2,customer_id='cus_gift_credit',status='checkout' where id=$1",
    [i.id, proof.session_id],
  );
  const version = (
    await db.query<any>("select product_family_version($1) v", [pid])
  ).rows[0].v;
  await expect(
    db.query("select fulfill_product_purchase($1)", [
      { id: i.id, proof, context_version: version },
    ]),
  ).rejects.toThrow(/Rechnung fehlt/);
  expect((await wallet(gift.id)).reserved).toBe(3500);
  await db.query(
    "insert into gift_billings(intent_id,livemode,invoice_id,payment_record_id,state)values($1,false,$2,$3,'settled')",
    [i.id, proof.gift_invoice_id, proof.gift_payment_record_id],
  );
  await db.query("select fulfill_product_purchase($1)", [
    { id: i.id, proof, context_version: version },
  ]);
  await db.query(
    "update product_purchase_intents set status='fulfilled' where id=$1",
    [i.id],
  );
  expect(await wallet(gift.id)).toMatchObject({ remaining: 1500, reserved: 0 });
  const { i: next } = await reserve();
  expect(next.gift_credit_amount).toBe(1500);
  expect(next.expected_amount).toBe(2000);
  await db.query(
    "update product_purchase_intents set status='expired' where id=$1",
    [next.id],
  );
  expect(await wallet(gift.id)).toMatchObject({ remaining: 1500, reserved: 0 });
  const expires = (await wallet(gift.id)).expires_at;
  await db.query(
    "update product_purchase_intents set status='refunded' where id=$1",
    [i.id],
  );
  await db.query(
    "update product_purchase_intents set status='refunded' where id=$1",
    [i.id],
  );
  expect(await wallet(gift.id)).toMatchObject({
    remaining: 5000,
    reserved: 0,
    expires_at: expires,
  });
});
it("keeps a failed payment reserved until a proven expiration releases it", async () => {
  const { i } = await reserve();
  await db.query(
    "update product_purchase_intents set status='failed' where id=$1",
    [i.id],
  );
  expect(
    (
      await db.query<any>(
        "select sum(reserved)::int n from gift_wallet_credits where not frozen",
      )
    ).rows[0].n,
  ).toBe(3500);
  await db.query(
    "update product_purchase_intents set status='expired' where id=$1",
    [i.id],
  );
  expect(
    (
      await db.query<any>(
        "select sum(reserved)::int n from gift_wallet_credits where not frozen",
      )
    ).rows[0].n,
  ).toBe(0);
});
it("does not touch wallet balances for purchases without the explicit credit flag", async () => {
  const { i } = await reserve(false);
  expect(i.expected_amount).toBe(3500);
  expect(i.gift_credit_amount).toBe(0);
  await db.query(
    "update product_purchase_intents set status='expired' where id=$1",
    [i.id],
  );
});
it("freezes refunded gift value atomically and prevents fulfillment using a frozen hold", async () => {
  const { i } = await reserve();
  const allocation = (
    await db.query<any>(
      "select gift_id from gift_allocations where intent_id=$1",
      [i.id],
    )
  ).rows[0];
  const order = (
    await db.query<any>("select order_id from gift_cards where id=$1", [
      allocation.gift_id,
    ])
  ).rows[0];
  await db.query("select gift_freeze_order($1)", [
    { id: order.order_id, status: "refunded" },
  ]);
  await expect(
    db.query(
      "update product_purchase_intents set status='fulfilled' where id=$1",
      [i.id],
    ),
  ).rejects.toThrow(/Prüfung/);
  expect(
    (
      await db.query<any>(
        "select status from product_purchase_intents where id=$1",
        [i.id],
      )
    ).rows[0].status,
  ).toBe("reserved");
  await db.query(
    "update product_purchase_intents set status='expired' where id=$1",
    [i.id],
  );
});
it("leaves a valid 50-cent Stripe remainder while retaining unused cents in the wallet", async () => {
  await db.exec("update gift_wallet_credits set frozen=true");
  const { gift, hash } = await issue(3480);
  await claim(hash);
  const { i } = await reserve();
  expect(i.expected_amount).toBe(50);
  expect(i.gift_credit_amount).toBe(3450);
  expect(
    (await wallet(gift.id)).remaining - (await wallet(gift.id)).reserved,
  ).toBe(30);
  await db.query(
    "update product_purchase_intents set status='expired' where id=$1",
    [i.id],
  );
});
it("allocates one family balance across different children without overspending", async () => {
  await db.exec("update gift_wallet_credits set frozen=true");
  const { gift, hash } = await issue();
  await claim(hash);
  const secondKid = id(counter++);
  await db.query(
    "insert into players(id,first_name,last_name,birth_year)values($1,'Zweites','Kind',2016)",
    [secondKid],
  );
  await db.query(
    "insert into parent_players(parent_id,player_id)values($1,$2)",
    [pid, secondKid],
  );
  const inputs = [kid, secondKid].map((player_id) => ({
    id: id(counter++),
    product_id: productId,
    revision: 1,
    parent_id: pid,
    auth_id: uid,
    player_id,
    amount: 3500,
    channel: "catalog",
    use_gift_credit: true,
  }));
  const results = await Promise.all(
    inputs.map((v) =>
      db.query<any>(
        "select (reserve_product_purchase($1)).gift_credit_amount used",
        [v],
      ),
    ),
  );
  expect(results.map((r) => r.rows[0].used).sort((a, b) => a - b)).toEqual([
    1500, 3500,
  ]);
  expect((await wallet(gift.id)).reserved).toBe(5000);
  await expect(
    db.query("select reserve_product_purchase($1)", [
      { ...inputs[0], use_gift_credit: false },
    ]),
  ).rejects.toThrow(/Guthabenwahl/);
  for (const v of inputs)
    await db.query(
      "update product_purchase_intents set status='expired' where id=$1",
      [v.id],
    );
});
it("allows shared catalogue denominations while keeping accounting RPCs inaccessible to browser roles", async () => {
  const gift = {
    ...emptyProduct(),
    name: "Geschenk 50",
    kind: "gift",
    gift_amount: 5000,
  };
  await db.query(
    "insert into catalog_products(name,kind,draft)values('Gift A','gift',$1)",
    [gift],
  );
  await db.query(
    "insert into catalog_products(name,kind,draft)values('Gift B','gift',$1)",
    [gift],
  );
  const r = (
    await db.query<any>(
      "select has_function_privilege('authenticated','gift_claim(jsonb)','execute') allowed,has_function_privilege('service_role','reserve_product_purchase_before_gifts(jsonb)','execute') bypass",
    )
  ).rows[0];
  expect(r).toEqual({ allowed: false, bypass: false });
});
