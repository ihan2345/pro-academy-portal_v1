import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { activityStatus } from "../src/lib/user-activity";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  in: vi.fn(),
}));
vi.mock("../src/lib/server/supabase", () => ({
  sessionUser: mocks.session,
  sessionDb: vi.fn(),
  serviceDb: vi.fn(),
}));
import { POST } from "../src/app/api/[...path]/route";
import { NextRequest } from "next/server";
const parent = "00000000-0000-4000-8000-000000000001";
const staff = "00000000-0000-4000-8000-000000000002";
const admin = "00000000-0000-4000-8000-000000000003";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table profiles(id uuid primary key,role text);
    create function public.current_role() returns text language sql security definer set search_path=public as $$ select role from profiles where id=auth.uid() $$;
    create function is_admin() returns boolean language sql security definer set search_path=public as $$ select coalesce(public.current_role()='admin',false) $$;
    insert into profiles values('${parent}','parent'),('${staff}','staff'),('${admin}','admin');`);
  await db.exec(
    readFileSync("supabase/migrations/202610050001_user_activity.sql", "utf8"),
  );
});
afterAll(async () => db.close());
async function asUser(user: string, query: string, role = "authenticated") {
  await db.exec(`begin; set local role ${role}`);
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    const result = await db.query(query);
    await db.exec("commit");
    return result.rows;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
describe("activity storage permissions", () => {
  it("allows each portal role to report itself; only admins can read activity", async () => {
    for (const user of [parent, staff, admin])
      await asUser(user, "select touch_user_activity()");
    expect(await asUser(parent, "select * from user_activity")).toEqual([]);
    expect(await asUser(staff, "select * from user_activity")).toEqual([]);
    expect(await asUser(admin, "select * from user_activity")).toHaveLength(3);
    await expect(
      asUser("", "select touch_user_activity()", "anon"),
    ).rejects.toThrow("permission denied");
    await expect(asUser("", "select touch_user_activity()")).rejects.toThrow(
      "Forbidden",
    );
    await expect(
      asUser(
        "00000000-0000-4000-8000-000000000004",
        "select touch_user_activity()",
      ),
    ).rejects.toThrow("Forbidden");
  });
  it("prevents direct writes, forged timestamps and foreign user updates", async () => {
    await expect(
      asUser(
        parent,
        `update user_activity set last_seen_at=now() where user_id='${staff}'`,
      ),
    ).rejects.toThrow("permission denied");
    await expect(asUser(admin, `delete from user_activity`)).rejects.toThrow(
      "permission denied",
    );
    await expect(
      asUser(
        parent,
        `insert into user_activity(user_id,last_seen_at) values('${staff}','2099-01-01')`,
      ),
    ).rejects.toThrow("permission denied");
  });
  it("throttles repeated heartbeats and updates stale activity using server time", async () => {
    const before = (
      await db.query(
        "select last_seen_at from user_activity where user_id=$1",
        [parent],
      )
    ).rows[0];
    await asUser(parent, "select touch_user_activity()");
    expect(
      (
        await db.query(
          "select last_seen_at from user_activity where user_id=$1",
          [parent],
        )
      ).rows[0],
    ).toEqual(before);
    await db.query(
      "update user_activity set last_seen_at=now()-interval '3 hours' where user_id=$1",
      [parent],
    );
    await asUser(parent, "select touch_user_activity()");
    const result = await db.query<{ fresh: boolean }>(
      "select last_seen_at>now()-interval '5 seconds' fresh from user_activity where user_id=$1",
      [parent],
    );
    expect(result.rows[0].fresh).toBe(true);
  });
});
describe("activity labels", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  it.each([
    [0, "Online"],
    [119_999, "Online"],
    [120_000, "vor 2 Min."],
    [3_600_000, "vor 1 Std."],
    [86_400_000, "vor 1 Tag"],
    [259_200_000, "vor 3 Tagen"],
  ])("formats age %s", (age, label) => {
    const status = activityStatus(
      new Date(now - Number(age)).toISOString(),
      now,
    );
    expect(status.label).toBe(label);
    expect(status.online).toBe(Number(age) < 120_000);
    expect(status.title).toContain("Europe/Berlin");
  });
  it("distinguishes no recorded activity from unavailable data", () => {
    expect(activityStatus(null, now)).toMatchObject({
      label: "—",
      online: false,
      title: "Noch keine Aktivität erfasst.",
    });
    expect(activityStatus(undefined, now).title).toBe(
      "Aktivitätsstatus nicht verfügbar.",
    );
    expect(activityStatus("invalid", now).online).toBe(false);
  });
});
describe("activity HTTP authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://portal.example.com";
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ in: mocks.in });
    mocks.in.mockResolvedValue({
      data: [{ user_id: parent, last_seen_at: "2026-10-05T12:00:00Z" }],
      error: null,
    });
    mocks.rpc.mockResolvedValue({ error: null });
  });
  function session(role: string | null) {
    mocks.session.mockResolvedValue(
      role
        ? {
            role,
            user: { id: parent },
            db: { rpc: mocks.rpc, from: mocks.from },
          }
        : null,
    );
  }
  function request(
    path: string,
    body: unknown = {},
    origin = "https://portal.example.com",
  ) {
    return POST(
      new NextRequest("https://portal.example.com/api/" + path, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ path: path.split("/") }) },
    );
  }
  it.each(["parent", "staff", "admin"])(
    "accepts heartbeat for %s without trusting submitted identity",
    async (role) => {
      session(role);
      expect(
        (
          await request("activity", {
            user_id: staff,
            last_seen_at: "2099-01-01",
          })
        ).status,
      ).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledWith("touch_user_activity");
    },
  );
  it.each([null, "parent", "staff"])(
    "rejects reading others activity as %s",
    async (role) => {
      session(role);
      expect(
        (await request("admin/user-activity", { ids: [parent] })).status,
      ).toBe(role ? 403 : 401);
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );
  it("requires login and same origin for heartbeats", async () => {
    session(null);
    expect((await request("activity")).status).toBe(401);
    session("parent");
    expect(
      (await request("activity", {}, "https://other.example")).status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("allows admins to retrieve only requested timestamps, without caching", async () => {
    session("admin");
    const response = await request("admin/user-activity", { ids: [parent] });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.from).toHaveBeenCalledWith("user_activity");
    expect(mocks.select).toHaveBeenCalledWith("user_id,last_seen_at");
    expect(mocks.in).toHaveBeenCalledWith("user_id", [parent]);
    expect((await response.json()).now).toEqual(expect.any(String));
  });
  it("rejects invalid or oversized lookups and returns controlled failure on database errors", async () => {
    session("admin");
    expect(
      (await request("admin/user-activity", { ids: ["invalid"] })).status,
    ).toBe(400);
    expect(
      (await request("admin/user-activity", { ids: Array(101).fill(parent) }))
        .status,
    ).toBe(400);
    mocks.rpc.mockResolvedValue({
      error: { message: "secret database details" },
    });
    const response = await request("activity");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
