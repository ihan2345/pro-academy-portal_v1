import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  rows: {} as Record<string, any[]>,
  unavailable: "",
  reads: [] as string[],
}));
vi.mock("../src/lib/camps/runtime", () => ({
  campEnabled: () => true,
  campPaymentMode: () => "live",
}));
vi.mock("../src/lib/server/profile-subscription-history", () => ({
  profileActivePeriods: async (_: unknown, periods: unknown) => periods,
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ from: builder }),
}));
import { profileList } from "../src/lib/server/parent-profile";
import { readProfileAccess } from "../src/lib/server/profile-access";
function builder(table: string) {
  f.reads.push(table);
  const filters: ((r: any) => boolean)[] = [];
  let range: number[] | undefined;
  let limit = Infinity;
  const orders: { key: string; asc: boolean }[] = [];
  const value = (r: any, key: string) =>
    key
      .replace("->>", ".")
      .split(".")
      .reduce((v, part) => v?.[part], r);
  const q: any = {
    select: () => q,
    is: (k: string, v: any) => {
      filters.push((r) => value(r, k) === v);
      return q;
    },
    eq: (k: string, v: any) => {
      filters.push((r) => value(r, k) === v);
      return q;
    },
    in: (k: string, v: any[]) => {
      filters.push((r) => v.includes(value(r, k)));
      return q;
    },
    gt: (k: string, v: any) => {
      filters.push((r) => value(r, k) > v);
      return q;
    },
    order: (key: string, o?: any) => {
      orders.push({ key, asc: o?.ascending !== false });
      return q;
    },
    limit: (n: number) => {
      limit = n;
      return q;
    },
    range: (a: number, b: number) => {
      range = [a, b];
      return q;
    },
    then: (resolve: any) => {
      let rows = (f.rows[table] ?? []).filter((r) =>
        filters.every((fn) => fn(r)),
      );
      rows.sort((a, b) => {
        for (const o of orders) {
          const c = String(value(a, o.key)).localeCompare(
            String(value(b, o.key)),
          );
          if (c) return o.asc ? c : -c;
        }
        return 0;
      });
      const count = rows.length;
      rows = range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, limit);
      return Promise.resolve({
        data: rows,
        count,
        error: table === f.unavailable ? { message: "unavailable" } : null,
      }).then(resolve);
    },
  };
  return q;
}
beforeEach(() => {
  f.unavailable = "";
  f.reads = [];
  f.rows = {
    parents: Array.from({ length: 32 }, (_, i) => ({
      id: `p${String(i).padStart(2, "0")}`,
      full_name: `Name ${String(i).padStart(2, "0")}`,
      contact_email: `p${i}@example.invalid`,
      auth_user_id: null,
      archived_at: null,
      created_at: "2026-11-13",
    })),
  };
  f.rows.camp_bookings = f.rows.parents.map((p) => ({
    id: p.id,
    parent_id: p.id,
    status: "paid",
    camps: { payment_mode: "live" },
  }));
});
it("includes every camp family without an activated account, across pages, with an exact count", async () => {
  const a = await profileList(
    { role: "admin" } as any,
    "",
    0,
    true,
    "name",
    true,
  );
  const b = await profileList(
    { role: "admin" } as any,
    "",
    25,
    true,
    "name",
    true,
  );
  expect(a.rows).toHaveLength(25);
  expect(a.total).toBe(32);
  expect(a.more).toBe(true);
  expect(b.rows).toHaveLength(7);
  expect(b.more).toBe(false);
  expect(new Set([...a.rows, ...b.rows].map((r) => r.id)).size).toBe(32);
  expect(a.rows.every((r) => r.portal_access?.activated === false)).toBe(true);
});
it("camp filtering excludes other families, unpaid attempts, and other payment modes", async () => {
  f.rows.camp_bookings = [
    {
      id: "b",
      parent_id: "p01",
      status: "paid",
      camps: { payment_mode: "live" },
    },
    {
      id: "x",
      parent_id: "p02",
      status: "review",
      camps: { payment_mode: "live" },
    },
    {
      id: "y",
      parent_id: "p03",
      status: "paid",
      camps: { payment_mode: "test" },
    },
  ];
  const result = await profileList(
    { role: "staff" } as any,
    "",
    0,
    true,
    "name",
    true,
  );
  expect(result.rows.map((r) => r.id)).toEqual(["p01"]);
  expect(result.total).toBe(1);
});
it("keeps the active-subscription filter independent of portal activation", async () => {
  f.rows.subscription_players = [
    {
      id: "m",
      player_id: "child",
      subscriptions: { status: "active", id: "sub" },
      players: { archived_at: null },
    },
  ];
  f.rows.parent_players = [
    {
      id: "link",
      parent_id: "p00",
      player_id: "child",
      players: { archived_at: null },
    },
  ];
  expect(
    (await profileList({ role: "admin" } as any)).rows.map((r) => r.id),
  ).toEqual(["p00"]);
  expect((await profileList({ role: "admin" } as any, "", 0, true)).total).toBe(
    32,
  );
});
it("does not drop a family or invent unsent status when status sources are unavailable", async () => {
  f.unavailable = "parent_invitations";
  const result = await profileList({ role: "admin" } as any, "", 0, true);
  expect(result.rows).toHaveLength(25);
  expect(result.rows[0].portal_access).toMatchObject({
    complete: false,
    invitation: { status: "unknown" },
  });
});
it("does not inherit another recipient's invitation, exposes no tokens, and distinguishes capture from real delivery", async () => {
  const parent = f.rows.parents[0];
  f.rows.parent_invitations = [
    {
      id: "i",
      parent_id: parent.id,
      email: parent.contact_email,
      created_at: "2026-11-14",
      expires_at: "2099-01-01",
    },
  ];
  f.rows.notification_jobs = [
    {
      id: "j",
      kind: "invitation",
      payload: { invitation_id: "i", url: "SECRET_TOKEN" },
      invitation_id: "i",
      recipient: parent.contact_email,
      status: "sent",
      notification_deliveries: [
        {
          recipient: parent.contact_email,
          provider: "capture",
          status: "sent",
          created_at: "2026-11-14",
        },
      ],
    },
  ];
  let access = (await readProfileAccess([parent], "admin")).get(parent.id)!;
  expect(access.invitation.status).toBe("uncertain");
  f.rows.notification_jobs[0].notification_deliveries[0].provider = "proton";
  access = (await readProfileAccess([parent], "admin")).get(parent.id)!;
  expect(access.invitation.status).toBe("sent");
  expect(JSON.stringify(access)).not.toContain("SECRET_TOKEN");
  parent.contact_email = "changed@example.invalid";
  expect(
    (await readProfileAccess([parent], "admin")).get(parent.id)!.invitation
      .status,
  ).toBe("none");
});
it.each(["parent", undefined])(
  "blocks directory access for %s before any reads",
  async (role) => {
    await expect(
      profileList({ role } as any, "", 0, true),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.reads).toEqual([]);
  },
);
