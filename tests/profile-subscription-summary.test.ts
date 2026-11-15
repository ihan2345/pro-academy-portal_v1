import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  list: vi.fn(),
  product: vi.fn(),
  plans: [] as any[],
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: () => ({
      select: () => ({ in: async () => ({ data: f.plans, error: null }) }),
    }),
  }),
}));
import { readProfileSubscriptions } from "../src/lib/server/profile-subscription-summary";
const stripe = {
  subscriptions: { list: f.list },
  products: { retrieve: f.product },
} as any;
const sub = (id: string, status: string, ended_at = 0) => ({
  id,
  status,
  start_date: 10,
  ended_at,
  items: {
    has_more: false,
    data: [
      {
        current_period_end: 100,
        price: { id: "price_one", product: "prod_one", nickname: null },
      },
    ],
  },
  cancellation_details: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  f.plans = [{ stripe_price_id: "price_one", name: "Pro-Player" }];
  f.list.mockResolvedValue({ data: [], has_more: false });
  f.product.mockResolvedValue({ name: "Stripe-Tarif" });
});
it("shows all current active subscriptions with their actual tariff names and scheduled cancellation", async () => {
  f.list.mockResolvedValue({
    data: [
      { ...sub("active", "active"), cancel_at_period_end: true },
      sub("second", "active"),
      sub("old", "canceled", 200),
    ],
    has_more: false,
  });
  const result = await readProfileSubscriptions(
    stripe,
    ["cus_one"],
    new Map([["old", 200]]),
  );
  expect(result.complete).toBe(true);
  expect(result.active).toHaveLength(2);
  expect(result.active[0].names).toEqual(["Pro-Player"]);
  expect(result.active[0].cancel_at).not.toBeNull();
  expect(result.previous).toBeNull();
});
it("selects the last evidenced active subscription, not a newer never-paid incomplete attempt", async () => {
  f.list.mockResolvedValue({
    data: [
      sub("never_active", "incomplete_expired", 999),
      {
        ...sub("last", "canceled", 500),
        cancellation_details: {
          reason: "cancellation_requested",
          feedback: "too_expensive",
          comment: "Familienbudget",
        },
      },
      sub("older", "canceled", 100),
    ],
    has_more: false,
  });
  const result = await readProfileSubscriptions(
    stripe,
    ["cus_one"],
    new Map([
      ["older", 100],
      ["last", 500],
    ]),
  );
  expect(result.active).toEqual([]);
  expect(result.previous).toMatchObject({
    id: "last",
    names: ["Pro-Player"],
    cancellation_reason: "Vom Kunden gekündigt · Zu teuer · Familienbudget",
  });
});
it("does not invent a cancellation reason and resolves unknown plan names from Stripe", async () => {
  f.plans = [];
  f.list.mockResolvedValue({
    data: [sub("old", "canceled", 500)],
    has_more: false,
  });
  const result = await readProfileSubscriptions(
    stripe,
    ["cus_one"],
    new Map([["old", 500]]),
  );
  expect(result.previous).toMatchObject({
    names: ["Stripe-Tarif"],
    cancellation_reason: null,
  });
});
it("paginates without treating missing or incomplete Stripe data as no subscription", async () => {
  f.list
    .mockResolvedValueOnce({ data: [sub("old", "canceled")], has_more: true })
    .mockResolvedValueOnce({
      data: [sub("current", "active")],
      has_more: false,
    });
  expect(
    (await readProfileSubscriptions(stripe, ["cus_one"], new Map())).active[0]
      .id,
  ).toBe("current");
  expect(f.list.mock.calls[1][0].starting_after).toBe("old");
  f.list.mockRejectedValue(new Error("missing permission"));
  expect(
    (await readProfileSubscriptions(stripe, ["cus_one"], new Map())).complete,
  ).toBe(false);
});
it("never labels an unpaid cancelled attempt as a former active subscription", async () => {
  f.list.mockResolvedValue({
    data: [sub("never_paid", "canceled", 100)],
    has_more: false,
  });
  expect(
    (await readProfileSubscriptions(stripe, ["cus_one"], new Map())).previous,
  ).toBeNull();
});
it("does not label a cancelled free trial as a former paid active subscription", async () => {
  f.list.mockResolvedValue({
    data: [
      { ...sub("trial", "canceled", 500), trial_start: 10, trial_end: 500 },
    ],
    has_more: false,
  });
  expect(
    (
      await readProfileSubscriptions(
        stripe,
        ["cus_one"],
        new Map([["trial", 500]]),
      )
    ).previous,
  ).toBeNull();
});
