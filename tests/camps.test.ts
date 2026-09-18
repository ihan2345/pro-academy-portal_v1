import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import {
  ageAt,
  bestBenefit,
  currentOffer,
  maximumSeats,
} from "../src/lib/camps/domain";
let db: PGlite;
const camp = "a0000000-0000-4000-8000-000000000001",
  plan = "a0000000-0000-4000-8000-000000000002",
  offer = "a0000000-0000-4000-8000-000000000003";
let originalConstraint: string;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  originalConstraint = (
    await db.query<{ d: string }>(
      "select pg_get_constraintdef(oid) d from pg_constraint where conname='plan_allowances'",
    )
  ).rows[0].d;
  await db.exec(readFileSync("supabase/camp/001-up.sql", "utf8"));
  await db.exec(
    readFileSync("supabase/camp/002-offer-transaction.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/camp/003-release-preparation.sql", "utf8"),
  );
  await db.exec(readFileSync("supabase/camp/004-import-review.sql", "utf8"));
  await db.exec(
    readFileSync("supabase/camp/005-server-processing.sql", "utf8"),
  );
  await db.exec(readFileSync("supabase/camp/006-occupancy.sql", "utf8"));
  await db.exec(readFileSync("supabase/camp/007-remove-member.sql", "utf8"));
  await db.query(
    `insert into camps(id,title,location,capacity,buffer_percent,min_age,max_age,days,status) values($1,'Testcamp','Platz',10,10,6,16,'[{"starts_at":"2027-10-10T09:00:00+02:00","ends_at":"2027-10-10T15:00:00+02:00"}]','open')`,
    [camp],
  );
  await db.query(
    `insert into plans(id,name,included_units,generation,is_camp,camp_id,active)values($1,'Camp',0,'special',true,$2,false)`,
    [plan, camp],
  );
  await db.query(
    `insert into camp_offers(id,camp_id,plan_id,kind,stripe_price_id,stripe_product_id,stripe_payment_link_id,payment_url,amount)values($1,$2,$3,'main','price_test','prod_test','plink_test','https://buy.stripe.com/test',10000)`,
    [offer, camp, plan],
  );
});
afterAll(async () => db?.close());
async function draft(id: string, parent?: string) {
  await db.query(
    `insert into camp_bookings(id,camp_id,offer_id,parent_id,browser_token_hash,parent_data,child_data,customer_group,expected_amount,currency,stripe_price_id,stripe_payment_link_id)values($1,$2,$3,$4,'hash',$5,$6,'new',10000,'eur','price_test','plink_test')`,
    [
      id,
      camp,
      offer,
      parent ?? null,
      JSON.stringify({
        name: "Test Parent",
        email: "camp@example.invalid",
        phone: "12345678",
      }),
      JSON.stringify({
        first_name: id.endsWith("4") ? "Kid" : "Sibling",
        last_name: "Test",
        birth_date: "2015-01-01",
        gender: "keine Angabe",
        clothing_size: "140",
      }),
    ],
  );
}
function payment(id: string, extra = {}) {
  return {
    booking_id: id,
    session_id: "cs_test_" + id,
    payment_id: "pi_" + id,
    customer_id: "cus_" + id,
    livemode: false,
    payment_status: "paid",
    price_id: "price_test",
    payment_link_id: "plink_test",
    currency: "eur",
    quantity: 1,
    subtotal: 10000,
    total: 10000,
    ...extra,
  };
}
async function confirm(input: unknown) {
  return db.query("select camp_confirm_payment($1::jsonb)", [
    JSON.stringify(input),
  ]);
}
describe("isolated Camp extension", () => {
  it("never counts an unpaid checkout draft as an occupied place or creates its child", async () => {
    await db.exec("begin");
    try {
      const before = (
        await db.query<{ seats: number; children: number; parents: number }>(
          "select camp_occupied_seats($1) seats,(select count(*)::int from players) children,(select count(*)::int from parents) parents",
          [camp],
        )
      ).rows[0];
      await draft("f1000000-0000-4000-8000-000000000001");
      const after = (
        await db.query<{ seats: number; children: number; parents: number }>(
          "select camp_occupied_seats($1) seats,(select count(*)::int from players) children,(select count(*)::int from parents) parents",
          [camp],
        )
      ).rows[0];
      expect(after).toEqual(before);
    } finally {
      await db.exec("rollback");
    }
  });

  it("removes a Camp member only as admin, frees snapshot occupancy and preserves payment/family history", async () => {
    await db.exec("begin");
    try {
      const admin = "f0000000-0000-4000-8000-000000000001",
        staff = "f0000000-0000-4000-8000-000000000002",
        id = "f0000000-0000-4000-8000-000000000003";
      await db.query<Record<string, any>>(
        "insert into auth.users(id,email)values($1,'removal-admin@example.invalid'),($2,'removal-staff@example.invalid')",
        [admin, staff],
      );
      await db.query<Record<string, any>>(
        "insert into profiles(id,role)values($1,'admin'),($2,'staff') on conflict(id) do update set role=excluded.role",
        [admin, staff],
      );
      await draft(id);
      await confirm(payment(id));
      const before = (
        await db.query<Record<string, any>>(
          "select * from camp_bookings where id=$1",
          [id],
        )
      ).rows[0];
      await db.query<Record<string, any>>(
        "insert into camp_review_snapshots(camp_id,payment_link_id,records)values($1,'plink_removal',$2::jsonb)",
        [
          camp,
          JSON.stringify([
            { payment_id: before.stripe_payment_id, status: "paid" },
          ]),
        ],
      );
      const seats = Number(
        (
          await db.query<Record<string, any>>(
            "select camp_occupied_seats($1) n",
            [camp],
          )
        ).rows[0].n,
      );
      // A denied request must not abort the surrounding test transaction.
      await db.exec("savepoint rejected");
      await expect(
        db.query<Record<string, any>>("select camp_remove_member($1,$2)", [
          id,
          staff,
        ]),
      ).rejects.toThrow("Admin required");
      await db.exec("rollback to savepoint rejected");
      await db.query<Record<string, any>>("select camp_remove_member($1,$2)", [
        id,
        admin,
      ]);
      await db.query<Record<string, any>>("select camp_remove_member($1,$2)", [
        id,
        admin,
      ]);
      expect(
        Number(
          (
            await db.query<Record<string, any>>(
              "select camp_occupied_seats($1) n",
              [camp],
            )
          ).rows[0].n,
        ),
      ).toBe(seats - 1);
      const removed = (
        await db.query<Record<string, any>>(
          "select * from camp_bookings where id=$1",
          [id],
        )
      ).rows[0];
      expect(removed).toMatchObject({
        status: "cancelled",
        parent_id: before.parent_id,
        player_id: before.player_id,
        stripe_payment_id: before.stripe_payment_id,
      });
      expect(
        (
          await db.query<Record<string, any>>(
            "select id from players where id=$1",
            [before.player_id],
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.query<Record<string, any>>(
            "select id from parent_players where parent_id=$1 and player_id=$2",
            [before.parent_id, before.player_id],
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.query<Record<string, any>>(
            "select id from audit_log where record_id=$1 and action='CAMP_MEMBER_REMOVED'",
            [id],
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          (await confirm(payment(id))).rows[0] as {
            camp_confirm_payment: { status: string };
          }
        ).camp_confirm_payment,
      ).toMatchObject({ status: "cancelled" });
      await db.query<Record<string, any>>(
        "update camp_review_snapshots set checked_at=now() where payment_link_id='plink_removal'",
      );
      expect(
        Number(
          (
            await db.query<Record<string, any>>(
              "select camp_occupied_seats($1) n",
              [camp],
            )
          ).rows[0].n,
        ),
      ).toBe(seats - 1);
      expect(
        (
          await db.query<Record<string, any>>(
            "select has_function_privilege('authenticated','camp_remove_member(uuid,uuid)','EXECUTE') allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
    } finally {
      await db.exec("rollback");
    }
  });

  it("keeps tariff rules and validates Camp shape", async () => {
    await expect(
      db.exec("insert into plans(name,included_units)values('Unknown',99)"),
    ).rejects.toThrow();
    await expect(
      db.exec(
        "insert into plans(name,included_units,is_camp)values('Camp',0,true)",
      ),
    ).rejects.toThrow();
    expect(
      (await db.query("select * from plans where is_camp is not true")).rows,
    ).toHaveLength(8);
  });
  it("does not grant public access to contacts or codes", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.exec("select * from camp_bookings")).rejects.toThrow();
      await expect(db.exec("select * from camp_offers")).rejects.toThrow();
      await expect(
        db.exec("select * from camp_review_drafts"),
      ).rejects.toThrow();
      await expect(
        db.query("select camp_import_paid_booking('{}')"),
      ).rejects.toThrow();
      await expect(confirm({})).rejects.toThrow();
      await db.exec("reset role");
    }
  });
  it("rejects forged amount, live and unpaid before creating a family", async () => {
    const id = "a0000000-0000-4000-8000-000000000004";
    await draft(id);
    await expect(confirm(payment(id, { livemode: true }))).rejects.toThrow();
    await expect(confirm(payment(id, { subtotal: 1 }))).rejects.toThrow();
    await expect(
      confirm(payment(id, { payment_status: "unpaid" })),
    ).rejects.toThrow();
    expect((await db.query("select * from parents")).rows).toHaveLength(0);
  });
  it("creates one family once, records payment, sends and queues nothing", async () => {
    const id = "a0000000-0000-4000-8000-000000000004";
    await confirm(payment(id));
    await confirm(payment(id));
    expect((await db.query("select * from parents")).rows).toHaveLength(1);
    expect((await db.query("select * from players")).rows).toHaveLength(1);
    for (const t of [
      "notification_jobs",
      "parent_invitations",
      "subscriptions",
      "entitlement_periods",
    ])
      expect((await db.query(`select * from ${t}`)).rows).toHaveLength(0);
    expect(
      (await db.query<{ s: string }>("select status s from camp_bookings"))
        .rows[0].s,
    ).toBe("paid");
  });
  it("allows another child in the proven same guest family", async () => {
    const parent = (await db.query<{ id: string }>("select id from parents"))
      .rows[0].id;
    const id = "a0000000-0000-4000-8000-000000000005";
    await draft(id, parent);
    await confirm(payment(id));
    expect((await db.query("select * from parents")).rows).toHaveLength(1);
    expect((await db.query("select * from players")).rows).toHaveLength(2);
  });
  it("keeps over-capacity paid bookings for review without creating participants", async () => {
    await db.exec("update camps set capacity=1,buffer_percent=0");
    const id = "a0000000-0000-4000-8000-000000000006";
    await draft(id);
    await confirm(payment(id));
    expect(
      (
        await db.query<{ s: string }>(
          "select status s from camp_bookings where id=$1",
          [id],
        )
      ).rows[0].s,
    ).toBe("review");
    expect((await db.query("select * from players")).rows).toHaveLength(2);
  });
  it("keeps Live confirmation and reset locked until explicit release", async () => {
    await db.query("update camps set payment_mode='live' where id=$1", [camp]);
    await expect(
      db.query("select camp_confirm_payment($1)", [
        payment("a0000000-0000-4000-8000-000000000004", {
          livemode: true,
          session_id: "cs_live_check",
        }),
      ]),
    ).rejects.toThrow("Live payments not released");
    await expect(db.query("select camp_reset_v0()")).rejects.toThrow(
      "Live Camp data exists",
    );
    await db.query("update camps set payment_mode='test' where id=$1", [camp]);
  });
  it("does not create a family or occupy a seat for a payment refunded before the first return", async () => {
    const id = "b0000000-0000-4000-8000-000000000009";
    await draft(id);
    const before = (await db.query("select count(*) n from parents")).rows[0];
    await db.query("select camp_confirm_payment($1)", [
      payment(id, { refunded: true }),
    ]);
    expect(
      (
        await db.query(
          "select status,parent_id from camp_bookings where id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({ status: "refunded", parent_id: null });
    expect((await db.query("select count(*) n from parents")).rows[0]).toEqual(
      before,
    );
  });
  it("rejects missing payment details rather than treating SQL NULL as valid", async () => {
    const id = "b0000000-0000-4000-8000-000000000010";
    await draft(id);
    for (const field of [
      "price_id",
      "payment_link_id",
      "quantity",
      "currency",
      "subtotal",
      "total",
    ]) {
      await expect(
        db.query("select camp_confirm_payment($1)", [
          payment(id, { [field]: null }),
        ]),
      ).rejects.toThrow("Invalid verified payment");
    }
  });
  it("imports verified existing payments once, requires admin and birth date, preserves families and blocks reset", async () => {
    await db.exec("begin");
    try {
      const actor = "c0000000-0000-4000-8000-000000000001",
        parent = "c0000000-0000-4000-8000-000000000002",
        player = "c0000000-0000-4000-8000-000000000003";
      await db.query(
        "insert into auth.users(id,email)values($1,'admin@example.invalid')",
        [actor],
      );
      await db.query(
        "insert into profiles(id,role)values($1,'admin') on conflict(id) do update set role='admin'",
        [actor],
      );
      await db.query(
        "insert into parents(id,full_name,contact_email)values($1,'Existing Parent','existing@example.invalid')",
        [parent],
      );
      await db.query(
        "insert into players(id,first_name,last_name,birth_year)values($1,'Existing','Child',null)",
        [player],
      );
      await db.query(
        "insert into parent_players(parent_id,player_id)values($1,$2)",
        [parent, player],
      );
      await db.query(
        "insert into camp_stripe_sources values('plink_live',$1,'price_live','prod_live')",
        [camp],
      );
      await db.query("update camps set capacity=30 where id=$1", [camp]);
      const input = {
        camp_id: camp,
        actor_id: actor,
        parent_id: parent,
        player_id: player,
        payment_link_id: "plink_live",
        price_id: "price_live",
        product_id: "prod_live",
        livemode: true,
        payment_status: "paid",
        refunded: false,
        disputed: false,
        quantity: 1,
        currency: "eur",
        amount: 18549,
        subtotal: 20610,
        session_id: "cs_live_import",
        payment_id: "pi_import",
        paid_at: "2026-09-18T08:00:00Z",
        customer_group: "subscriber",
        benefit_percent: 10,
        parent: {
          name: "Existing Parent",
          email: "existing@example.invalid",
          phone: "",
        },
        child: {
          first_name: "Existing",
          last_name: "Child",
          birth_date: "2015-04-17",
          gender: "keine Angabe",
          clothing_size: "152",
        },
      };
      async function invalid(change: object, message: string) {
        await db.exec("savepoint bad_import");
        await expect(
          db.query("select camp_import_paid_booking($1)", [
            { ...input, ...change },
          ]),
        ).rejects.toThrow(message);
        await db.exec("rollback to savepoint bad_import");
      }
      await invalid({ actor_id: player }, "Admin required");
      await invalid(
        { child: { ...input.child, birth_date: "" } },
        "Birth date required",
      );
      await invalid({ parent_id: actor }, "Family link missing");
      await invalid({ refunded: true }, "Invalid verified payment");
      await invalid({ payment_link_id: "plink_other" }, "Unknown source");
      const a = await db.query("select camp_import_paid_booking($1) id", [
        input,
      ]);
      const b = await db.query("select camp_import_paid_booking($1) id", [
        input,
      ]);
      expect(a.rows).toEqual(b.rows);
      expect(
        (
          await db.query(
            "select * from camp_bookings where booking_origin='stripe_import'",
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.query(
            "select camp_birth_date::text birthday,first_name,birth_year from players where id=$1",
            [player],
          )
        ).rows[0],
      ).toEqual({
        birthday: "2015-04-17",
        first_name: "Existing",
        birth_year: null,
      });
      expect(
        (
          await db.query(
            "select * from parent_players where parent_id=$1 and player_id=$2",
            [parent, player],
          )
        ).rows,
      ).toHaveLength(1);
      for (const table of ["notification_jobs", "parent_invitations"])
        expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0);
      await db.exec("savepoint reset_guard");
      await expect(db.query("select camp_reset_v0()")).rejects.toThrow(
        "Live Camp data exists",
      );
      await db.exec("rollback to savepoint reset_guard");
    } finally {
      await db.exec("rollback");
    }
  });
  it("persists complete source snapshots, fences concurrent processors and protects review data", async () => {
    await db.exec("begin");
    try {
      await db.query("update camps set payment_mode='live' where id=$1", [
        camp,
      ]);
      const owner = "d0000000-0000-4000-8000-000000000001";
      const other = "d0000000-0000-4000-8000-000000000002";
      expect(
        (
          await db.query<{ ok: boolean }>(
            "select camp_claim_processing($1) ok",
            [owner],
          )
        ).rows[0].ok,
      ).toBe(true);
      expect(
        (
          await db.query<{ ok: boolean }>(
            "select camp_claim_processing($1) ok",
            [other],
          )
        ).rows[0].ok,
      ).toBe(false);
      const source = { camp_id: camp, payment_link_id: "plink_test" };
      await db.query(
        "insert into camp_payment_events(event_id,camp_id,payment_link_id,session_id,received_at)values('evt_once',$1,'plink_test','cs_live_once','2026-09-01')",
        [camp],
      );
      await db.query(
        "insert into camp_payment_events(event_id,camp_id,payment_link_id,session_id)values('evt_once',$1,'plink_test','cs_live_once') on conflict(event_id) do nothing",
        [camp],
      );
      const rows = [{ payment_id: "pi_once", status: "paid" }];
      await db.query("select camp_store_review($1,$2,$3,'2026-09-02',null)", [
        owner,
        source,
        JSON.stringify(rows),
      ]);
      expect(
        (
          await db.query(
            "select processed_at is not null done from camp_payment_events",
          )
        ).rows,
      ).toEqual([{ done: true }]);
      await db.query(
        "select camp_store_review($1,$2,'[]','2026-09-03','offline')",
        [owner, source],
      );
      expect(
        (await db.query("select records,error from camp_review_snapshots"))
          .rows,
      ).toEqual([{ records: rows, error: "offline" }]);
      await db.exec("savepoint stale");
      await expect(
        db.query("select camp_store_review($1,$2,'[]','2026-09-01',null)", [
          owner,
          source,
        ]),
      ).rejects.toThrow();
      await db.exec("rollback to savepoint stale");
      await db.exec("savepoint fence");
      await expect(
        db.query("select camp_store_review($1,$2,'[]','2026-09-04',null)", [
          other,
          source,
        ]),
      ).rejects.toThrow("lease expired");
      await db.exec("rollback to savepoint fence");
      for (const role of ["anon", "authenticated"]) {
        for (const target of [
          "camp_review_snapshots",
          "camp_payment_events",
          "camp_processing_lease",
        ]) {
          await db.exec(`savepoint access_test; set local role ${role}`);
          await expect(db.query(`select * from ${target}`)).rejects.toThrow(
            "permission denied",
          );
          await db.exec("rollback to savepoint access_test");
        }
        await db.exec(`savepoint rpc_test; set local role ${role}`);
        await expect(
          db.query("select camp_claim_processing($1)", [other]),
        ).rejects.toThrow("permission denied");
        await db.exec("rollback to savepoint rpc_test");
      }
    } finally {
      await db.exec("rollback");
    }
  });
  it("counts pending child details once, excludes refunds and closes full Camps", async () => {
    await db.exec("begin");
    try {
      const baseline = Number(
        (
          await db.query<{ n: number }>("select camp_occupied_seats($1) n", [
            camp,
          ])
        ).rows[0].n,
      );
      const paid = (
        await db.query<{ stripe_payment_id: string }>(
          "select stripe_payment_id from camp_bookings where status='paid' limit 1",
        )
      ).rows[0].stripe_payment_id;
      await db.query(
        "update camps set status='open',capacity=$2,buffer_percent=0 where id=$1",
        [camp, baseline + 1],
      );
      await db.query(
        "insert into camp_review_snapshots(payment_link_id,camp_id,records) values('plink_counts',$1,$2)",
        [
          camp,
          JSON.stringify([
            { payment_id: paid, status: "paid" },
            { payment_id: "pi_missing_child", status: "review" },
            { payment_id: "pi_refund", status: "refunded" },
          ]),
        ],
      );
      expect(
        (
          await db.query<{ n: number }>("select camp_occupied_seats($1) n", [
            camp,
          ])
        ).rows[0].n,
      ).toBe(baseline + 1);
      expect(
        (
          await db.query<{ n: number }>(
            "select camp_occupied_seats($1,'pi_missing_child') n",
            [camp],
          )
        ).rows[0].n,
      ).toBe(baseline);
      expect(
        (
          await db.query<{ status: string }>(
            "select status from camps where id=$1",
            [camp],
          )
        ).rows[0].status,
      ).toBe("closed");
      await db.query(
        "update camp_review_snapshots set records=$1 where payment_link_id='plink_counts'",
        [JSON.stringify([{ payment_id: paid, status: "refunded" }])],
      );
      expect(
        (
          await db.query<{ n: number }>("select camp_occupied_seats($1) n", [
            camp,
          ])
        ).rows[0].n,
      ).toBe(baseline - 1);
    } finally {
      await db.exec("rollback");
    }
  });
  it("creates a verified imported family atomically, holds notifications and rejects duplicate contacts", async () => {
    await db.exec("begin");
    try {
      const actor = "d0000000-0000-4000-8000-000000000003";
      await db.query(
        "insert into auth.users(id,email) values($1,'review-admin@example.invalid')",
        [actor],
      );
      await db.query(
        "insert into profiles(id,role)values($1,'admin') on conflict(id) do update set role='admin'",
        [actor],
      );
      await db.query(
        "insert into camp_stripe_sources values('plink_new',$1,'price_new','prod_new')",
        [camp],
      );
      await db.query("update camps set capacity=30 where id=$1", [camp]);
      const input = {
        camp_id: camp,
        actor_id: actor,
        parent_id: null,
        player_id: null,
        new_parent: {
          name: "New Parent",
          email: "new-import@example.invalid",
          phone: "123",
        },
        child: {
          first_name: "New",
          last_name: "Child",
          birth_date: "2015-04-17",
          gender: "keine Angabe",
          clothing_size: "152",
        },
        payment_link_id: "plink_new",
        price_id: "price_new",
        product_id: "prod_new",
        livemode: true,
        payment_status: "paid",
        refunded: false,
        disputed: false,
        quantity: 1,
        currency: "eur",
        amount: 18549,
        subtotal: 20610,
        session_id: "cs_live_new",
        payment_id: "pi_new",
        customer_id: "cus_newimport",
        paid_at: "2026-09-18T08:00:00Z",
      };
      await db.exec("savepoint rejected");
      await expect(
        db.query("select camp_import_review_booking($1)", [
          { ...input, refunded: true },
        ]),
      ).rejects.toThrow("Invalid verified payment");
      await db.exec("rollback to savepoint rejected");
      expect(
        (
          await db.query(
            "select id from parents where contact_email='new-import@example.invalid'",
          )
        ).rows,
      ).toHaveLength(0);
      const first = await db.query("select camp_import_review_booking($1) id", [
        input,
      ]);
      expect(
        (await db.query("select camp_import_review_booking($1) id", [input]))
          .rows,
      ).toEqual(first.rows);
      expect(
        (
          await db.query(
            "select notifications_held,auth_user_id from parents where contact_email='new-import@example.invalid'",
          )
        ).rows,
      ).toEqual([{ notifications_held: true, auth_user_id: null }]);
      expect(
        (
          await db.query(
            "select id from parent_stripe_customers where stripe_customer_id='cus_newimport'",
          )
        ).rows,
      ).toHaveLength(1);
      await db.exec("savepoint duplicate");
      await expect(
        db.query("select camp_import_review_booking($1)", [
          { ...input, payment_id: "pi_another", session_id: "cs_live_other" },
        ]),
      ).rejects.toThrow("Existing contact");
      await db.exec("rollback to savepoint duplicate");
      for (const table of ["notification_jobs", "parent_invitations"])
        expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0);
    } finally {
      await db.exec("rollback");
    }
  });
  it("reset removes extension and owned families, restores the original constraint", async () => {
    const untouchedParent = "b0000000-0000-4000-8000-000000000001";
    const untouchedChild = "b0000000-0000-4000-8000-000000000002";
    await db.query(
      "insert into parents(id,full_name,contact_email)values($1,'Unrelated family','unrelated@example.invalid')",
      [untouchedParent],
    );
    await db.query(
      "insert into players(id,first_name,last_name,birth_year)values($1,'Unrelated','Child',2014)",
      [untouchedChild],
    );
    const campChild = (
      await db.query<{ id: string }>(
        "select record_id id from camp_owned_rows where table_name='players' limit 1",
      )
    ).rows[0].id;
    const link = (
      await db.query<{ id: string }>(
        "insert into parent_players(parent_id,player_id)values($1,$2) returning id",
        [untouchedParent, campChild],
      )
    ).rows[0].id;
    await expect(db.query("select camp_reset_v0()")).rejects.toThrow();
    expect(
      (await db.query("select * from camp_installation")).rows,
    ).toHaveLength(1);
    await db.query("delete from parent_players where id=$1", [link]);
    await db.query("select camp_reset_v0()");
    expect(
      (
        await db.query(
          "select table_name from information_schema.tables where table_schema='public' and table_name like 'camp%'",
        )
      ).rows,
    ).toHaveLength(0);
    expect((await db.query("select * from parents")).rows).toHaveLength(1);
    expect((await db.query("select * from players")).rows).toHaveLength(1);
    const restored = (
      await db.query<{ d: string }>(
        "select pg_get_constraintdef(oid) d from pg_constraint where conname='plan_allowances'",
      )
    ).rows[0].d;
    expect(restored).toBe(originalConstraint);
  });
});
describe("Camp rules", () => {
  it("switches exactly at the early-bird deadline", () => {
    const offers = [{ kind: "main" }, { kind: "early" }];
    expect(
      currentOffer(
        offers,
        "2027-01-01T00:00:00Z",
        Date.parse("2027-01-01T00:00:00Z"),
      )?.kind,
    ).toBe("main");
    expect(currentOffer(offers, null)?.kind).toBe("main");
  });
  it("uses birthdate at camp start in Berlin, not birth year", () => {
    expect(ageAt("2015-10-10", "2027-10-09T23:30:00Z")).toBe(12);
    expect(ageAt("2015-10-10", "2027-10-09T10:00:00Z")).toBe(11);
  });
  it("uses the highest permitted benefit and a bounded seat buffer", () => {
    expect(bestBenefit([10, 15, 20, null])).toBe(20);
    expect(bestBenefit([99, null])).toBe(0);
    expect(maximumSeats({ capacity: 30, buffer_percent: 10 })).toBe(33);
  });
});

import { vi, afterEach } from "vitest";
import {
  campLocalEnabled,
  localHost,
  requireCampOrigin,
} from "../src/lib/camps/guard";
import { ProtonProvider } from "../src/lib/mail";
import { jobMode } from "../workers/job-mode";
afterEach(() => vi.unstubAllEnvs());
describe("local-only Camp gates", () => {
  it("requires development mode and explicit mail/job lock", () => {
    vi.stubEnv("CAMP_LOCAL_ENABLED", "true");
    vi.stubEnv("CAMP_SIDE_EFFECTS_BLOCKED", "true");
    vi.stubEnv("NODE_ENV", "production");
    expect(campLocalEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(campLocalEnabled()).toBe(true);
    vi.stubEnv("CAMP_SIDE_EFFECTS_BLOCKED", "false");
    expect(campLocalEnabled()).toBe(false);
    expect(localHost("127.0.0.1.evil.example")).toBe(false);
    expect(localHost("0.0.0.0:3108")).toBe(false);
  });
  it("rejects cross-origin mutations", () => {
    expect(() =>
      requireCampOrigin(
        new Request("http://127.0.0.1:3108/api/camp/book", {
          headers: { host: "127.0.0.1:3108", origin: "https://other.example" },
        }),
      ),
    ).toThrow();
  });
  it("blocks SMTP and both job modes even if other switches are enabled", async () => {
    vi.stubEnv("CAMP_SIDE_EFFECTS_BLOCKED", "true");
    await expect(
      new ProtonProvider().send({
        to: "nobody@example.invalid",
        subject: "test",
        text: "test",
        html: "test",
        messageId: "test",
      }),
    ).rejects.toThrow("gesperrt");
    expect(
      jobMode({
        CAMP_SIDE_EFFECTS_BLOCKED: "true",
        JOBS_ENABLED: "true",
        STRIPE_SYNC_ONLY: "true",
      }),
    ).toBe("disabled");
  });
});

import {
  campEnabled,
  campPaymentMode,
  campPublicOrigin,
  campHostAllowed,
  campLoginHref,
} from "../src/lib/camps/runtime";
describe("Camp release switches", () => {
  it("fails closed in production and never exposes the local test login", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CAMP_DEPLOYMENT_ENABLED", "false");
    expect(campEnabled()).toBe(false);
    expect(campLoginHref()).toBe("/login");
    vi.stubEnv("CAMP_DEPLOYMENT_ENABLED", "true");
    vi.stubEnv("CAMP_PUBLIC_ORIGIN", "http://portal.example");
    expect(campEnabled()).toBe(false);
    vi.stubEnv("CAMP_PUBLIC_ORIGIN", "https://portal.example");
    expect(campEnabled()).toBe(true);
    expect(campHostAllowed("portal.example.evil.test")).toBe(false);
    expect(campHostAllowed("portal.example")).toBe(true);
    expect(() =>
      requireCampOrigin(
        new Request("https://portal.example/api/camp/save", {
          headers: { host: "portal.example", origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
    expect(() =>
      requireCampOrigin(
        new Request("https://portal.example/api/camp/save", {
          headers: { host: "portal.example", origin: "https://portal.example" },
        }),
      ),
    ).not.toThrow();
  });
  it("rejects credential-bearing and path-bearing public origins", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CAMP_DEPLOYMENT_ENABLED", "true");
    for (const origin of [
      "https://user:pass@portal.example",
      "https://portal.example/camps",
      "https://portal.example?x=1",
      "https://localhost",
    ]) {
      vi.stubEnv("CAMP_PUBLIC_ORIGIN", origin);
      expect(campPublicOrigin()).toBeNull();
    }
  });
  it("keeps local checkout in test mode even with inherited live switches", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CAMP_LOCAL_ENABLED", "true");
    vi.stubEnv("CAMP_SIDE_EFFECTS_BLOCKED", "true");
    vi.stubEnv("CAMP_DEPLOYMENT_ENABLED", "true");
    vi.stubEnv("CAMP_STRIPE_MODE", "live");
    vi.stubEnv("CAMP_LIVE_PAYMENTS_ENABLED", "true");
    vi.stubEnv("CAMP_PUBLIC_ORIGIN", "https://portal.example");
    expect(campPaymentMode()).toBe("test");
    expect(campLoginHref()).toBe("/camp/lokal");
  });
});
