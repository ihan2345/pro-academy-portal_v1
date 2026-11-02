import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { beforeAll, afterAll, it, expect } from "vitest";
import { applyProductSchema } from "../scripts/products-local/schema.mjs";
import { emptyProduct } from "../src/lib/products/domain";
let db: PGlite;
const id = (n: number) =>
  `b7100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
it("rotates the code after every confirmed use down to zero and keeps the original expiry", async () => {
  const { gift, hash } = await issue(10000),
    expires = gift.expires_at;
  const first = await codeReserve(hash);
  expect(first.intent.gift_credit_amount).toBe(3500);
  expect((await card(gift.id)).code_hash).toBe(hash);
  await db.query("select reserve_product_purchase($1)", [first.request]);
  expect((await card(gift.id)).reserved).toBe(3500);
  await complete(first.intent);
  await complete(first.intent);
  expect(await card(gift.id)).toMatchObject({
    remaining: 6500,
    reserved: 0,
    code_hash: first.request.gift_next_hash,
    expires_at: expires,
  });
  expect(
    (
      await db.query(
        "select * from gift_balance_messages where order_id=$1 and status='pending'",
        [gift.order_id],
      )
    ).rows,
  ).toHaveLength(1);
  await expect(codeReserve(hash)).rejects.toThrow(
    /Geschenkcode ist nicht verfügbar/,
  );
  const second = await codeReserve(String(first.request.gift_next_hash));
  await complete(second.intent);
  expect(await card(gift.id)).toMatchObject({
    remaining: 3000,
    code_hash: second.request.gift_next_hash,
    expires_at: expires,
  });
  const third = await codeReserve(String(second.request.gift_next_hash));
  expect(third.intent.expected_amount).toBe(500);
  await complete(third.intent);
  expect(await card(gift.id)).toMatchObject({
    remaining: 0,
    reserved: 0,
    expires_at: expires,
  });
  expect(
    (
      await db.query(
        "select * from gift_balance_messages where order_id=$1 and status='pending'",
        [gift.order_id],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query(
        "select * from gift_code_uses where gift_id=$1 and state='spent'",
        [gift.id],
      )
    ).rows,
  ).toHaveLength(3);
});
it("keeps the old code/value on an abandoned checkout and prevents simultaneous uses of one version", async () => {
  const { gift, hash } = await issue(5000),
    a = await codeReserve(hash);
  const kid2 = id(counter++);
  await db.query(
    "insert into players(id,first_name,last_name,birth_year)values($1,'Test','Zwei',2016)",
    [kid2],
  );
  await db.query(
    "insert into parent_players(parent_id,player_id)values($1,$2)",
    [pid, kid2],
  );
  await expect(codeReserve(hash, { player_id: kid2 })).rejects.toThrow(
    /offenen Kauf reserviert/,
  );
  await db.query(
    "update product_purchase_intents set status='failed' where id=$1",
    [a.intent.id],
  );
  expect((await card(gift.id)).reserved).toBe(3500);
  await db.query(
    "update product_purchase_intents set status='expired' where id=$1",
    [a.intent.id],
  );
  expect(await card(gift.id)).toMatchObject({
    remaining: 5000,
    reserved: 0,
    code_hash: hash,
  });
  const b = await codeReserve(hash);
  await db.query(
    "update product_purchase_intents set status='expired' where id=$1",
    [b.intent.id],
  );
});
it("returns a fully refunded purchase contribution once, rotates again, and retains its expiry and audit history", async () => {
  const { gift, hash } = await issue(5000),
    a = await codeReserve(hash);
  await complete(a.intent);
  const refund = {
    id: a.intent.id,
    record_id: `pr_${a.intent.id}`,
    credit_note_id: `cn_${a.intent.id}`,
    amount: a.intent.gift_credit_amount,
  };
  await db.query("select gift_start_return($1)", [{ id: a.intent.id }]);
  await expect(
    db.query("select gift_complete_return($1)", [refund]),
  ).rejects.toThrow(/Erstattungsnachweis/);
  expect((await card(gift.id)).remaining).toBe(1500);
  await db.query(
    "update gift_billings set credit_note_id=$2 where intent_id=$1",
    [a.intent.id, refund.credit_note_id],
  );
  await db.query("select gift_complete_return($1)", [refund]);
  await db.query("select gift_complete_return($1)", [refund]);
  expect(await card(gift.id)).toMatchObject({
    remaining: 5000,
    reserved: 0,
    code_hash: a.request.gift_refund_hash,
    expires_at: gift.expires_at,
  });
  expect(
    (
      await db.query<any>(
        "select state,refund_before_balance,refund_after_balance from gift_code_uses where intent_id=$1",
        [a.intent.id],
      )
    ).rows[0],
  ).toEqual({
    state: "returned",
    refund_before_balance: 1500,
    refund_after_balance: 5000,
  });
});
it("rejects changed request identities and cannot move a partially used card into the former face-value wallet", async () => {
  const { gift, hash } = await issue(5000),
    a = await codeReserve(hash);
  await expect(
    db.query("select reserve_product_purchase($1)", [
      { ...a.request, gift_code_hash: "other" },
    ]),
  ).rejects.toThrow(/anderen Gutscheinkauf/);
  await expect(
    db.query("select reserve_product_purchase($1)", [
      { ...a.request, gift_code_hash: undefined },
    ]),
  ).rejects.toThrow(/Geschenkcode wurde geändert/);
  await complete(a.intent);
  await expect(claim(String(a.request.gift_next_hash))).rejects.toThrow(
    /direkt im Checkout/,
  );
  expect((await card(gift.id)).remaining).toBe(1500);
});
it("accepts guest checkout without a wallet account and does not claim ownership while reserving", async () => {
  const { gift, hash } = await issue(5000),
    kid3 = id(counter++);
  const a = await codeReserve(hash, {
    parent_id: undefined,
    auth_id: undefined,
    player_id: kid3,
    guest_token_hash: "b".repeat(64),
    guest_data: {
      full_name: "Gast Beispiel",
      email: "guest-code@example.invalid",
      phone: "0123456789",
    },
    player_data: {
      first_name: "Gast",
      last_name: "Kind",
      birth_date: "2016-03-01",
    },
  });
  expect(a.intent.parent_id).toBeNull();
  expect(a.intent.expected_amount).toBe(0);
  expect(
    (
      await db.query("select * from gift_wallet_credits where gift_id=$1", [
        gift.id,
      ])
    ).rows,
  ).toHaveLength(0);
  await db.query(
    "update product_purchase_intents set status='expired' where id=$1",
    [a.intent.id],
  );
});
it("blocks frozen and expired cards and prevents browser roles from inspecting financial history", async () => {
  const expired = await issue(5000, "2020-01-01T00:00:00Z");
  await expect(codeReserve(expired.hash)).rejects.toThrow(/abgelaufen/);
  const frozen = await issue();
  await db.query("select gift_freeze_order($1)", [
    { id: frozen.gift.order_id, status: "refunded" },
  ]);
  await expect(codeReserve(frozen.hash)).rejects.toThrow(
    /Geschenkcode ist nicht verfügbar/,
  );
  expect(
    (
      await db.query<any>(
        "select has_table_privilege('authenticated','gift_code_uses','select') allowed,has_function_privilege('authenticated','gift_claim_balance_messages(boolean,uuid)','execute') send",
      )
    ).rows[0],
  ).toEqual({ allowed: false, send: false });
});
