import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { beforeAll, afterAll, it, expect } from "vitest";
import { applyProductSchema } from "../scripts/products-local/schema.mjs";
import { invitationWaveText } from "../src/lib/invitation-wave-mail";

let db: PGlite;
const id = (n: number) =>
  `c0620000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1);
const hash = (n: number) => String(n).padStart(64, "a").slice(-64);
const url = (n: number) =>
  `https://portal.proacademy-ak.com/einladung?token=${hash(n)}`;

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
  await applyProductSchema((sql: string) => db.exec(sql));
  await db.query(
    "update system_settings set value=$1 where key='portal_delivery_release'",
    [
      {
        enabled: true,
        recipients: [],
        invitation_recipients: [],
        automatic_invitations: false,
      },
    ],
  );
  await db.query(
    "insert into auth.users values($1,'chef@test.invalid',now())",
    [admin],
  );
  await db.query(
    "insert into profiles(id,role,full_name) values($1,'admin','Chef')",
    [admin],
  );
  await db.query(
    "insert into platform_permissions(user_id,permission) values($1,'manage_features')",
    [admin],
  );
  const parent = (n: number, mail: string, linked = false, held = true) =>
    db.query(
      "insert into parents(id,full_name,contact_email,notifications_held,auth_user_id) values($1,$2,$3,$4,$5)",
      [id(n), `Familie ${n}`, mail, held, linked ? id(n + 50) : null],
    );
  const abo = (n: number, status: string) =>
    db.query(
      "insert into subscriptions(parent_id,stripe_customer_id,stripe_subscription_id,status) values($1,$2,$3,$4)",
      [id(n), `cus_${n}`, `sub_${n}`, status],
    );
  // 10 Abo, 11 aktuelles Camp, 12 vergangenes Camp, 13 gekündigtes Abo,
  // 14/15 Dublette, 16 verbunden + zurückgehalten, 17 verbunden + frei
  await parent(10, "abo@test.invalid");
  await abo(10, "active");
  await parent(11, "camp@test.invalid");
  await parent(12, "alt-camp@test.invalid");
  await parent(13, "ex@test.invalid");
  await abo(13, "canceled");
  await parent(14, "doppelt@test.invalid");
  await parent(15, "doppelt@test.invalid");
  await abo(14, "active");
  for (const n of [16, 17]) {
    await db.query("insert into auth.users values($1,$2,now())", [
      id(n + 50),
      `aktiv${n}@test.invalid`,
    ]);
    await db.query("insert into profiles(id,role) values($1,'parent')", [
      id(n + 50),
    ]);
    await parent(n, `aktiv${n}@test.invalid`, true, n === 16);
    await abo(n, "trialing");
  }
  await db.exec("set session_replication_role='replica'");
  const day = (offset: number) =>
    JSON.stringify([
      {
        starts_at: new Date(Date.now() + offset * 86400000).toISOString(),
        ends_at: new Date(
          Date.now() + offset * 86400000 + 3600000,
        ).toISOString(),
      },
    ]);
  await db.query(
    "insert into camps(id,title,location,capacity,days) values($1,'Jetzt','Platz',20,$2),($3,'Alt','Platz',20,$4)",
    [id(30), day(3), id(31), day(-30)],
  );
  for (const [n, camp] of [
    [11, 30],
    [12, 31],
  ] as const)
    await db.query(
      `insert into camp_bookings(id,camp_id,offer_id,parent_id,browser_token_hash,parent_data,child_data,customer_group,expected_amount,currency,stripe_price_id,stripe_payment_link_id,status,paid_at)
       values($1,$2,$3,$4,'h','{}','{}','new',100,'eur','p','l','paid',now())`,
      [id(n + 20), id(camp), id(99), id(n)],
    );
  await db.exec("set session_replication_role='origin'");
  await db.query(
    "insert into notification_jobs(idempotency_key,kind,recipient,payload,status) values('held-invitation:x','invitation','abo@test.invalid','{}','held')",
  );
});
afterAll(async () => db?.close());

async function asAdmin<T>(sql: string, params: unknown[] = []) {
  await db.exec(`set request.jwt.claim.sub='${admin}';set role authenticated;`);
  try {
    return (await db.query<T>(sql, params)).rows[0];
  } finally {
    await db.exec("reset role;reset request.jwt.claim.sub;");
  }
}
type Overview = {
  invite: { parent_id: string; basis: string }[];
  skipped: { parent_id: string; reason: string }[];
  release_holds: { parent_id: string }[];
  old_held_invitations: number;
};
const overview = async () =>
  (await asAdmin<{ o: Overview }>("select invitation_wave_overview() o")).o;
const allowed = async (recipient: string, kind: string, payload: unknown) =>
  (
    await db.query<{ ok: boolean }>(
      "select parent_delivery_allowed($1,$2,$3) ok",
      [recipient, kind, payload],
    )
  ).rows[0].ok;

