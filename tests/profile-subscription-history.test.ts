import { expect, it, vi, afterEach } from "vitest";
const db = vi.hoisted(() => ({ from: vi.fn() }));
const client = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../src/lib/server/service-db", () => ({ serviceDb: () => db }));
vi.mock("../src/lib/server/profile-stripe", () => ({
  profileStripeClient: client.get,
}));
import {
  readSubscriptionHistory,
  profileActivePeriods,
} from "../src/lib/server/profile-subscription-history";
const line = (
  id: string,
  start: number,
  end: number,
  item = "si_one",
  amount = 100,
) => ({
  id,
  amount,
  period: { start, end },
  parent: { subscription_item_details: { subscription_item: item } },
});
const stripe = (invoices: any[]) => ({
  subscriptions: {
    retrieve: vi.fn().mockResolvedValue({
      created: 10,
      start_date: 10,
      trial_end: 20,
      ended_at: 100,
    }),
  },
  invoices: {
    list: vi.fn().mockResolvedValue({ data: invoices, has_more: false }),
    listLineItems: vi.fn(),
  },
});
afterEach(() => vi.clearAllMocks());
it("uses paid recurring invoice periods, clips trials and termination, keeps zero-price discounts", async () => {
  const api = stripe([
    {
      id: "in_one",
      lines: {
        has_more: false,
        data: [
          line("trial", 10, 20),
          line("active", 20, 50),
          line("end", 50, 120),
          line("credit", 20, 50, "si_one", -100),
          line("discount", 20, 50, "si_two", 0),
          { ...line("camp", 20, 50), parent: null },
        ],
      },
    },
  ]);
  expect(await readSubscriptionHistory(api as any, "sub_one")).toEqual([
    { item: "si_one", start: 20, end: 50 },
    { item: "si_one", start: 50, end: 100 },
    { item: "si_two", start: 20, end: 50 },
  ]);
  expect(api.invoices.list).toHaveBeenCalledWith(
    expect.objectContaining({ status: "paid", subscription: "sub_one" }),
    expect.anything(),
  );
});
it("paginates invoices and all invoice lines without silently losing history", async () => {
  const api = stripe([]);
  api.invoices.list
    .mockResolvedValueOnce({
      data: [{ id: "in_one", lines: { has_more: true, data: [] } }],
      has_more: true,
    })
    .mockResolvedValueOnce({ data: [], has_more: false });
  api.invoices.listLineItems
    .mockResolvedValueOnce({ data: [line("il_one", 20, 40)], has_more: true })
    .mockResolvedValueOnce({ data: [line("il_two", 40, 50)], has_more: false });
  expect(await readSubscriptionHistory(api as any, "sub_one")).toHaveLength(2);
  expect(api.invoices.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ starting_after: "in_one" }),
    expect.anything(),
  );
  expect(api.invoices.listLineItems).toHaveBeenLastCalledWith(
    "in_one",
    expect.objectContaining({ starting_after: "il_one" }),
    expect.anything(),
  );
});
it("fails rather than returning partial history when Stripe fails", async () => {
  const api = stripe([]);
  api.invoices.list.mockRejectedValueOnce(new Error("timeout"));
  await expect(readSubscriptionHistory(api as any, "sub_one")).rejects.toThrow(
    "timeout",
  );
});
it("maps each item to its own child, persists complete history and reuses fresh cache", async () => {
  const api = stripe([
    {
      id: "in_one",
      lines: {
        has_more: false,
        data: [line("a", 20, 80), line("b", 30, 90, "si_two")],
      },
    },
  ]);
  client.get.mockReturnValue(api);
  let rows: any[] = [];
  const upsert = vi.fn(async (row: any) => {
    rows = [row];
    return { error: null };
  });
  db.from.mockImplementation(() => ({
    select: () => ({ in: async () => ({ data: rows, error: null }) }),
    upsert,
  }));
  const sub = {
    id: "db_one",
    stripe_subscription_id: "sub_one",
    status: "active",
    stripe_data: {},
  };
  const links = [
    { player_id: "one", stripe_item_id: "si_one", subscriptions: sub },
    { player_id: "two", stripe_item_id: "si_two", subscriptions: sub },
  ];
  const snapshot = {
    player_id: "one",
    subscription_id: "db_one",
    starts_at: "1970-01-01T00:00:00Z",
    ends_at: "2030-01-01T00:00:00Z",
    status: "active",
    product_name: "Abo",
  };
  const result = await profileActivePeriods(
    links,
    [snapshot],
    "2026-10-10T10:00:00Z",
  );
  expect(result).toHaveLength(2);
  expect(result.map((p) => p.player_id)).toEqual(["one", "two"]);
  expect(result[0].starts_at).toBe("1970-01-01T00:00:20.000Z");
  expect(upsert).toHaveBeenCalledTimes(1);
  await profileActivePeriods(links, [], "2026-10-10T11:00:00Z");
  expect(client.get).toHaveBeenCalledTimes(1);
  await profileActivePeriods(links, [], "2026-10-10T17:00:00Z");
  expect(client.get).toHaveBeenCalledTimes(2);
  sub.status = "canceled";
  await profileActivePeriods(links, [], "2026-10-10T17:01:00Z");
  expect(client.get).toHaveBeenCalledTimes(3);
});
it("does not turn unavailable history into a zero-month downgrade", async () => {
  db.from.mockReturnValue({
    select: () => ({
      in: async () => ({ error: { code: "42P01" }, data: null }),
    }),
  });
  await expect(
    profileActivePeriods(
      [
        {
          player_id: "a",
          stripe_item_id: "si_a",
          subscriptions: {
            id: "a",
            stripe_subscription_id: "sub_a",
            status: "active",
            stripe_data: {},
          },
        },
      ],
      [],
      "2026-10-10T10:00:00Z",
    ),
  ).rejects.toThrow("Migration");
});

it("a later trial does not erase earlier paid service", async () => {
  const api = stripe([
    {
      id: "in_one",
      lines: { has_more: false, data: [line("a", 10, 50), line("b", 50, 90)] },
    },
  ]);
  api.subscriptions.retrieve.mockResolvedValue({
    created: 10,
    start_date: 10,
    trial_start: 50,
    trial_end: 60,
    ended_at: 100,
  } as any);
  expect(await readSubscriptionHistory(api as any, "sub_one")).toEqual([
    { item: "si_one", start: 10, end: 50 },
    { item: "si_one", start: 60, end: 90 },
  ]);
});
