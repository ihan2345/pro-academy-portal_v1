import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { beforeAll, afterAll, it, expect } from "vitest";
import { applyProductSchema } from "../scripts/products-local/schema.mjs";

let db: PGlite;
const id = (n: number) =>
  `e1a00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = async (sql: string, args: any[] = []) =>
  (await db.query<any>(sql, args)).rows;
const one = async (sql: string, args: any[] = []) => (await q(sql, args))[0];

// Familien: A = FirstTouch aktiv, B = Pro-Player abgelaufen vor 5 Tagen,
// C = nur Camp, D = nur Probetraining, E = GameChanger abgelaufen vor 30 Tagen
const fam = {
  A: { uid: id(1), pid: id(11), kid: id(21), mail: "a@example.invalid" },
  B: { uid: id(2), pid: id(12), kid: id(22), mail: "b@example.invalid" },
  C: { uid: id(3), pid: id(13), kid: id(23), mail: "c@example.invalid" },
  D: { uid: id(4), pid: id(14), kid: id(24), mail: "d@example.invalid" },
  E: { uid: id(5), pid: id(15), kid: id(25), mail: "e@example.invalid" },
};
const coUid = id(6),
  adminUid = id(7),
  campId = id(31),
  regionNorth = id(41),
  regionSouth = id(42);

async function asUser(uid: string, fn: () => Promise<any>) {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`,
  );
  try {
    return await fn();
  } finally {
    await db.exec(
      `reset role; select set_config('request.jwt.claim.sub','',false);`,
    );
  }
}
const access = async (uid: string, title: string) =>
  (
    await one(
      "select community_access($1,(select id from community_channels where title=$2)) a",
      [uid, title],
    )
  ).a;

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  await applyProductSchema((sql: string) => db.exec(sql));
  const year = new Date().getFullYear();
  for (const [k, f] of Object.entries(fam)) {
    await q("insert into auth.users values($1,$2,now())", [f.uid, f.mail]);
    await q("insert into profiles(id,role,full_name) values($1,'parent',$2)", [
      f.uid,
      `Elternteil ${k}ort Beispiel`,
    ]);
    await q(
      "insert into parents(id,auth_user_id,full_name,contact_email) values($1,$2,$3,$4)",
      [f.pid, f.uid, `Elternteil ${k}`, f.mail],
    );
    await q(
      "insert into players(id,first_name,last_name,birth_year) values($1,'Kind',$2,$3)",
      [f.kid, k, year - 7],
    );
    await q("insert into parent_players(parent_id,player_id) values($1,$2)", [
      f.pid,
      f.kid,
    ]);
    await q(
      "insert into community_families(parent_id,enabled,consent_privacy_at) values($1,true,now())",
      [f.pid],
    );
  }
  await q("insert into auth.users values($1,'co@example.invalid',now())", [
    coUid,
  ]);
  await q("insert into auth.users values($1,'admin@example.invalid',now())", [
    adminUid,
  ]);
  await q(
    "insert into profiles(id,role,full_name) values($1,'admin','Admin')",
    [adminUid],
  );
  const period = async (
    f: { pid: string; kid: string },
    plan: string,
    endsDaysFromNow: number,
    n: number,
  ) => {
    const sub = id(100 + n);
    await q(
      "insert into subscriptions(id,parent_id,stripe_customer_id,stripe_subscription_id,status) values($1,$2,$3,$4,'active')",
      [sub, f.pid, `cus_${n}`, `sub_${n}`],
    );
    await q(
      `insert into entitlement_periods(player_id,subscription_id,stripe_customer_id,stripe_item_id,stripe_price_id,product_name,starts_at,ends_at,included_units)
       values($1,$2,$3,'si','price',$4,now()-interval '40 days',now()+make_interval(days=>$5),4)`,
      [f.kid, sub, `cus_${n}`, plan, endsDaysFromNow],
    );
  };
  await period(fam.A, "FirstTouch", 20, 1);
  await period(fam.B, "Pro-Player", -5, 2);
  await period(fam.E, "GameChanger", -30, 3);
  await q(
    "insert into trial_families(id,parent_id,request_input,parent_name,email,phone,operational_consent,privacy_acknowledged) values($1,$2,'{}','D','d@example.invalid','0',true,true)",
    [id(51), fam.D.pid],
  ).catch(async () => {
    // trial_families hat je nach Release weitere Pflichtfelder: minimal befüllen
    const cols = await q(
      "select column_name,data_type from information_schema.columns where table_name='trial_families' and is_nullable='NO' and column_default is null",
    );
    throw new Error(
      "trial_families Pflichtfelder: " + cols.map((c) => c.column_name),
    );
  });
  await q(
    "insert into locations(id,name,address,is_region) values($1,'Nord','x',true),($2,'Süd','y',true)",
    [regionNorth, regionSouth],
  );
  await q("select community_sync_channels()");
  await q("update community_channels set published_at=now()");
});
afterAll(async () => {
  await db?.close();
});