it("wählt nur Abo- und aktuelle Campfamilien, schließt Dubletten aus", async () => {
  const o = await overview();
  expect(o.invite.map((f) => [f.parent_id, f.basis])).toEqual([
    [id(10), "abo"],
    [id(11), "camp"],
  ]);
  // 15 teilt die Adresse, hat aber selbst kein Abo.
  expect(o.skipped.map((f) => [f.parent_id, f.reason])).toEqual([
    [id(14), "dublette"],
  ]);
  expect(o.release_holds.map((f) => f.parent_id)).toEqual([id(16)]);
  expect(o.old_held_invitations).toBe(1);
});

it("lehnt eine abweichende Liste ab und für Nicht-Super-Admins alles", async () => {
  await expect(
    asAdmin("select start_invitation_wave($1)", [
      {
        invitations: [{ parent_id: id(10), token_hash: hash(1), url: url(1) }],
        release_holds: [id(16)],
        expected_invitations: 1,
        expected_releases: 1,
      },
    ]),
  ).rejects.toThrow(/WAVE_CHANGED/);
  await db.exec(
    `set request.jwt.claim.sub='${id(66)}';set role authenticated;`,
  );
  await expect(db.query("select invitation_wave_overview()")).rejects.toThrow(
    /Forbidden/,
  );
  await db.exec("reset role;reset request.jwt.claim.sub;");
});

it("startet die Welle: Einladungen versandbereit, Freigaben, alte Einladung verworfen", async () => {
  const r = await asAdmin<{ r: { invited: number; released: number } }>(
    "select start_invitation_wave($1) r",
    [
      {
        invitations: [
          { parent_id: id(11), token_hash: hash(2), url: url(2) },
          { parent_id: id(10), token_hash: hash(1), url: url(1) },
        ],
        release_holds: [id(16)],
        expected_invitations: 2,
        expected_releases: 1,
      },
    ],
  );
  expect(r.r).toEqual({ invited: 2, released: 1 });
  const jobs = (
    await db.query<{
      recipient: string;
      status: string;
      payload: Record<string, unknown>;
    }>(
      "select recipient,status,payload from notification_jobs where kind='invitation' order by recipient,status",
    )
  ).rows;
  const wave = jobs.filter((j) => j.payload.invitation_wave);
  expect(wave.map((j) => [j.recipient, j.status])).toEqual([
    ["abo@test.invalid", "pending"],
    ["camp@test.invalid", "pending"],
  ]);
  for (const j of wave)
    expect(await allowed(j.recipient, "invitation", j.payload)).toBe(true);
  const old = jobs.find((j) => !j.payload.invitation_wave)!;
  expect([old.status, old.payload.invitation_discarded]).toEqual([
    "held",
    true,
  ]);
  const held = (
    await db.query<{ id: string; notifications_held: boolean }>(
      "select id,notifications_held from parents where id in ($1,$2,$3) order by id",
      [id(10), id(16), id(17)],
    )
  ).rows.map((p) => p.notifications_held);
  expect(held).toEqual([true, false, false]);
  // Training-Sperre bleibt: keine Trainingsmail an Wellen-Empfänger.
  expect(
    await allowed("abo@test.invalid", "planning", { parent_id: id(10) }),
  ).toBe(false);
  // Zweiter Start: niemand mehr offen.
  const o = await overview();
  expect(o.invite).toEqual([]);
  expect(o.release_holds).toEqual([]);
});

it("hält Wellen-Einladungen zurück, wenn der Hauptschalter aus ist", async () => {
  const job = (
    await db.query<{ payload: unknown }>(
      "select payload from notification_jobs where recipient='abo@test.invalid' and payload->>'invitation_wave'='true'",
    )
  ).rows[0];
  await db.exec(
    `update system_settings set value=value||'{"enabled":false}' where key='portal_delivery_release'`,
  );
  expect(await allowed("abo@test.invalid", "invitation", job.payload)).toBe(
    false,
  );
  await db.exec(
    `update system_settings set value=value||'{"enabled":true}' where key='portal_delivery_release'`,
  );
});

it("schickt die Testeinladung nur an die eigene Adresse", async () => {
  await asAdmin("select send_invitation_wave_test($1)", [
    { url: "https://portal.proacademy-ak.com/login" },
  ]);
  const job = (
    await db.query<{ recipient: string; status: string; payload: unknown }>(
      "select recipient,status,payload from notification_jobs where payload->>'invitation_wave_test'='true'",
    )
  ).rows[0];
  expect([job.recipient, job.status]).toEqual(["chef@test.invalid", "pending"]);
  expect(await allowed(job.recipient, "invitation", job.payload)).toBe(true);
  expect(await allowed("fremd@test.invalid", "invitation", job.payload)).toBe(
    false,
  );
});

it("Mailtext nennt das Ablaufdatum", () => {
  const text = invitationWaveText({
    parent_name: "Eva Muster",
    expires_at: "2026-12-09T10:00:00Z",
  });
  expect(text.startsWith("Hallo Eva Muster,")).toBe(true);
  expect(text).toContain("bis 09.12.2026 gültig");
});
