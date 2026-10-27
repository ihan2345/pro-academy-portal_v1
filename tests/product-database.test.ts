import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { applyProductSchema } from "../scripts/products-local/schema.mjs";
import { emptyProduct } from "../src/lib/products/domain";
let db: PGlite;
const id = (n: number) =>
  `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
    "insert into auth.users values($1,'admin@example.invalid',now()),($2,'parent@example.invalid',now())",
    [id(1), id(2)],
  );
  await db.query(
    "insert into profiles(id,role) values($1,'admin'),($2,'parent')",
    [id(1), id(2)],
  );
});
afterAll(async () => db?.close());
async function asUser(user: string, sql: string, params: unknown[] = []) {
  await db.exec("begin;set local role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    const r = await db.query<any>(sql, params);
    await db.exec("commit");
    return r.rows;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
it("installs the full release chain and keeps the paid conversion cores private", async () => {
  const r = await db.query<any>(
    "select has_function_privilege('authenticated','public.product_trial_conversion_core(jsonb)','execute') allowed, has_function_privilege('service_role','public.product_assignment_core(jsonb)','execute') service_allowed",
  );
  expect(r.rows[0]).toEqual({ allowed: false, service_allowed: false });
  expect(
    (await db.query("select product_context_version() version")).rows,
  ).toHaveLength(1);
});
it("parents cannot create products, read internal catalogue rows or invoke fulfillment", async () => {
  await expect(
    asUser(id(2), "select save_catalog_product($1)", [
      { data: emptyProduct() },
    ]),
  ).rejects.toThrow("Keine Berechtigung");
  expect(await asUser(id(2), "select * from catalog_products")).toEqual([]);
  await expect(
    asUser(id(2), "select fulfill_product_purchase('{}')"),
  ).rejects.toThrow(/permission denied/);
});
it("preserves published versions, rejects lost updates and does not disable plans on archival", async () => {
  const data = { ...emptyProduct(), name: "Freier Produktname" };
  const [created] = await asUser(id(1), "select save_catalog_product($1) id", [
    { data },
  ]);
  const pid = created.id;
  await db.query("select publish_catalog_product($1)", [
    {
      id: pid,
      revision: 1,
      actor_id: id(1),
      context_version: (
        await db.query<any>("select product_context_version() v")
      ).rows[0].v,
    },
  ]);
  await asUser(id(1), "select save_catalog_product($1)", [
    { id: pid, revision: 1, data: { ...data, name: "Geänderter Name" } },
  ]);
  const p = (
    await db.query<any>("select * from catalog_products where id=$1", [pid])
  ).rows[0];
  expect(p.published.name).toBe("Freier Produktname");
  expect(p.draft.name).toBe("Geänderter Name");
  await expect(
    asUser(id(1), "select save_catalog_product($1)", [
      { id: pid, revision: 1, data },
    ]),
  ).rejects.toThrow(/zwischenzeitlich/);
  await db.query("select publish_catalog_product($1)", [
    {
      id: pid,
      revision: 2,
      actor_id: id(1),
      context_version: (
        await db.query<any>("select product_context_version() v")
      ).rows[0].v,
    },
  ]);
  expect(
    (
      await db.query(
        "select * from catalog_product_versions where product_id=$1",
        [pid],
      )
    ).rows,
  ).toHaveLength(2);
});
it("rejects unverified active products and stale impact snapshots", async () => {
  const [p] = await asUser(id(1), "select save_catalog_product($1) id", [
    { data: { ...emptyProduct(), status: "active", channels: ["catalog"] } },
  ]);
  const context_version = (
    await db.query<any>("select product_context_version() v")
  ).rows[0].v;
  await expect(
    db.query("select publish_catalog_product($1)", [
      { id: p.id, revision: 1, context_version, actor_id: id(1) },
    ]),
  ).rejects.toThrow(/Stripe/);
  await expect(
    db.query("select publish_catalog_product($1)", [
      { id: p.id, revision: 1, context_version: "stale", actor_id: id(1) },
    ]),
  ).rejects.toThrow(/Vorschau/);
});

const testProduct = async (
  kind: "subscription" | "other",
  price: string,
  plan?: string,
) => {
  const data = {
    ...emptyProduct(),
    name: `Produkt ${price}`,
    kind,
    status: "active",
    channels: ["catalog"],
    plan_id: plan ?? null,
    price: {
      id: price,
      product_id: `prod_${price}`,
      amount: 9900,
      currency: "eur",
      interval: kind === "subscription" ? "month" : null,
      interval_count: 1,
      livemode: false,
      checked_at: new Date().toISOString(),
      product_name: "Test",
      source: "stripe",
    },
  };
  const [p] = await asUser(id(1), "select save_catalog_product($1) id", [
    { data },
  ]);
  await db.query("select publish_catalog_product($1)", [
    {
      id: p.id,
      revision: 1,
      actor_id: id(1),
      context_version: (
        await db.query<any>("select product_context_version() v")
      ).rows[0].v,
    },
  ]);
  return { id: p.id, data };
};
it("reserves a single purchase per child and validates every payment reference", async () => {
  const pid = id(20),
    kid = id(21);
  await db.query(
    "insert into parents(id,auth_user_id,full_name,contact_email)values($1,$2,'Testfamilie','parent@example.invalid')",
    [pid, id(2)],
  );
  await db.query(
    "insert into players(id,first_name,last_name,birth_year)values($1,'Kind','Test',2016)",
    [kid],
  );
  await db.query(
    "insert into parent_players(parent_id,player_id)values($1,$2)",
    [pid, kid],
  );
  const p = await testProduct("other", "price_once"),
    request = {
      id: id(22),
      product_id: p.id,
      revision: 1,
      parent_id: pid,
      auth_id: id(2),
      player_id: kid,
      amount: 9900,
      customer_id: "cus_payment_test",
      channel: "catalog",
    };
  await db.query("select reserve_product_purchase($1)", [request]);
  await expect(
    db.query("select reserve_product_purchase($1)", [
      { ...request, id: id(23) },
    ]),
  ).rejects.toThrow(/bereits ein Kauf offen/);
  await db.query(
    "update product_purchase_intents set status='checkout',session_id='cs_test_once' where id=$1",
    [id(22)],
  );
  const proof = {
    session_id: "cs_test_once",
    livemode: false,
    payment_status: "paid",
    price_id: "price_once",
    product_id: "prod_price_once",
    currency: "eur",
    total: 9900,
    subtotal: 9900,
    quantity: 1,
    customer_id: "cus_payment_test",
    payment_id: "pi_test_once",
  };
  await expect(
    db.query("select fulfill_product_purchase($1)", [
      { id: id(22), proof: { ...proof, total: 1 } },
    ]),
  ).rejects.toThrow(/Zahlungsnachweis/);
  expect((await db.query("select * from product_purchases")).rows).toHaveLength(
    0,
  );
  const context_version = (
    await db.query<any>("select product_family_version($1) v", [id(20)])
  ).rows[0].v;
  await db.query("select fulfill_product_purchase($1)", [
    { id: id(22), proof, context_version },
  ]);
  await db.query("select fulfill_product_purchase($1)", [
    { id: id(22), proof, context_version },
  ]);
  expect(
    (
      await db.query("select * from product_purchases where intent_id=$1", [
        id(22),
      ])
    ).rows,
  ).toHaveLength(1);
});
it("performs the existing atomic Trial conversion for a paid order using the SAME camp child identity", async () => {
  const parent = id(20),
    kid = id(31),
    family = id(30);
  await db.query(
    "insert into trial_families(id,parent_id,auth_user_id,request_input,parent_name,email,phone,operational_consent,privacy_acknowledged,marketing_consent,email_verified_at)values($1,$2,$3,'{}','Testfamilie','trial@example.invalid','00000',true,true,false,now())",
    [family, parent, id(2)],
  );
  await db.query(
    "insert into trial_players(id,family_id,first_name,last_name,birth_date,original_data)values($1,$2,'Trialkind','Test','2016-04-15','{}')",
    [kid, family],
  );
  await db.query(
    "insert into trial_requests(family_id,player_id,first_name,last_name,birth_date)values($1,$2,'Trialkind','Test','2016-04-15')",
    [family, kid],
  );
  await db.query("select prepare_trial_camp_player($1,$2)", [parent, kid]);
  const plan = (
    await db.query<any>(
      "select id,stripe_price_id from plans where name='FirstTouch' and generation='current' limit 1",
    )
  ).rows[0];
  const p = await testProduct("subscription", plan.stripe_price_id, plan.id),
    order = id(32),
    customer = "cus_trial_test",
    sid = "sub_trial_paid",
    item = "si_trial_paid";
  await db.query("select reserve_product_purchase($1)", [
    {
      id: order,
      product_id: p.id,
      revision: 1,
      parent_id: parent,
      auth_id: id(2),
      player_id: kid,
      amount: 9900,
      customer_id: customer,
      channel: "trials",
    },
  ]);
  await db.query(
    "update product_purchase_intents set status='checkout',session_id='cs_test_trial' where id=$1",
    [order],
  );
  const input = {
    stripe_subscription_id: sid,
    stripe_customer_id: customer,
    status: "active",
    subscription_created_at: new Date().toISOString(),
    billing_cycle_anchor: new Date().toISOString(),
    retrieved_at: new Date().toISOString(),
    items: [
      {
        id: item,
        price_id: plan.stripe_price_id,
        quantity: 1,
        starts_at: new Date(Date.now() - 86400000).toISOString(),
        ends_at: new Date(Date.now() + 29 * 86400000).toISOString(),
      },
    ],
  };
  await db.query("select apply_stripe_package_sync($1)", [input]);
  expect(
    (
      await db.query("select * from entitlement_periods where player_id=$1", [
        kid,
      ])
    ).rows,
  ).toHaveLength(0);
  const proof = {
    session_id: "cs_test_trial",
    livemode: false,
    payment_status: "paid",
    price_id: plan.stripe_price_id,
    product_id: `prod_${plan.stripe_price_id}`,
    currency: "eur",
    total: 9900,
    subtotal: 9900,
    quantity: 1,
    customer_id: customer,
    payment_id: "in_trial_paid",
  };
  const context_version = (
    await db.query<any>("select product_family_version($1) v", [id(20)])
  ).rows[0].v;
  await db.query("select fulfill_product_purchase($1)", [
    { id: order, proof, context_version, subscription_id: sid, item_id: item },
  ]);
  const converted = (
    await db.query<any>("select * from trial_players where id=$1", [kid])
  ).rows[0];
  expect(converted.converted_player_id).toBe(kid);
  expect(converted.camp_player_id).toBe(kid);
  expect(converted.converted_at).toBeTruthy();
  expect(
    (await db.query("select * from players where id=$1", [kid])).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query("select * from entitlement_periods where player_id=$1", [
        kid,
      ])
    ).rows,
  ).toHaveLength(1);
  expect(
    (await db.query("select * from parent_players where player_id=$1", [kid]))
      .rows,
  ).toHaveLength(1);
});
it("keeps private draft text and sort changes out of the public catalogue", async () => {
  const p = await testProduct("other", "price_isolated");
  const before = (
    await db.query<any>(
      "select published_search_document::text search,published_sort_order from catalog_products where id=$1",
      [p.id],
    )
  ).rows[0];
  await asUser(id(1), "select save_catalog_product($1)", [
    {
      id: p.id,
      revision: 1,
      data: { ...p.data, name: "Geheimer Entwurf", sort_order: 100 },
    },
  ]);
  const after = (
    await db.query<any>(
      "select published_search_document::text search,published_sort_order from catalog_products where id=$1",
      [p.id],
    )
  ).rows[0];
  expect(after).toEqual(before);
});
it("confirms an API Camp checkout through the existing payment/capacity routine without a fabricated link", async () => {
  const camp = id(50),
    offer = id(51),
    plan = id(52),
    parent = id(20),
    kid = id(21),
    order = id(53);
  await db.query(
    "insert into camps(id,title,location,capacity,min_age,max_age,status,payment_mode,days)values($1,'Testcamp','Testplatz',2,5,18,'open','test',$2)",
    [
      camp,
      [
        {
          starts_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          ends_at: new Date(Date.now() + 30 * 86400000 + 3600000).toISOString(),
        },
      ],
    ],
  );
  await db.query(
    "insert into plans(id,name,stripe_price_id,included_units,athletics_units,generation,billing_interval,active,is_public,is_camp,camp_id)values($1,'Testcamp','price_camp_api',0,0,'special','month',false,false,true,$2)",
    [plan, camp],
  );
  await db.query(
    "insert into camp_offers(id,camp_id,plan_id,kind,stripe_price_id,stripe_product_id,stripe_payment_link_id,payment_url,amount)values($1,$2,$3,'main','price_camp_api','prod_camp_api','plink_historical_fixture','https://buy.stripe.com/fixture',9900)",
    [offer, camp, plan],
  );
  const data = {
    ...emptyProduct(),
    kind: "camp",
    name: "Camp API",
    status: "active",
    channels: ["catalog"],
    camp_offer_id: offer,
    price: {
      id: "price_camp_api",
      product_id: "prod_camp_api",
      amount: 9900,
      currency: "eur",
      interval: null,
      interval_count: 1,
      livemode: false,
      checked_at: new Date().toISOString(),
      product_name: "Test",
      source: "stripe",
    },
  };
  const [p] = await asUser(id(1), "select save_catalog_product($1) id", [
    { data },
  ]);
  await db.query("select publish_catalog_product($1)", [
    {
      id: p.id,
      revision: 1,
      actor_id: id(1),
      context_version: (
        await db.query<any>("select product_context_version() v")
      ).rows[0].v,
    },
  ]);
  await db.query("select reserve_product_purchase($1)", [
    {
      id: order,
      product_id: p.id,
      revision: 1,
      parent_id: parent,
      auth_id: id(2),
      player_id: kid,
      customer_id: "cus_payment_test",
      amount: 9900,
      channel: "catalog",
      camp_details: {
        first_name: "Kind",
        last_name: "Test",
        birth_date: "2016-04-15",
        gender: "keine Angabe",
        clothing_size: "M",
      },
    },
  ]);
  await db.query(
    "update product_purchase_intents set status='checkout',session_id='cs_test_camp' where id=$1",
    [order],
  );
  const proof = {
    session_id: "cs_test_camp",
    livemode: false,
    payment_status: "paid",
    price_id: "price_camp_api",
    product_id: "prod_camp_api",
    currency: "eur",
    subtotal: 9900,
    total: 9900,
    quantity: 1,
    customer_id: "cus_payment_test",
    payment_id: "pi_camp_api",
  };
  await db.query("select fulfill_product_purchase($1)", [
    {
      id: order,
      proof,
      context_version: (
        await db.query<any>("select product_family_version($1) v", [parent])
      ).rows[0].v,
    },
  ]);
  const booking = (
    await db.query<any>(
      "select * from camp_bookings where product_intent_id=$1",
      [order],
    )
  ).rows[0];
  expect(booking.status).toBe("paid");
  expect(booking.stripe_payment_link_id).toBeNull();
  expect(booking.booking_origin).toBe("api_checkout");
  expect(booking.player_id).toBe(kid);
});
it("creates a new parent only for the verified authenticated identity without a duplicate or any child membership", async () => {
  const uid = id(70);
  await db.query(
    "insert into auth.users values($1,'fresh@example.invalid',now())",
    [uid],
  );
  const [r] = await asUser(uid, "select prepare_product_parent($1) id", [
    "Neue Testfamilie",
  ]);
  expect(
    (
      await asUser(uid, "select prepare_product_parent($1) id", [
        "Neue Testfamilie",
      ])
    )[0].id,
  ).toBe(r.id);
  expect(
    (await db.query("select * from parent_players where parent_id=$1", [r.id]))
      .rows,
  ).toHaveLength(0);
  await expect(
    asUser(id(1), "select prepare_product_parent($1)", ["Admin Test"]),
  ).rejects.toThrow(/Teamkonten/);
});
it("requires current database evidence for individual grants and never exposes the service entry to parents", async () => {
  const p = await testProduct("other", "price_grant_test");
  await expect(
    asUser(id(2), "select apply_product_grant_change($1)", [{}]),
  ).rejects.toThrow(/permission denied/);
  const change = {
    action: "add",
    data: {
      parent_id: id(20),
      player_id: id(21),
      purpose: "purchase",
      expires_at: null,
      reason: "Lokale Einzelfreigabe",
    },
  };
  await expect(
    db.query("select apply_product_grant_change($1)", [
      {
        product_id: p.id,
        revision: 1,
        context_version: "outdated",
        actor_id: id(1),
        change,
      },
    ]),
  ).rejects.toThrow(/veraltet/);
  await db.query("select apply_product_grant_change($1)", [
    {
      product_id: p.id,
      revision: 1,
      context_version: (
        await db.query<any>("select product_context_version() v")
      ).rows[0].v,
      actor_id: id(1),
      change,
    },
  ]);
  expect(
    (
      await db.query(
        "select * from catalog_product_grants where product_id=$1",
        [p.id],
      )
    ).rows,
  ).toHaveLength(1);
});
it("retains the legacy admin assignment entry point and rejects parent escalation after extracting the shared core", async () => {
  const parent = id(20),
    kid = id(71),
    sid = "sub_legacy_admin_path",
    item = "si_legacy_admin_path";
  await db.query(
    "insert into players(id,first_name,last_name,birth_year)values($1,'Altes','Verfahren',2016)",
    [kid],
  );
  await db.query(
    "insert into parent_players(parent_id,player_id)values($1,$2)",
    [parent, kid],
  );
  const plan = (
    await db.query<any>(
      "select stripe_price_id from plans where name='GameChanger' and generation='current' limit 1",
    )
  ).rows[0];
  const input = {
    stripe_subscription_id: sid,
    stripe_customer_id: "cus_payment_test",
    status: "active",
    subscription_created_at: new Date().toISOString(),
    billing_cycle_anchor: new Date().toISOString(),
    retrieved_at: new Date().toISOString(),
    items: [
      {
        id: item,
        price_id: plan.stripe_price_id,
        quantity: 1,
        starts_at: new Date(Date.now() - 86400000).toISOString(),
        ends_at: new Date(Date.now() + 29 * 86400000).toISOString(),
      },
    ],
  };
  const sub = (
    await db.query<any>("select apply_stripe_package_sync($1) id", [input])
  ).rows[0].id;
  await db.query("update subscriptions set parent_id=$1 where id=$2", [
    parent,
    sub,
  ]);
  const review = (
    await db.query<any>(
      "select * from subscription_assignment_reviews where subscription_id=$1",
      [sub],
    )
  ).rows[0];
  const decision = {
    review_id: review.id,
    signature: review.signature,
    player_id: kid,
    previous_item_id: null,
  };
  await expect(
    asUser(id(2), "select resolve_subscription_assignment($1)", [decision]),
  ).rejects.toThrow(/Keine Berechtigung/);
  await asUser(id(1), "select resolve_subscription_assignment($1)", [decision]);
  expect(
    (
      await db.query("select * from entitlement_periods where player_id=$1", [
        kid,
      ])
    ).rows,
  ).toHaveLength(1);
});
it("scopes checkout evidence to the relevant family and detects changes to that family", async () => {
  const before = (
    await db.query<any>("select product_family_version($1) v", [id(20)])
  ).rows[0].v;
  await db.query(
    "insert into parents(id,full_name,contact_email)values($1,'Andere Familie','other@example.invalid')",
    [id(800)],
  );
  expect(
    (await db.query<any>("select product_family_version($1) v", [id(20)]))
      .rows[0].v,
  ).toBe(before);
  await db.query("update parents set phone='new test number' where id=$1", [
    id(20),
  ]);
  expect(
    (await db.query<any>("select product_family_version($1) v", [id(20)]))
      .rows[0].v,
  ).not.toBe(before);
});
it("fulfills a paid generic service for a Trial child without converting the Trial or duplicating the child", async () => {
  const family = id(901),
    kid = id(902),
    productId = id(903),
    order = id(904),
    parent = id(20);
  await db.query(
    "insert into trial_families(id,parent_id,auth_user_id,request_input,parent_name,email,phone,operational_consent,privacy_acknowledged,marketing_consent,email_verified_at)values($1,$2,$3,'{}','Testfamilie','trial-other@example.invalid','00000',true,true,false,now())",
    [family, parent, id(2)],
  );
  await db.query(
    "insert into trial_players(id,family_id,first_name,last_name,birth_date,original_data)values($1,$2,'Leistung','Trial','2016-04-15','{}')",
    [kid, family],
  );
  const p = {
    ...emptyProduct(),
    name: "Sonstige Trial-Leistung",
    kind: "other",
    status: "active",
    channels: ["catalog"],
    price: {
      id: "price_trial_other",
      product_id: "prod_trial_other",
      amount: 4900,
      currency: "eur",
      interval: null,
      interval_count: 1,
      livemode: false,
      checked_at: new Date().toISOString(),
      product_name: "Test",
      source: "stripe",
    },
  };
  await db.query(
    "insert into catalog_products(id,name,kind,status,draft,published,published_revision)values($1,$2,'other','active',$3,$3,1)",
    [productId, p.name, p],
  );
  await db.query("select reserve_product_purchase($1)", [
    {
      id: order,
      product_id: productId,
      revision: 1,
      parent_id: parent,
      auth_id: id(2),
      player_id: kid,
      amount: 4900,
    },
  ]);
  await db.query(
    "update product_purchase_intents set status='checkout',session_id='cs_trial_other',customer_id='cus_payment_test' where id=$1",
    [order],
  );
  const version = (
    await db.query<any>("select product_family_version($1) v", [parent])
  ).rows[0].v;
  await db.query("select fulfill_product_purchase($1)", [
    {
      id: order,
      context_version: version,
      proof: {
        session_id: "cs_trial_other",
        livemode: false,
        payment_status: "paid",
        price_id: p.price.id,
        product_id: p.price.product_id,
        currency: "eur",
        subtotal: 4900,
        total: 4900,
        quantity: 1,
        customer_id: "cus_payment_test",
        payment_id: "pi_trial_other",
      },
    },
  ]);
  expect(
    (
      await db.query<any>(
        "select converted_at,camp_player_id from trial_players where id=$1",
        [kid],
      )
    ).rows[0],
  ).toMatchObject({ converted_at: null, camp_player_id: kid });
  expect(
    (await db.query("select id from players where id=$1", [kid])).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        "select id from parent_players where parent_id=$1 and player_id=$2",
        [parent, kid],
      )
    ).rows,
  ).toHaveLength(1);
});
it("allows only admins to document payment review without erasing the refund or changing entitlements", async () => {
  const payment = id(990);
  await db.query(
    "insert into product_payment_links(id,parent_id,payment_intent_id,amount,currency,status,charge_id)values($1,$2,'pi_review_documented',4900,'eur','refunded','ch_review_documented')",
    [payment, id(20)],
  );
  await expect(
    asUser(id(2), "select resolve_product_payment_review($1)", [
      { id: payment, reason: "Testprüfung abgeschlossen" },
    ]),
  ).rejects.toThrow(/Admin/);
  const before = (
    await db.query<any>(
      "select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') v from entitlement_periods p",
    )
  ).rows[0].v;
  await asUser(id(1), "select resolve_product_payment_review($1)", [
    { id: payment, reason: "Erstattung fachlich geprüft" },
  ]);
  const row = (
    await db.query<any>("select * from product_payment_links where id=$1", [
      payment,
    ])
  ).rows[0];
  expect(row.status).toBe("refunded");
  expect(row.review_resolved_at).toBeTruthy();
  expect(row.review_resolved_by).toBe(id(1));
  expect(
    (
      await db.query<any>(
        "select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') v from entitlement_periods p",
      )
    ).rows[0].v,
  ).toEqual(before);
});
it("only a Super-Admin can toggle storefront access, with optimistic locking and audit", async () => {
  await expect(
    asUser(id(1), "select set_platform_feature('product_shop',false,true)"),
  ).rejects.toThrow(/Forbidden/);
  await expect(
    asUser(id(2), "select set_platform_feature('product_shop',false,true)"),
  ).rejects.toThrow(/Forbidden/);
  await db.query(
    "insert into platform_permissions(user_id,permission) values($1,'manage_features')",
    [id(1)],
  );
  await asUser(id(1), "select set_platform_feature('product_shop',false,true)");
  expect(
    (await db.query<any>("select product_shop_enabled() enabled")).rows[0]
      .enabled,
  ).toBe(false);
  await expect(
    asUser(id(1), "select set_platform_feature('product_shop',true,true)"),
  ).rejects.toThrow(/FEATURE_CHANGED/);
  await expect(
    db.query("select reserve_product_purchase('{}')"),
  ).rejects.toThrow(/Shop derzeit/);
  // Closing the shop does not disable paid-order fulfillment.
  await expect(
    db.query("select fulfill_product_purchase('{}')"),
  ).rejects.toThrow(/Kaufauftrag fehlt/);
  await expect(
    asUser(id(1), "update product_runtime set livemode=true"),
  ).rejects.toThrow(/permission denied/);
  await asUser(id(1), "select set_platform_feature('product_shop',true,false)");
  await db.query("delete from platform_permissions where user_id=$1", [id(1)]);
});
it("database payment verification is bound to deployment mode and retained order mode", async () => {
  const defs = (
    await db.query<any>(
      "select pg_get_functiondef('fulfill_product_purchase(jsonb)'::regprocedure) d, pg_get_functiondef('publish_catalog_product(jsonb)'::regprocedure) p",
    )
  ).rows[0];
  expect(defs.d).toContain(
    "(i.product->'price'->>'livemode')::boolean is distinct from product_payment_livemode()",
  );
  expect(defs.p).toContain("product_payment_livemode()::text");
  expect(
    (await db.query<any>("select product_payment_livemode() mode")).rows[0]
      .mode,
  ).toBe(false);
  await db.exec("update product_runtime set livemode=true");
  expect(
    (await db.query<any>("select product_payment_livemode() mode")).rows[0]
      .mode,
  ).toBe(true);
  await db.exec("update product_runtime set livemode=false");
});

async function guestOrder(n: number, email: string, amount = 9900) {
  const p = await testProduct("other", `price_guest_${n}`);
  const request = {
    id: id(n),
    product_id: p.id,
    revision: 1,
    player_id: id(n + 1),
    player_data: {
      first_name: "Gastkind",
      last_name: `Familie${n}`,
      birth_date: "2016-04-15",
    },
    guest_data: { full_name: `Gastfamilie ${n}`, email, phone: "01234" },
    guest_token_hash: "a".repeat(64),
    amount,
    customer_id: `cus_guest_${n}`,
    channel: "catalog",
    ...(amount !== 9900
      ? { discount: { promotion_id: "promo_free", amount, source: "code" } }
      : {}),
  };
  await db.query("select reserve_product_purchase($1)", [request]);
  await db.query(
    "update product_purchase_intents set status='checkout',session_id=$2 where id=$1",
    [id(n), `cs_test_guest_${n}`],
  );
  const proof = {
    session_id: `cs_test_guest_${n}`,
    livemode: false,
    payment_status: amount === 0 ? "no_payment_required" : "paid",
    price_id: p.data.price.id,
    product_id: p.data.price.product_id,
    currency: "eur",
    subtotal: 9900,
    total: amount,
    quantity: 1,
    customer_id: request.customer_id,
    payment_id: amount === 0 ? `cs_test_guest_${n}` : `pi_guest_${n}`,
  };
  return { request, proof };
}
it("creates no family before payment, rejects false proof and atomically materialises a guest family once", async () => {
  const { proof } = await guestOrder(1100, "guest1100@example.invalid");
  expect(
    (
      await db.query(
        "select * from parents where contact_email='guest1100@example.invalid'",
      )
    ).rows,
  ).toHaveLength(0);
  await expect(
    db.query("select fulfill_product_purchase($1)", [
      { id: id(1100), proof: { ...proof, total: 1 } },
    ]),
  ).rejects.toThrow(/Zahlungsnachweis/);
  expect(
    (await db.query("select * from players where id=$1", [id(1101)])).rows,
  ).toHaveLength(0);
  await db.query("select fulfill_product_purchase($1)", [
    { id: id(1100), proof },
  ]);
  await db.query("select fulfill_product_purchase($1)", [
    { id: id(1100), proof },
  ]);
  const i = (
    await db.query<any>("select * from product_purchase_intents where id=$1", [
      id(1100),
    ])
  ).rows[0];
  expect(i).toMatchObject({ status: "fulfilled", auth_id: null });
  expect(i.parent_id).toBeTruthy();
  expect(
    (
      await db.query<any>(
        "select auth_user_id,notifications_held from parents where id=$1",
        [i.parent_id],
      )
    ).rows[0],
  ).toEqual({ auth_user_id: null, notifications_held: true });
  expect(
    (
      await db.query(
        "select * from parent_players where parent_id=$1 and player_id=$2",
        [i.parent_id, id(1101)],
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        "select * from product_guest_messages where intent_id=$1",
        [id(1100)],
      )
    ).rows,
  ).toHaveLength(1);
});
it("only verified ownership of the guest email unlocks the newly created family and orders", async () => {
  await db.query(
    "insert into auth.users values($1,'guest1100@example.invalid',null),($2,'wrong@example.invalid',now())",
    [id(1110), id(1111)],
  );
  await expect(
    asUser(id(1110), "select claim_product_guest_orders()"),
  ).rejects.toThrow(/Bestätigte/);
  expect(
    (await asUser(id(1111), "select claim_product_guest_orders() ids"))[0].ids,
  ).toEqual([]);
  await db.query("update auth.users set email_confirmed_at=now() where id=$1", [
    id(1110),
  ]);
  expect(
    (await asUser(id(1110), "select claim_product_guest_orders() ids"))[0].ids,
  ).toEqual([id(1100)]);
  const i = (
    await db.query<any>("select * from product_purchase_intents where id=$1", [
      id(1100),
    ])
  ).rows[0];
  expect(i.auth_id).toBe(id(1110));
  expect(
    (
      await db.query<any>("select auth_user_id from parents where id=$1", [
        i.parent_id,
      ])
    ).rows[0].auth_user_id,
  ).toBe(id(1110));
  expect(
    (await asUser(id(1110), "select claim_product_guest_orders() ids"))[0].ids,
  ).toEqual([]);
});
it("keeps matching existing families separate until confirmed login and reuses an exact child identity", async () => {
  await db.query(
    "update players set camp_birth_date='2016-04-15' where id=$1",
    [id(21)],
  );
  const { request, proof } = await guestOrder(
    1120,
    "parent@example.invalid",
    5000,
  );
  await db.query(
    "update product_purchase_intents set player_data=$2 where id=$1",
    [
      request.id,
      { first_name: "Kind", last_name: "Test", birth_date: "2016-04-15" },
    ],
  );
  const r = (
    await db.query<any>("select fulfill_product_purchase($1) v", [
      { id: request.id, proof },
    ])
  ).rows[0].v;
  expect(r.status).toBe("review");
  expect(
    (
      await db.query<any>(
        "select parent_id,auth_id from product_purchase_intents where id=$1",
        [request.id],
      )
    ).rows[0],
  ).toEqual({ parent_id: null, auth_id: null });
  await asUser(id(2), "select claim_product_guest_orders()");
  const i = (
    await db.query<any>("select * from product_purchase_intents where id=$1", [
      request.id,
    ])
  ).rows[0];
  expect(i).toMatchObject({
    parent_id: id(20),
    auth_id: id(2),
    player_id: id(21),
    player_data: null,
    status: "checkout",
  });
  const version = (
    await db.query<any>("select product_family_version($1) v", [id(20)])
  ).rows[0].v;
  await db.query("select fulfill_product_purchase($1)", [
    { id: request.id, proof, context_version: version },
  ]);
  expect(
    (
      await db.query<any>(
        "select status from product_purchase_intents where id=$1",
        [request.id],
      )
    ).rows[0].status,
  ).toBe("fulfilled");
  expect(
    (await db.query("select * from players where id=$1", [id(1121)])).rows,
  ).toHaveLength(0);
});
it("fulfills a verified 100 percent coupon without fabricating a PaymentIntent", async () => {
  const { proof } = await guestOrder(1130, "free1130@example.invalid", 0);
  await db.query("select fulfill_product_purchase($1)", [
    { id: id(1130), proof },
  ]);
  const i = (
    await db.query<any>(
      "select status,payment_id,expected_amount from product_purchase_intents where id=$1",
      [id(1130)],
    )
  ).rows[0];
  expect(i).toEqual({
    status: "fulfilled",
    payment_id: proof.session_id,
    expected_amount: 0,
  });
});
it("does not grant public or authenticated access to private guest records or fulfillment cores", async () => {
  for (const table of [
    "product_guest_families",
    "product_guest_messages",
    "product_purchase_intents",
  ])
    await expect(asUser(id(2), `select * from ${table}`)).rejects.toThrow(
      /permission denied/,
    );
  await expect(
    asUser(id(2), "select fulfill_product_purchase_before_guest('{}')"),
  ).rejects.toThrow(/permission denied/);
  await expect(
    db.exec(
      "set role service_role;select fulfill_product_purchase_before_guest('{}')",
    ),
  ).rejects.toThrow(/permission denied/);
  await db.exec("reset role");
});
it("creates normal subscription units for a paid guest before the account is claimed", async () => {
  const plan = (
    await db.query<any>(
      "select id,stripe_price_id from plans where name='FirstTouch' and generation='current' limit 1",
    )
  ).rows[0];
  const saved = (
    await db.query<any>(
      "select * from catalog_products where published->'price'->>'id'=$1",
      [plan.stripe_price_id],
    )
  ).rows[0];
  const p = { id: saved.id, data: saved.published };
  const request = {
    id: id(1150),
    product_id: p.id,
    revision: 1,
    player_id: id(1151),
    player_data: {
      first_name: "Neues",
      last_name: "Abokind",
      birth_date: "2016-04-15",
    },
    guest_data: {
      full_name: "Neue Abofamilie",
      email: "abo1150@example.invalid",
    },
    guest_token_hash: "b".repeat(64),
    amount: 9900,
    customer_id: "cus_guest_abo",
    channel: "catalog",
  };
  await db.query("select reserve_product_purchase($1)", [request]);
  await db.query(
    "update product_purchase_intents set status='checkout',session_id='cs_test_guest_abo' where id=$1",
    [request.id],
  );
  await db.query("select apply_stripe_package_sync($1)", [
    {
      stripe_subscription_id: "sub_guest_abo",
      stripe_customer_id: request.customer_id,
      status: "active",
      subscription_created_at: new Date().toISOString(),
      billing_cycle_anchor: new Date().toISOString(),
      retrieved_at: new Date().toISOString(),
      items: [
        {
          id: "si_guest_abo",
          price_id: plan.stripe_price_id,
          quantity: 1,
          starts_at: new Date(Date.now() - 86400000).toISOString(),
          ends_at: new Date(Date.now() + 29 * 86400000).toISOString(),
        },
      ],
    },
  ]);
  const proof = {
    session_id: "cs_test_guest_abo",
    livemode: false,
    payment_status: "paid",
    price_id: plan.stripe_price_id,
    product_id: p.data.price.product_id,
    currency: "eur",
    subtotal: 9900,
    total: 9900,
    quantity: 1,
    customer_id: request.customer_id,
    payment_id: "in_guest_abo",
  };
  await db.query("select fulfill_product_purchase($1)", [
    {
      id: request.id,
      proof,
      subscription_id: "sub_guest_abo",
      item_id: "si_guest_abo",
    },
  ]);
  const i = (
    await db.query<any>("select * from product_purchase_intents where id=$1", [
      request.id,
    ])
  ).rows[0];
  expect(i).toMatchObject({ status: "fulfilled", auth_id: null });
  expect(
    (
      await db.query<any>(
        "select included_units from entitlement_periods where player_id=$1",
        [request.player_id],
      )
    ).rows[0].included_units,
  ).toBe(4);
  expect(
    (
      await db.query<any>(
        "select parent_id from subscriptions where stripe_subscription_id='sub_guest_abo'",
      )
    ).rows[0].parent_id,
  ).toBe(i.parent_id);
});
it.each(["paid", "no_payment_required"])(
  "uses the same camp identity and capacity with a verified free guest order (%s)",
  async (paymentStatus) => {
    await db.exec("begin");
    try {
      const base = paymentStatus === "paid" ? 1180 : 1160;
      const p = (
        await db.query<any>(
          "select * from catalog_products where published->>'kind'='camp' limit 1",
        )
      ).rows[0];
      const request = {
        id: id(base),
        product_id: p.id,
        revision: p.published_revision,
        player_id: id(base + 1),
        player_data: {
          first_name: "Camp",
          last_name: "Gastkind",
          birth_date: "2016-04-15",
        },
        guest_data: {
          full_name: "Campfamilie",
          email: `camp${base}@example.invalid`,
        },
        guest_token_hash: "c".repeat(64),
        amount: 0,
        customer_id: `cus_guest_camp_${base}`,
        channel: "catalog",
        discount: {
          amount: 0,
          promotion_id: "promo_camp_free",
          source: "code",
        },
        camp_details: {
          birth_date: "2016-04-15",
          gender: "keine Angabe",
          clothing_size: "M",
        },
      };
      await db.query("select reserve_product_purchase($1)", [request]);
      await db.query(
        "update product_purchase_intents set status='checkout',session_id='cs_test_guest_camp_'||$2::text where id=$1",
        [request.id, String(base)],
      );
      const proof = {
        session_id: `cs_test_guest_camp_${base}`,
        livemode: false,
        payment_status: paymentStatus,
        price_id: p.published.price.id,
        product_id: p.published.price.product_id,
        currency: "eur",
        subtotal: p.published.price.amount,
        total: 0,
        quantity: 1,
        customer_id: request.customer_id,
        payment_id: `cs_test_guest_camp_${base}`,
      };
      await db.query("select fulfill_product_purchase($1)", [
        { id: request.id, proof },
      ]);
      const i = (
        await db.query<any>(
          "select * from product_purchase_intents where id=$1",
          [request.id],
        )
      ).rows[0];
      expect(i.status).toBe("fulfilled");
      expect(
        (
          await db.query<any>(
            "select parent_id,player_id,status,paid_amount from camp_bookings where id=$1",
            [i.camp_booking_id],
          )
        ).rows[0],
      ).toEqual({
        parent_id: i.parent_id,
        player_id: request.player_id,
        status: "paid",
        paid_amount: 0,
      });
    } finally {
      await db.exec("rollback");
    }
  },
);
it("fails closed on a missing no-cost payment status without creating a family", async () => {
  const { proof } = await guestOrder(1170, "guard1170@example.invalid", 0);
  const { payment_status: _, ...missingStatus } = proof;
  await expect(
    db.query("select fulfill_product_purchase($1)", [
      { id: id(1170), proof: missingStatus },
    ]),
  ).rejects.toThrow(/Zahlungsnachweis/);
  expect(
    (
      await db.query(
        "select * from parents where contact_email='guard1170@example.invalid'",
      )
    ).rows,
  ).toHaveLength(0);
});
