import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
const f = vi.hoisted(() => ({
  list: vi.fn(),
  parents: [] as any[],
  links: [] as any[],
  db: vi.fn(),
}));
vi.mock("../src/lib/server/profile-stripe", () => ({
  profileStripeClient: () => ({ charges: { list: f.list } }),
}));
vi.mock("../src/lib/server/service-db", () => ({ serviceDb: f.db }));
vi.mock("../src/lib/server/profile-subscription-history", () => ({
  profileActivePeriods: async () => [],
}));
import {
  compareRevenue,
  parentRevenue,
  readParentRevenue,
} from "../src/lib/server/profile-revenue";
import { profileList } from "../src/lib/server/parent-profile";

const charge = (id: string, customer: string, amount: number, extra = {}) =>
  ({
    id,
    customer,
    amount_captured: amount,
    amount_refunded: 0,
    currency: "eur",
    status: "succeeded",
    paid: true,
    captured: true,
    ...extra,
  }) as Stripe.Charge;
const links = [
  { parent_id: "one", stripe_customer_id: "cus_a" },
  { parent_id: "one", stripe_customer_id: "cus_b" },
  { parent_id: "two", stripe_customer_id: "cus_c" },
];
beforeEach(() => {
  vi.clearAllMocks();
  f.parents = [];
  f.links = [];
  f.db.mockImplementation(() => ({
    from: (table: string) => {
      let range: [number, number] | undefined;
      const q: any = {};
      for (const method of ["select", "is", "order", "limit", "gt", "in", "eq"])
        q[method] = () => q;
      q.range = (from: number, to: number) => {
        range = [from, to];
        return q;
      };
      q.then = (resolve: any) => {
        let data =
          table === "parents"
            ? f.parents
            : table === "parent_stripe_customers"
              ? f.links
              : [];
        if (range) data = data.slice(range[0], range[1] + 1);
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return q;
    },
  }));
});
it("combines multiple customer accounts, subtracts refunds and counts each successful captured payment once", () => {
  const first = charge("ch_a", "cus_a", 10000, { amount_refunded: 2500 });
  const totals = parentRevenue(["one", "two", "missing"], links, [
    first,
    first,
    charge("ch_b", "cus_b", 5000),
    charge("ch_fail", "cus_c", 99900, { status: "failed" }),
    charge("ch_auth", "cus_c", 10000, { captured: false }),
    charge("ch_other", "cus_other", 50000),
  ]);
  expect([...totals]).toEqual([
    ["one", 12500],
    ["two", 0],
    ["missing", null],
  ]);
});
it("does not rank shared mappings, disputes or other currencies as reliable euro totals", () => {
  const mapping = [
    ...links,
    { parent_id: "outside", stripe_customer_id: "cus_a" },
  ];
  expect(
    parentRevenue(["one"], mapping, [charge("ch", "cus_a", 5000)]).get("one"),
  ).toBeNull();
  for (const extra of [{ currency: "usd" }, { disputed: true }])
    expect(
      parentRevenue(["two"], links, [charge("ch", "cus_c", 5000, extra)]).get(
        "two",
      ),
    ).toBeNull();
});
it.each(["staff", "parent", undefined])(
  "blocks %s revenue access before reads",
  async (role) => {
    await expect(readParentRevenue(role, ["one"], links)).rejects.toThrow(
      "nur für Admins",
    );
    await expect(
      profileList({ role } as any, "", 0, true, "revenue"),
    ).rejects.toThrow();
    expect(f.list).not.toHaveBeenCalled();
    expect(f.db).not.toHaveBeenCalled();
  },
);
it("reads every Stripe page and refuses a truncated response", async () => {
  f.list.mockImplementation(async ({ customer, starting_after }) =>
    customer === "cus_b"
      ? { data: [], has_more: false }
      : starting_after
        ? { data: [charge("ch2", "cus_a", 9000)], has_more: false }
        : { data: [charge("ch1", "cus_a", 5000)], has_more: true },
  );
  expect((await readParentRevenue("admin", ["one"], links)).get("one")).toBe(
    14000,
  );
  expect(
    f.list.mock.calls.some(([params]) => params.starting_after === "ch1"),
  ).toBe(true);
  f.list.mockReset();
  f.list.mockResolvedValue({ data: [], has_more: true });
  await expect(readParentRevenue("admin", ["one"], links)).rejects.toThrow(
    "nicht vollständig",
  );
});
it("marks missing customer accounts unavailable without pretending a zero total", async () => {
  f.list.mockImplementation(async ({ customer }) => {
    if (customer === "cus_a")
      throw Object.assign(new Error("missing"), { code: "resource_missing" });
    return { data: [charge("ch", "cus_b", 5000)], has_more: false };
  });
  expect(
    (await readParentRevenue("admin", ["one"], links)).get("one"),
  ).toBeNull();
});
it("ranks all families before pagination and puts unknown totals after zero", async () => {
  f.parents = Array.from({ length: 27 }, (_, i) => ({
    id: `p${i}`,
    full_name: `Name ${String(i).padStart(2, "0")}`,
    contact_email: "test@example.invalid",
  }));
  f.links = f.parents.slice(0, 26).map((p) => ({
    id: p.id,
    parent_id: p.id,
    stripe_customer_id: `cus_${p.id}`,
  }));
  f.list.mockResolvedValue({
    data: [charge("ch", "cus_p25", 20000)],
    has_more: false,
  });
  const s = { role: "admin" } as any;
  const first = await profileList(s, "", 0, true, "revenue");
  expect(first.rows[0]).toMatchObject({ id: "p25", revenue: 20000 });
  expect(first.rows).toHaveLength(25);
  expect(first.more).toBe(true);
  const second = await profileList(s, "", 25, true, "revenue");
  expect(second.rows.map((r) => [r.id, r.revenue])).toEqual([
    ["p24", 0],
    ["p26", null],
  ]);
  expect(second.more).toBe(false);
  const totals = new Map([
    ["a", 0],
    ["b", null],
  ]);
  expect(
    compareRevenue(
      { id: "a", full_name: "Z" },
      { id: "b", full_name: "A" },
      totals,
    ),
  ).toBeLessThan(0);
});