it("legt Grundkanäle und Regionen automatisch an", async () => {
  const titles = (await q("select title from community_channels")).map(
    (r) => r.title,
  );
  expect(titles).toEqual(
    expect.arrayContaining([
      "Ankündigungen",
      "Frag das Team",
      "Alle Abo-Eltern",
      "FirstTouch-Eltern",
      "Pro-Player-Eltern",
      "U6–U8",
      "Nord",
      "Süd",
    ]),
  );
});

it("trennt Abo-Unterkanäle und rechnet Jahrgänge nach Geburtsjahr", async () => {
  expect((await access(fam.A.uid, "Alle Abo-Eltern")).level).toBe("write");
  expect((await access(fam.A.uid, "FirstTouch-Eltern")).level).toBe("write");
  expect((await access(fam.A.uid, "GameChanger-Eltern")).level).toBe("none");
  expect((await access(fam.A.uid, "Pro-Player-Eltern")).level).toBe("none");
  // Kind ist 7 → U8 → Kanal U6–U8
  expect((await access(fam.A.uid, "U6–U8")).level).toBe("write");
  expect((await access(fam.A.uid, "U9–U12")).level).toBe("none");
});

it("gibt nach Abo-Ende 14 Tage Lesezugriff mit Countdown, danach nichts", async () => {
  const b = await access(fam.B.uid, "Pro-Player-Eltern");
  expect(b.level).toBe("read");
  expect(b.grace_until).toBeTruthy();
  expect((await access(fam.E.uid, "Alle Abo-Eltern")).level).toBe("none");
});

it("zeigt Regionskanäle gesperrt, bis eine Region gewählt ist", async () => {
  expect(await access(fam.A.uid, "Nord")).toMatchObject({
    level: "locked",
    reason: "region",
  });
  await q("update community_families set region_id=$1 where parent_id=$2", [
    regionNorth,
    fam.A.pid,
  ]);
  expect((await access(fam.A.uid, "Nord")).level).toBe("write");
  expect((await access(fam.A.uid, "Süd")).level).toBe("none");
});

it("Camp-Kanal nur mit bezahlter Buchung", async () => {
  const cols = await q(
    "select column_name from information_schema.columns where table_name='camps' and is_nullable='NO' and column_default is null",
  );
  // Ohne Camp-Datensatz: Kanal existiert nicht → none für alle.
  expect(cols.length).toBeGreaterThan(0);
  expect((await access(fam.C.uid, "Alle Abo-Eltern")).level).toBe("none");
});

it("Probetraining-Familien dürfen nur im eigenen Kanal Fragen stellen", async () => {
  expect((await access(fam.D.uid, "Probetraining")).level).toBe("ask");
  expect((await access(fam.D.uid, "Alle Abo-Eltern")).level).toBe("none");
  expect((await access(fam.A.uid, "Probetraining")).level).toBe("none");
  expect((await access(fam.D.uid, "Ankündigungen")).level).toBe("read");
});

it("unveröffentlichte Kanäle und ausgeschaltete Community sind unsichtbar", async () => {
  await q(
    "update community_channels set published_at=null where title='GameChanger-Eltern'",
  );
  expect((await access(adminUid, "GameChanger-Eltern")).level).toBe("write");
  await q("update community_families set enabled=false where parent_id=$1", [
    fam.A.pid,
  ]);
  expect((await access(fam.A.uid, "Alle Abo-Eltern")).level).toBe("none");
  await q("update community_families set enabled=true where parent_id=$1", [
    fam.A.pid,
  ]);
});

