import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { beforeAll, afterAll, it, expect } from "vitest";
import { applyProductSchema } from "../scripts/products-local/schema.mjs";
import { emptyProduct } from "../src/lib/products/domain";
let db: PGlite;
const id = (n: number) =>
  `b7200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let counter = 100;
const uid = id(1),
  pid = id(2),
  kid = id(3),
  otherUid = id(4),
  otherPid = id(5),
  productId = id(6);
beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
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
async function codeReserve(hash: string, extra: Record<string, unknown> = {}) {
  const n = counter++,
    request = {
      id: id(n),
      product_id: productId,
      revision: 1,
      parent_id: pid,
      auth_id: uid,
      player_id: kid,
      amount: 3500,
      channel: "catalog",
      gift_code_hash: hash,
      gift_next_hash: `next-${n}`,
      gift_next_cipher: `cipher-next-${n}`,
      gift_refund_hash: `refund-${n}`,
      gift_refund_cipher: `cipher-refund-${n}`,
      ...extra,
    };
  return {
    request,
    intent: (
      await db.query<any>("select (reserve_product_purchase($1)).*", [request])
    ).rows[0],
  };
}
async function card(gid: string) {
  return (await db.query<any>("select * from gift_cards where id=$1", [gid]))
    .rows[0];
}
async function complete(i: any) {
  const session = `cs_${i.id}`;
  await db.query(
    "update product_purchase_intents set session_id=$2,customer_id='cus_gift_code',status='checkout' where id=$1 and status<>'fulfilled'",
    [i.id, session],
  );
  const proof = {
    session_id: session,
    livemode: false,
    payment_status: "paid",
    gift_invoice_id: `in_${i.id}`,
    gift_payment_record_id: `pr_${i.id}`,
    gift_credit_amount: i.gift_credit_amount,
    gift_invoice_total: i.expected_amount + i.gift_credit_amount,
    price_id: "price_gift_test",
    product_id: "prod_gift_test",
    currency: "eur",
    total: i.expected_amount,
    subtotal: 3500,
    quantity: 1,
    customer_id: "cus_gift_code",
    payment_id: `pay_${i.id}`,
  };
  const context_version = (
    await db.query<any>("select product_family_version($1) v", [pid])
  ).rows[0].v;
  await db.query(
    "insert into gift_billings(intent_id,livemode,invoice_id,payment_record_id,state)values($1,false,$2,$3,'settled')on conflict do nothing",
    [i.id, proof.gift_invoice_id, proof.gift_payment_record_id],
  );
  await db.query("select fulfill_product_purchase($1)", [
    { id: i.id, proof, context_version },
  ]);
}
const account = async (user = uid) =>
  (
    await db.query<any>("select gift_account_state($1) v", [
      { auth_id: user, livemode: false },
    ])
  ).rows[0].v;
async function parties(
  order: string,
  buyer = "a@example.invalid",
  recipient = "b@example.invalid",
) {
  await db.query("update gift_orders set buyer=$2,recipient=$3 where id=$1", [
    order,
    { full_name: "Test A", email: buyer },
    { first_name: "Test", last_name: "B", email: recipient },
  ]);
}
it("automatically associates verified buyer/recipient email roles while protecting remaining codes from the buyer", async () => {
  const { gift } = await issue();
  await parties(gift.order_id);
  const buyer = await account(uid),
    recipient = await account(otherUid);
  expect(buyer.cards[0]).toMatchObject({
    roles: ["buyer"],
    remaining: null,
    available: 0,
    code_cipher: null,
  });
  expect(recipient.cards[0]).toMatchObject({
    roles: ["recipient"],
    remaining: 5000,
    available: 5000,
    code_cipher: "cipher",
  });
  expect(recipient.available).toBe(5000);
  expect((await account(otherUid)).cards).toHaveLength(1);
});
it("keeps one card with both roles when buyer and beneficiary share the same verified address", async () => {
  const { gift } = await issue();
  await parties(gift.order_id, "a@example.invalid", "a@example.invalid");
  const v = await account(uid),
    card = v.cards.find((c: any) => c.id === gift.order_id);
  expect(card.roles).toEqual(["buyer", "recipient"]);
  expect(v.cards.filter((c: any) => c.id === gift.order_id)).toHaveLength(1);
});
it("retains a profile association across code rotation and account email changes without changing the value", async () => {
  const { gift, hash } = await issue(5000);
  await parties(gift.order_id, "someone@example.invalid", "a@example.invalid");
  await account(uid);
  const use = await codeReserve(hash);
  await complete(use.intent);
  await db.query(
    "update auth.users set email='changed@example.invalid' where id=$1",
    [uid],
  );
  const v = await account(uid),
    card = v.cards.find((c: any) => c.id === gift.order_id);
  expect(card).toMatchObject({
    remaining: 1500,
    available: 1500,
    code_cipher: use.request.gift_next_cipher,
  });
  expect(
    (
      await db.query<any>("select remaining from gift_cards where id=$1", [
        gift.id,
      ])
    ).rows[0].remaining,
  ).toBe(1500);
  await db.query(
    "update auth.users set email='a@example.invalid' where id=$1",
    [uid],
  );
});
it("accepts a personal recipient proof for a gift sent to another email and prevents a second profile owner", async () => {
  const { gift } = await issue();
  await parties(
    gift.order_id,
    "else@example.invalid",
    "elsewhere@example.invalid",
  );
  await db.query(
    "update gift_orders set recipient_access_hash='recipient-proof',recipient_access_cipher='cipher' where id=$1",
    [gift.order_id],
  );
  const input = {
    auth_id: uid,
    livemode: false,
    order_id: gift.order_id,
    status_hash: "recipient-proof",
  };
  const v = (await db.query<any>("select gift_account_link($1) v", [input]))
    .rows[0].v;
  expect(v.linked_scope).toBe("recipient");
  await db.query("select gift_account_link($1)", [input]);
  expect(
    (
      await db.query("select * from gift_account_links where order_id=$1", [
        gift.order_id,
      ])
    ).rows,
  ).toHaveLength(1);
  await expect(
    db.query("select gift_account_link($1)", [{ ...input, auth_id: otherUid }]),
  ).rejects.toThrow(/anderen Elternkonto/);
});
it("does not upgrade a buyer to recipient merely because the original code is known", async () => {
  const { gift, hash } = await issue();
  await parties(gift.order_id, "a@example.invalid", "else@example.invalid");
  const v = (
    await db.query<any>("select gift_account_link($1) v", [
      { auth_id: uid, livemode: false, code_hash: hash },
    ])
  ).rows[0].v;
  expect(v.linked_scope).toBe("buyer");
  expect(
    v.cards.find((c: any) => c.id === gift.order_id).code_cipher,
  ).toBeNull();
});
it("shows historical cards at zero balance and does not count expired, reserved or refunded funds as available", async () => {
  const { gift, hash } = await issue(3500);
  await parties(gift.order_id, "none@example.invalid", "a@example.invalid");
  await account(uid);
  const use = await codeReserve(hash);
  let card = (await account(uid)).cards.find(
    (c: any) => c.id === gift.order_id,
  );
  expect(card.available).toBe(0);
  expect(card.reserved).toBe(3500);
  await complete(use.intent);
  card = (await account(uid)).cards.find((c: any) => c.id === gift.order_id);
  expect(card).toMatchObject({
    remaining: 0,
    available: 0,
    code_cipher: null,
    gift_status: "spent",
  });
  const expired = await issue(5000, "2020-01-01T00:00:00Z");
  await parties(
    expired.gift.order_id,
    "none@example.invalid",
    "a@example.invalid",
  );
  expect(
    (await account(uid)).cards.find((c: any) => c.id === expired.gift.order_id),
  ).toMatchObject({ available: 0, gift_status: "expired", code_cipher: null });
});
it("requires a confirmed parent and makes profile-link tables inaccessible to browser roles", async () => {
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [
    otherUid,
  ]);
  await expect(account(otherUid)).rejects.toThrow(/Bestätigtes Elternkonto/);
  expect(
    (
      await db.query<any>(
        "select has_table_privilege('authenticated','gift_account_links','select') r,has_function_privilege('authenticated','gift_account_state(jsonb)','execute') x",
      )
    ).rows[0],
  ).toEqual({ r: false, x: false });
});
