import { beforeEach, afterEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  from: vi.fn(),
  session: vi.fn(),
  verify: vi.fn(),
  insert: vi.fn(),
  queries: [] as any[],
  rows: {} as Record<string, any[]>,
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: f.from,
    rpc: async () => ({ data: 0, error: null }),
  }),
}));
vi.mock("../src/lib/server/supabase", () => ({ sessionUser: f.session }));
vi.mock("../src/lib/camps/runtime", () => ({
  campPaymentMode: () => "test",
  campLocalEnabled: () => false,
  campPublicOrigin: () => null,
  campAppOrigin: () => "https://example.invalid",
}));
vi.mock("../src/lib/camps/stripe", () => ({
  verifyOffer: f.verify,
  checkoutUrl: () => "https://checkout.example.invalid",
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "browser" }), set: vi.fn() }),
}));
import {
  createBooking,
  discount,
  publicCamp,
  dashboard,
} from "../src/lib/camps/service";
const campId = "a0000000-0000-4000-8000-000000000001";
const playerId = "b0000000-0000-4000-8000-000000000001";
const siblingId = "b0000000-0000-4000-8000-000000000002";
const parentId = "c0000000-0000-4000-8000-000000000001";
const input = {
  camp_id: campId,
  player_id: playerId,
  parent: {
    name: "Test Parent",
    email: "test@example.invalid",
    phone: "123456",
  },
  child: {
    first_name: "Test",
    last_name: "Child",
    birth_date: "2015-01-01",
    gender: "keine Angabe",
    clothing_size: "140",
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  f.queries = [];
  f.session.mockResolvedValue({ role: "parent", user: { id: "user" } });
  const children = [playerId, siblingId].map((id) => ({
    id,
    first_name: "Test",
    last_name: "Child",
    archived_at: null,
    camp_birth_date: "2015-01-01",
  }));
  f.rows = {
    parents: [
      {
        id: parentId,
        auth_user_id: "user",
        full_name: "Test Parent",
        contact_email: "test@example.invalid",
        archived_at: null,
      },
    ],
    parent_players: children.map((players) => ({
      parent_id: parentId,
      players,
    })),
    camps: [
      {
        id: campId,
        payment_mode: "test",
        status: "open",
        capacity: 20,
        buffer_percent: 0,
        min_age: 6,
        max_age: 16,
        early_bird_until: null,
        days: [{ starts_at: "2027-04-01T08:00:00Z" }],
      },
    ],
    camp_offers: [
      {
        id: "offer",
        camp_id: campId,
        kind: "main",
        stripe_price_id: "price_camp",
        stripe_payment_link_id: "plink_camp",
        amount: 10000,
        currency: "eur",
        codes: { "15": "BENEFIT" },
      },
    ],
    camp_bookings: [],
    subscription_players: [
      {
        player_id: playerId,
        stripe_item_id: "item",
        subscriptions: {
          status: "active",
          stripe_data: { items: [{ id: "item", price_id: "price_abo" }] },
        },
      },
    ],
    plans: [{ stripe_price_id: "price_abo", camp_benefit_percent: 15 }],
  };
  f.from.mockImplementation((table: string) => {
    const predicates: ((row: any) => boolean)[] = [];
    let inserted = false;
    const call = { table, filters: [] as any[] };
    f.queries.push(call);
    const result = () => ({
      data: inserted
        ? null
        : (f.rows[table] ?? []).filter((r) => predicates.every((p) => p(r))),
      error: null,
    });
    const q: any = {
      select: () => q,
      order: () => q,
      lte: () => q,
      gt: () => q,
      eq: (key: string, value: any) => {
        call.filters.push([key, value]);
        predicates.push((r) => r[key] === value);
        return q;
      },
      is: (key: string, value: any) => {
        predicates.push((r) => r[key] === value);
        return q;
      },
      in: (key: string, values: any[]) => {
        call.filters.push([key, values]);
        predicates.push((r) => values.includes(r[key]));
        return q;
      },
      or: (value: string) => {
        call.filters.push(["or", value]);
        if (table === "camp_bookings")
          predicates.push(
            (r) =>
              r.parent_id === parentId ||
              [playerId, siblingId].includes(r.player_id),
          );
        return q;
      },
      insert: (value: any) => {
        inserted = true;
        f.insert(value);
        return q;
      },
      maybeSingle: async () => ({
        ...result(),
        data: result().data?.[0] ?? null,
      }),
      then: (resolve: any, reject: any) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return q;
  });
});
afterEach(() => vi.useRealTimers());
it.each(["paid", "review"])(
  "blocks %s children before Stripe and suppresses their discount",
  async (status) => {
    f.rows.camp_bookings = [
      {
        camp_id: campId,
        player_id: playerId,
        parent_id: "other-linked-parent",
        status,
      },
    ];
    await expect(createBooking(input)).rejects.toMatchObject({ status: 409 });
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.insert).not.toHaveBeenCalled();
    expect(await discount(campId, playerId)).toEqual({
      percent: 0,
      code: null,
      booking_status: status,
    });
    expect(
      (await publicCamp(campId)).context.children.map((c) => c.booking_status),
    ).toEqual([status, null]);
  },
);
it.each(["draft", "cancelled", "refunded"])(
  "does not permanently block a %s booking",
  async (status) => {
    f.rows.camp_bookings = [{ camp_id: campId, player_id: playerId, status }];
    expect(await discount(campId, playerId)).toMatchObject({
      percent: 15,
      code: "BENEFIT",
      booking_status: null,
    });
    expect(await createBooking(input)).toMatchObject({
      url: "https://checkout.example.invalid",
    });
    expect(f.insert).toHaveBeenCalledTimes(1);
  },
);
it("keeps siblings and a different camp bookable", async () => {
  f.rows.camp_bookings = [
    { camp_id: campId, player_id: siblingId, status: "paid" },
    { camp_id: "other-camp", player_id: playerId, status: "paid" },
  ];
  expect((await discount(campId, playerId)).code).toBe("BENEFIT");
  await createBooking(input);
  expect(f.insert).toHaveBeenCalledTimes(1);
});
it("rejects a foreign child before reading its booking status", async () => {
  await expect(discount(campId, "foreign-child")).rejects.toMatchObject({
    status: 403,
  });
  expect(f.queries.some((q) => q.table === "camp_bookings")).toBe(false);
});
it("shows a linked child's booking made by the other parent without exposing unrelated bookings", async () => {
  f.rows.camp_bookings = [
    {
      id: "own",
      camp_id: campId,
      player_id: playerId,
      parent_id: "other-linked-parent",
      status: "paid",
    },
    {
      id: "foreign",
      camp_id: campId,
      player_id: "foreign",
      parent_id: "foreign",
      status: "paid",
    },
  ];
  const result = await dashboard();
  expect(result.bookings.map((b: any) => b.id)).toEqual(["own"]);
  expect(
    f.queries.find((q) => q.table === "camp_bookings").filters,
  ).toContainEqual(["player_id", [playerId, siblingId]]);
});

it("does not expose a former child's booking via the historical payer", async () => {
  f.rows.camp_bookings = [
    {
      id: "former",
      camp_id: campId,
      parent_id: parentId,
      player_id: "foreign",
      status: "paid",
    },
  ];
  expect((await dashboard()).bookings).toEqual([]);
});
it("staff dashboard omits personal payment information while keeping participants", async () => {
  f.session.mockResolvedValue({ role: "staff", user: { id: "coach" } });
  f.rows.camp_bookings = [
    {
      id: "booking",
      camp_id: campId,
      player_id: playerId,
      status: "paid",
      paid_amount: 10000,
      paid_at: "2026-10-01",
      stripe_session_id: "cs_secret",
      review_reason: "Payment secret",
    },
  ];
  const result = await dashboard();
  expect(result.bookings).toHaveLength(1);
  const serialized = JSON.stringify(result.bookings);
  for (const key of [
    "paid_amount",
    "paid_at",
    "stripe_session_id",
    "review_reason",
    "cs_secret",
  ])
    expect(serialized).not.toContain(key);
});