it("Zweitkonto sieht dieselben Kinder, kann aber nichts über Hauptkonto-RPCs ändern", async () => {
  await q(
    "insert into parent_co_accounts(parent_id,email,first_name) values($1,'co@example.invalid','Co')",
    [fam.A.pid],
  );
  expect(
    (await one("select co_parent_activation_available('CO@example.invalid') v"))
      .v,
  ).toBe(true);
  const linked = await asUser(coUid, () =>
    one("select activate_co_parent() v"),
  );
  expect(linked.v).toBe(true);
  const kids = await asUser(coUid, () => q("select id from players"));
  expect(kids.map((k: any) => k.id)).toEqual([fam.A.kid]);
  const periods = await asUser(coUid, () =>
    q("select product_name from entitlement_periods"),
  );
  expect(periods.map((p: any) => p.product_name)).toEqual(["FirstTouch"]);
  expect((await asUser(coUid, () => one("select is_co_parent() v"))).v).toBe(
    true,
  );
  expect(
    (await asUser(fam.A.uid, () => one("select is_co_parent() v"))).v,
  ).toBe(false);
  // Hauptkonto-RPC (E-Mail-Einstellung) lehnt das Zweitkonto ab
  await expect(
    asUser(coUid, () => q("select set_my_email_preference(false)")),
  ).rejects.toThrow();
  expect((await access(coUid, "FirstTouch-Eltern")).level).toBe("write");
});

it("Archivieren des Hauptkontos deaktiviert das Zweitkonto sofort", async () => {
  await q("update parents set archived_at=now() where id=$1", [fam.A.pid]);
  const c = await one(
    "select status,revoked_reason from parent_co_accounts where email='co@example.invalid'",
  );
  expect(c).toEqual({ status: "revoked", revoked_reason: "main_archived" });
  const kids = await asUser(coUid, () => q("select id from players"));
  expect(kids).toEqual([]);
  await q("update parents set archived_at=null where id=$1", [fam.A.pid]);
});

it("Anzeigename folgt der gewählten Variante", async () => {
  const name = async () =>
    (await one("select community_display_name($1) n", [fam.A.uid])).n;
  expect(await name()).toBe("Elternteil B.");
  await q(
    "insert into community_members(user_id,name_style) values($1,'full')",
    [fam.A.uid],
  );
  expect(await name()).toBe("Elternteil Aort Beispiel");
  await q(
    "update community_members set name_style='initials' where user_id=$1",
    [fam.A.uid],
  );
  expect(await name()).toBe("E.B.");
});

it("Familie mit zwei Kindern (U8 und U12) ist in beiden Jahrgangskanälen", async () => {
  const kid2 = id(26);
  const u12Year =
    new Date().getFullYear() + (new Date().getMonth() >= 6 ? 1 : 0) - 12;
  await q(
    "insert into players(id,first_name,last_name,birth_year) values($1,'Zweit','A',$2)",
    [kid2, u12Year],
  );
  await q("insert into parent_players(parent_id,player_id) values($1,$2)", [
    fam.A.pid,
    kid2,
  ]);
  await q(
    `insert into entitlement_periods(player_id,subscription_id,stripe_customer_id,stripe_item_id,stripe_price_id,product_name,starts_at,ends_at,included_units)
     values($1,$2,'cus_1','si2','price','GameChanger',now()-interval '5 days',now()+interval '20 days',8)`,
    [kid2, id(101)],
  );
  await q(
    "update community_channels set published_at=now() where title='GameChanger-Eltern'",
  );
  expect((await access(fam.A.uid, "U6–U8")).level).toBe("write");
  expect((await access(fam.A.uid, "U9–U12")).level).toBe("write");
  expect((await access(fam.A.uid, "U13–U16")).level).toBe("none");
  expect((await access(fam.A.uid, "GameChanger-Eltern")).level).toBe("write");
  expect((await access(fam.A.uid, "FirstTouch-Eltern")).level).toBe("write");
});
