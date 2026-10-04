import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import {
  beforeAll,
  afterAll,
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn() }));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ rpc: mocks.rpc }),
}));
vi.mock("../src/lib/server/supabase", () => ({
  sessionUser: mocks.session,
  sessionDb: vi.fn(),
  serviceDb: () => ({ rpc: mocks.rpc }),
}));
import { GET, OPTIONS } from "../src/app/api/public/trainings/[token]/route";
import { POST } from "../src/app/api/[...path]/route";
import { NextRequest } from "next/server";
const token = "a".repeat(64),
  replacement = "b".repeat(64);
const admin = "00000000-0000-4000-8000-000000000001",
  staff = "00000000-0000-4000-8000-000000000002";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
 create table profiles(id uuid primary key,role text);
 create function public.is_admin() returns boolean language sql security definer set search_path=public as $$select exists(select 1 from profiles where id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid and role='admin')$$;
 create table training_events(id uuid primary key default gen_random_uuid(),title text,event_type text,starts_at timestamptz,ends_at timestamptz,status text,location_id uuid,internal_note text);
 create table locations(id uuid primary key,name text,address text);
 create table event_participants(event_id uuid,removed_from_event boolean,player_id uuid,reason text);
 insert into profiles values('${admin}','admin'),('${staff}','staff');
 insert into locations values('10000000-0000-4000-8000-000000000001','Sportplatz','Platzweg 1');
 insert into training_events(id,title,event_type,starts_at,ends_at,status,location_id,internal_note) values
 ('20000000-0000-4000-8000-000000000001','Vergangen','Gruppentraining','2020-01-01T09:00Z','2020-01-01T10:00Z','scheduled','10000000-0000-4000-8000-000000000001','PRIVATE_NOTE'),
 ('20000000-0000-4000-8000-000000000002','Geplant','Gruppentraining','2090-07-01T09:00Z','2090-07-01T10:00Z','scheduled','10000000-0000-4000-8000-000000000001','PRIVATE_NOTE'),
 ('20000000-0000-4000-8000-000000000003','Abgesagt','Gruppentraining','2090-07-02T09:00Z','2090-07-02T10:00Z','cancelled','10000000-0000-4000-8000-000000000001','PRIVATE_NOTE');
 insert into event_participants values('20000000-0000-4000-8000-000000000001',false,'30000000-0000-4000-8000-000000000001','PRIVATE_REASON'),('20000000-0000-4000-8000-000000000001',true,'30000000-0000-4000-8000-000000000002','PRIVATE_REASON');`);
  await db.exec(
    readFileSync(
      "supabase/migrations/202610040014_training_api_share.sql",
      "utf8",
    ),
  );
});
afterAll(async () => db.close());
async function asRole(
  role: string,
  user: string,
  sql: string,
  params: unknown[] = [],
) {
  await db.exec(`begin;set local role ${role}`);
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    const result = await db.query(sql, params);
    await db.exec("commit");
    return result.rows as any[];
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
async function feed(t = token) {
  return (
    await asRole("service_role", "", "select read_shared_trainings($1) data", [
      t,
    ])
  )[0].data;
}
describe("share storage and projection", () => {
  it("allows only admins to create or read the link and keeps it stable when copied again", async () => {
    await expect(
      asRole("anon", "", "select manage_training_api_share($1,false)", [token]),
    ).rejects.toThrow("permission denied");
    await expect(
      asRole(
        "authenticated",
        staff,
        "select manage_training_api_share($1,false)",
        [token],
      ),
    ).rejects.toThrow("Forbidden");
    expect(
      (
        await asRole(
          "authenticated",
          admin,
          "select manage_training_api_share($1,false) token",
          [token],
        )
      )[0].token,
    ).toBe(token);
    expect(
      (
        await asRole(
          "authenticated",
          admin,
          "select manage_training_api_share($1,false) token",
          [replacement],
        )
      )[0].token,
    ).toBe(token);
    expect(
      await asRole(
        "authenticated",
        staff,
        "select token from training_api_share",
      ),
    ).toEqual([]);
    await expect(
      asRole("authenticated", staff, "select read_shared_trainings($1)", [
        token,
      ]),
    ).rejects.toThrow("permission denied");
  });
  it("includes every status, Berlin times and assigned counts without private records", async () => {
    const data = await feed();
    expect(data.trainings.map((e: any) => e.status)).toEqual([
      "completed",
      "planned",
      "cancelled",
    ]);
    expect(data.trainings[0]).toMatchObject({
      player_count: 1,
      start_time: "10:00",
      location: { name: "Sportplatz", address: "Platzweg 1" },
    });
    expect(data.trainings[1].start_time).toBe("11:00");
    expect(JSON.stringify(data)).not.toMatch(
      /PRIVATE|player_id|reason|internal_note|30000000/,
    );
  });
  it("returns changed data with the same token, including more than 1000 events", async () => {
    await db.exec(
      "update training_events set title='Aktualisiert' where title='Vergangen'; insert into training_events(title,event_type,starts_at,ends_at,status,location_id) select 'Extra','Gruppentraining','2091-01-01'::timestamptz,'2091-01-01 01:00Z'::timestamptz,'scheduled','10000000-0000-4000-8000-000000000001'::uuid from generate_series(1,1001)",
    );
    const data = await feed();
    expect(data.trainings).toHaveLength(1004);
    expect(data.trainings[0].title).toBe("Aktualisiert");
  });
  it("invalidates the old link when rotated and rejects unknown tokens", async () => {
    await asRole(
      "authenticated",
      admin,
      "select manage_training_api_share($1,true)",
      [replacement],
    );
    expect(await feed()).toBeNull();
    expect((await feed(replacement)).trainings).toHaveLength(1004);
    expect(await feed("c".repeat(64))).toBeNull();
  });
});
describe("HTTP access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://portal.example.com";
    mocks.session.mockResolvedValue({
      role: "admin",
      user: { id: admin },
      db: { rpc: mocks.rpc },
    });
  });
  const request = (
    body = { rotate: false },
    origin = "https://portal.example.com",
  ) =>
    new NextRequest("https://portal.example.com/api/admin/training-api-link", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const context = {
    params: Promise.resolve({ path: ["admin", "training-api-link"] }),
  };
  it.each([null, "parent", "staff"])(
    "rejects link management for %s",
    async (role) => {
      mocks.session.mockResolvedValue(
        role ? { role, user: { id: staff }, db: { rpc: mocks.rpc } } : null,
      );
      const r = await POST(request(), context);
      expect(r.status).toBe(role ? 403 : 401);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("enforces origin and creates an admin URL through the protected RPC", async () => {
    expect(
      (await POST(request({ rotate: true }, "https://other.invalid"), context))
        .status,
    ).toBe(403);
    mocks.rpc.mockResolvedValue({ data: token, error: null });
    const r = await POST(request(), context);
    expect(r.status).toBe(200);
    expect((await r.json()).url).toBe(
      `https://portal.example.com/api/public/trainings/${token}`,
    );
    expect(mocks.rpc).toHaveBeenCalledWith("manage_training_api_share", {
      candidate: expect.stringMatching(/^[0-9a-f]{64}$/),
      rotate: false,
    });
  });
  it("serves JSON without login, with CORS and no caching", async () => {
    mocks.rpc.mockResolvedValue({ data: { trainings: [] }, error: null });
    const r = await GET(new Request("https://portal.example.com"), {
      params: Promise.resolve({ token }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(OPTIONS().status).toBe(204);
  });
  it("returns 404 for malformed/revoked links and does not query for malformed tokens", async () => {
    expect(
      (
        await GET(new Request("https://portal.example.com"), {
          params: Promise.resolve({ token: "invalid" }),
        })
      ).status,
    ).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(
      (
        await GET(new Request("https://portal.example.com"), {
          params: Promise.resolve({ token }),
        })
      ).status,
    ).toBe(404);
  });
  it("does not expose database errors or tokens", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: token } });
    const r = await GET(new Request("https://portal.example.com"), {
      params: Promise.resolve({ token }),
    });
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain(token);
  });
});
