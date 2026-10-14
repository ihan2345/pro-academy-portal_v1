import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
let db: PGlite;
const id = (n: number) =>
  `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create schema storage;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
  create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  const migrations = readdirSync("supabase/migrations").sort();
  for (const f of migrations.filter((f) => f < "202609230010"))
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec(
    readFileSync("supabase/release/001-onboarding-mail.sql", "utf8"),
  );
  for (const f of readdirSync("supabase/camp")
    .filter((f) => /^\d{3}-/.test(f) && f !== "001-down.sql")
    .sort())
    await db.exec(readFileSync(`supabase/camp/${f}`, "utf8"));
  for (const f of migrations.filter((f) => f >= "202609230010"))
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec("begin");
  await db.query(
    `insert into camps(id,title,location,capacity,buffer_percent,min_age,max_age,days,status,payment_mode) values($1,'Camp','Platz',30,0,6,16,'[{"starts_at":"2026-10-20T10:00:00+02:00","ends_at":"2026-10-20T15:00:00+02:00"}]','open','live')`,
    [id(1)],
  );
  await db.query(
    "insert into camp_stripe_sources values('plink_age',$1,'price_age','prod_age')",
    [id(1)],
  );
  await db.query("select camp_claim_processing($1)", [id(2)]);
  await db.query(
    "insert into auth.users(id,email) values($1,'staff@example.invalid')",
    [id(3)],
  );
  await db.query(
    "insert into profiles(id,role) values($1,'staff') on conflict(id) do update set role='staff'",
    [id(3)],
  );
});
afterEach(async () => {
  await db.exec("rollback");
});
const input = (changes: object = {}) => ({
  camp_id: id(1),
  actor_id: null,
  automatic: true,
  processing_token: id(2),
  parent_id: null,
  player_id: null,
  new_parent: null,
  payment_link_id: "plink_age",
  price_id: "price_age",
  product_id: "prod_age",
  session_id: "cs_live_age",
  payment_id: "pi_age",
  customer_id: "cus_age",
  livemode: true,
  payment_status: "paid",
  refunded: false,
  disputed: false,
  quantity: 1,
  currency: "eur",
  amount: 20610,
  subtotal: 20610,
  customer_group: "new",
  benefit_percent: 0,
  paid_at: "2026-10-01T10:00:00Z",
  parent: {
    name: "Havva Kaya",
    email: "havva@example.invalid",
    phone: "123456",
  },
  child: {
    first_name: "Mehmet Tahir",
    last_name: "Kaya",
    age_at_booking: 8,
    age_recorded_on: "2026-10-01",
    gender: "keine Angabe",
    clothing_size: "152",
  },
  ...changes,
});
async function run(value = input()) {
  return (
    await db.query<{ id: string }>("select camp_import_review_booking($1) id", [
      value,
    ])
  ).rows[0].id;
}
async function reject(value: ReturnType<typeof input>, message: string) {
  await db.exec("savepoint invalid");
  await expect(run(value)).rejects.toThrow(message);
  await db.exec("rollback to savepoint invalid");
}
async function family() {
  await db.query(
    "insert into parents(id,full_name,contact_email) values($1,'Havva Kaya','havva@example.invalid')",
    [id(4)],
  );
  await db.query(
    "insert into players(id,first_name,last_name,camp_birth_date,birth_year,camp_gender) values($1,'Mehmet Tahir','Kaya','2018-03-15',2018,'männlich')",
    [id(5)],
  );
  await db.query(
    "insert into parent_players(parent_id,player_id) values($1,$2)",
    [id(4), id(5)],
  );
}
it("creates a new family and child once with a dated age, without inventing a birth date or year", async () => {
  const booking = await run();
  expect(await run()).toBe(booking);
  expect(
    (
      await db.query(
        "select first_name,last_name,birth_year,camp_birth_date,camp_age_at_booking,camp_age_recorded_on::text from players",
      )
    ).rows,
  ).toEqual([
    {
      first_name: "Mehmet Tahir",
      last_name: "Kaya",
      birth_year: null,
      camp_birth_date: null,
      camp_age_at_booking: 8,
      camp_age_recorded_on: "2026-10-01",
    },
  ]);
  expect(
    (await db.query("select notifications_held,auth_user_id from parents"))
      .rows,
  ).toEqual([{ notifications_held: true, auth_user_id: null }]);
  for (const table of ["notification_jobs", "parent_invitations"])
    expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0);
  expect(
    (
      await db.query(
        "select actor_type from audit_log where action='CAMP_STRIPE_IMPORT'",
      )
    ).rows,
  ).toEqual([{ actor_type: "system" }]);
});
it("matches the right child by family and complete name, preserving known birthdate and gender", async () => {
  await family();
  await run(
    input({
      child: {
        ...input().child,
        first_name: "  MEHMET  ",
        last_name: "TAHIR KAYA",
      },
    }),
  );
  expect(
    (await db.query("select parent_id,player_id,child_data from camp_bookings"))
      .rows[0],
  ).toMatchObject({
    parent_id: id(4),
    player_id: id(5),
    child_data: {
      first_name: "Mehmet Tahir",
      last_name: "Kaya",
      birth_date: "2018-03-15",
    },
  });
  expect(
    (await db.query("select camp_birth_date::text,camp_gender from players"))
      .rows,
  ).toEqual([{ camp_birth_date: "2018-03-15", camp_gender: "männlich" }]);
});
it("matches a known Stripe customer after an email change without changing the parent contact", async () => {
  await family();
  await db.query(
    "insert into parent_stripe_customers(parent_id,stripe_customer_id) values($1,'cus_age')",
    [id(4)],
  );
  await run(
    input({ parent: { ...input().parent, email: "changed@example.invalid" } }),
  );
  expect(
    (await db.query("select parent_id from camp_bookings")).rows[0],
  ).toEqual({ parent_id: id(4) });
  expect((await db.query("select contact_email from parents")).rows[0]).toEqual(
    { contact_email: "havva@example.invalid" },
  );
});
it("creates a clearly different sibling under the existing family", async () => {
  await family();
  await run(
    input({
      child: { ...input().child, first_name: "Elif", age_at_booking: 7 },
    }),
  );
  expect((await db.query("select * from parents")).rows).toHaveLength(1);
  expect((await db.query("select * from players")).rows).toHaveLength(2);
  expect(
    (await db.query("select parent_id from camp_bookings")).rows[0],
  ).toEqual({ parent_id: id(4) });
});
it("keeps conflicting family matches, duplicate names and possible spelling variants for review", async () => {
  await family();
  await reject(
    input({ child: { ...input().child, first_name: "Mehmet" } }),
    "Kind nicht eindeutig",
  );
  await db.query(
    "insert into players(id,first_name,last_name) values($1,'Mehmet Tahir','Kaya')",
    [id(6)],
  );
  await db.query(
    "insert into parent_players(parent_id,player_id) values($1,$2)",
    [id(4), id(6)],
  );
  await reject(input(), "Kindesname mehrfach");
  await db.query(
    "insert into parents(id,full_name,contact_email,stripe_customer_id) values($1,'Other','other@example.invalid','cus_age')",
    [id(7)],
  );
  await reject(input(), "Familie nicht eindeutig");
  expect((await db.query("select * from camp_bookings")).rows).toHaveLength(0);
});
it("rejects age contradictions without overwriting known data", async () => {
  await family();
  await reject(
    input({ child: { ...input().child, age_at_booking: 9 } }),
    "bekannten Geburtsdatum",
  );
  await db.query("update players set camp_birth_date=null where id=$1", [
    id(5),
  ]);
  await reject(
    input({ child: { ...input().child, age_at_booking: 12 } }),
    "bekannten Geburtsjahr",
  );
});
it("requires explicit manual review when a birthday could cross the camp age limit", async () => {
  await db.query("update camps set max_age=8 where id=$1", [id(1)]);
  await reject(input(), "Altersgrenze zum Campbeginn unklar");
  await reject(
    input({ age_range_confirmed: true }),
    "Altersgrenze zum Campbeginn unklar",
  );
  await run(
    input({
      automatic: false,
      actor_id: id(3),
      age_range_confirmed: true,
      new_parent: input().parent,
    }),
  );
});
it("supports a manual sibling import and prevents manual duplicate children", async () => {
  await family();
  await reject(
    input({
      automatic: false,
      actor_id: id(3),
      parent_id: id(4),
      new_child: true,
    }),
    "Kind bereits vorhanden",
  );
  await run(
    input({
      automatic: false,
      actor_id: id(3),
      parent_id: id(4),
      new_child: true,
      child: { ...input().child, first_name: "Elif" },
    }),
  );
});
it("rolls back family creation on invalid payments or exhausted capacity", async () => {
  await reject(input({ refunded: true }), "Invalid verified payment");
  expect((await db.query("select * from parents")).rows).toHaveLength(0);
  await db.query("update camps set capacity=1 where id=$1", [id(1)]);
  await db.query(
    'insert into camp_review_snapshots(payment_link_id,camp_id,records) values(\'plink_other\',$1,\'[{"payment_id":"pi_other","status":"paid"}]\')',
    [id(1)],
  );
  await reject(input(), "Capacity reached");
  expect((await db.query("select * from players")).rows).toHaveLength(0);
});
it("honors saved manual drafts and archived families", async () => {
  await db.query(
    "insert into camp_review_drafts(payment_id,camp_id,data,updated_by) values('pi_age',$1,'{}',$2)",
    [id(1), id(3)],
  );
  await reject(input(), "Prüfentwurf");
  await db.exec("delete from camp_review_drafts");
  await family();
  await db.query("update parents set archived_at=now() where id=$1", [id(4)]);
  await reject(input(), "archiviert");
});
it("requires a live processing lease and denies public/authenticated execution", async () => {
  await reject(input({ processing_token: id(9) }), "Academy team required");
  await db.exec(
    "update camp_processing_lease set expires_at=now()-interval '1 second'",
  );
  await reject(input(), "Academy team required");
  for (const role of ["anon", "authenticated"]) {
    const result = await db.query<{ allowed: boolean }>(
      "select has_function_privilege($1,'public.camp_import_review_booking(jsonb)','execute') allowed",
      [role],
    );
    expect(result.rows[0].allowed).toBe(false);
  }
});

it("does not create a duplicate family for known names and an unknown payment identity", async () => {
  await family();
  await reject(
    input({
      parent: { ...input().parent, email: "typo@example.invalid" },
      customer_id: null,
    }),
    "Familie nicht eindeutig erkannt",
  );
  expect((await db.query("select * from parents")).rows).toHaveLength(1);
});
it("keeps same-aged possible siblings for manual review instead of creating a duplicate", async () => {
  await family();
  await reject(
    input({ child: { ...input().child, first_name: "Nehmet Tahir" } }),
    "Kind nicht eindeutig",
  );
  expect((await db.query("select * from players")).rows).toHaveLength(1);
});

async function freeBooking() {
  await db.query("update profiles set role='admin' where id=$1", [id(3)]);
  await db.query(
    "insert into plans(id,name,included_units,athletics_units,is_camp,camp_id,is_public) values($1,'FirstTouch',0,0,true,$2,false)",
    [id(81), id(1)],
  );
  await db.query(
    "insert into camp_offers(id,camp_id,plan_id,kind,stripe_price_id,stripe_product_id,stripe_payment_link_id,payment_url,amount,currency) values($1,$2,$3,'main','price_free','prod_free','plink_free','https://buy.stripe.com/fixture',22900,'eur')",
    [id(82), id(1), id(81)],
  );
  await db.query(
    `insert into camp_bookings(id,camp_id,offer_id,browser_token_hash,parent_data,child_data,customer_group,benefit_percent,expected_amount,currency,stripe_price_id,stripe_payment_link_id,status,stripe_session_id,stripe_payment_id,stripe_customer_id,paid_amount,review_reason) values($1,$2,$3,'hash','{"name":"New Parent","email":"new@example.invalid"}','{}','new',0,22900,'eur','price_free','plink_free','review','cs_live_free','cs_live_free','cus_free',0,'Rabatt prüfen')`,
    [id(83), id(1), id(82)],
  );
  return {
    camp_id: id(1),
    booking_id: id(83),
    actor_id: id(3),
    special_discount_approved: true,
    notes: "Sonderrabatt ausdrücklich genehmigt",
    parent_id: null,
    player_id: null,
    new_child: false,
    new_parent: { name: "New Parent", email: "new@example.invalid" },
    child: {
      first_name: "New",
      last_name: "Child",
      birth_date: "2015-01-01",
      age_at_booking: 11,
      age_recorded_on: "2026-10-01",
      gender: "keine Angabe",
      clothing_size: "140",
    },
    proof: {
      session_id: "cs_live_free",
      session_status: "complete",
      payment_status: "paid",
      livemode: true,
      payment_intent: null,
      total: 0,
      subtotal: 22900,
      discount: 22900,
      currency: "eur",
      quantity: 1,
      payment_link_id: "plink_free",
      price_id: "price_free",
      product_id: "prod_free",
      customer_id: "cus_free",
      created_at: "2026-10-01T10:00:00Z",
    },
  };
}
const approveFree = (v: object) =>
  db.query("select camp_approve_free_booking($1)", [v]);
it("approves the existing free booking atomically, records the exception and holds all mail without creating an abo", async () => {
  const v = await freeBooking();
  await approveFree(v);
  const b = (
    await db.query<any>("select * from camp_bookings where id=$1", [id(83)])
  ).rows[0];
  expect(b).toMatchObject({
    status: "paid",
    paid_amount: 0,
    manual_notifications_held: true,
    review_reason: null,
    stripe_payment_id: "cs_live_free",
  });
  expect(b.parent_id).toBeTruthy();
  expect(b.player_id).toBeTruthy();
  expect(b.payment_details.special_discount_approval).toMatchObject({
    actor_id: id(3),
    percent: 100,
    reason: v.notes,
  });
  expect((await db.query("select * from subscriptions")).rows).toHaveLength(0);
  expect(
    (await db.query("select * from entitlement_periods")).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query(
        "select * from notification_jobs where kind like 'camp_%' or kind='invitation'",
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query(
        "select * from audit_log where action='CAMP_FREE_BOOKING_APPROVED'",
      )
    ).rows,
  ).toHaveLength(1);
  await db.exec("savepoint repeated");
  await expect(approveFree(v)).rejects.toThrow("nicht zur Freigabe");
  await db.exec("rollback to savepoint repeated");
  expect((await db.query("select * from parents")).rows).toHaveLength(1);
});
it("permits explicit existing-family and new-child selection without duplicating the parent", async () => {
  const v = await freeBooking();
  await family();
  await approveFree({
    ...v,
    new_parent: null,
    parent_id: id(4),
    new_child: true,
    child: { ...v.child, first_name: "Other" },
  });
  const b = (
    await db.query<any>("select * from camp_bookings where id=$1", [id(83)])
  ).rows[0];
  expect(b.parent_id).toBe(id(4));
  expect((await db.query("select * from parents")).rows).toHaveLength(1);
});
it.each(["actor", "consent", "amount", "session", "product", "family"])(
  "rejects invalid free approval %s without partial family creation",
  async (kind) => {
    const v: any = await freeBooking();
    if (kind === "actor")
      await db.query("update profiles set role='staff' where id=$1", [id(3)]);
    if (kind === "consent") v.special_discount_approved = false;
    if (kind === "amount") v.proof.total = 1;
    if (kind === "session") v.proof.session_id = "cs_live_other";
    if (kind === "product") v.proof.product_id = "prod_other";
    if (kind === "family") {
      v.new_parent = null;
      v.parent_id = id(10);
      v.player_id = id(11);
    }
    await db.exec("savepoint bad_approval");
    await expect(approveFree(v)).rejects.toThrow();
    await db.exec("rollback to savepoint bad_approval");
    expect((await db.query("select * from parents")).rows).toHaveLength(0);
    expect(
      (
        await db.query<any>("select status from camp_bookings where id=$1", [
          id(83),
        ])
      ).rows[0].status,
    ).toBe("review");
  },
);
it("keeps special approval inaccessible to authenticated callers", async () => {
  expect(
    (
      await db.query<any>(
        "select has_function_privilege('authenticated','camp_approve_free_booking(jsonb)','execute') allowed",
      )
    ).rows[0].allowed,
  ).toBe(false);
});
it("keeps Camp notifications blocked even when every other booking-confirmation gate is enabled", async () => {
  const v = await freeBooking();
  await approveFree(v);
  await db.query(
    "update camps set days=jsonb_build_array(jsonb_build_object('starts_at',now()+interval '14 days','ends_at',now()+interval '14 days 5 hours')) where id=$1",
    [id(1)],
  );
  await db.query(
    "update system_settings set value=$1 where key='camp_mail_release'",
    [
      {
        enabled: true,
        starts_after: "2020-01-01",
        booking_confirmation_enabled: true,
        booking_confirmation_from: "2020-01-01",
      },
    ],
  );
  const query =
    "select camp_notification_allowed('new@example.invalid','camp_booking_confirmation',jsonb_build_object('booking_id',b.id,'starts_at',c.days->0->>'starts_at','ends_at',c.days->0->>'ends_at')) allowed from camp_bookings b join camps c on c.id=b.camp_id where b.id=$1";
  expect((await db.query<any>(query, [id(83)])).rows[0].allowed).toBe(false);
  await db.query(
    "update camp_bookings set manual_notifications_held=false where id=$1",
    [id(83)],
  );
  expect((await db.query<any>(query, [id(83)])).rows[0].allowed).toBe(true);
});
it("rejects full Camps without leaving a new family or child behind", async () => {
  const v = await freeBooking();
  await db.query("update camps set capacity=1 where id=$1", [id(1)]);
  await db.query(
    "insert into camp_bookings select (jsonb_populate_record(null::camp_bookings,to_jsonb(b)||jsonb_build_object('id',$2::uuid,'stripe_session_id','cs_live_other','stripe_payment_id','cs_live_other','status','paid'))).* from camp_bookings b where id=$1",
    [id(83), id(84)],
  );
  await db.exec("savepoint capacity");
  await expect(approveFree(v)).rejects.toThrow("Kapazität");
  await db.exec("rollback to savepoint capacity");
  expect((await db.query("select * from parents")).rows).toHaveLength(0);
});
