import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  retrieve: vi.fn(),
  calls: 0,
}));
vi.mock("../src/lib/server/profile-stripe", () => ({
  profileStripeClient: () => ({ customers: { retrieve: mock.retrieve } }),
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => {
    mock.calls++;
    return {
      from: (table: string) => {
        const q: any = {
          select: () => q,
          eq: () => q,
          in: () => q,
          is: () => q,
          order: () => q,
          range: () => q,
          limit: () => q,
          then: (fn: any) =>
            Promise.resolve({
              data: mock.tables[table] ?? [],
              count: mock.tables[table]?.length ?? 0,
              error: null,
            }).then(fn),
        };
        return q;
      },
    };
  },
}));
import { subscriptionReviews } from "../src/lib/server/subscription-reviews";
import { reviewExplanation } from "../src/lib/subscription-reviews";
beforeEach(() => {
  mock.calls = 0;
  mock.retrieve.mockReset();
  mock.tables = {
    subscription_assignment_reviews: [
      {
        id: "review",
        signature: "a".repeat(32),
        created_at: "2026-10-17",
        subscription_id: "sub_local",
        previous_item_ids: [],
        suggested_player_ids: [],
        item: {
          id: "si_new",
          price_id: "price",
          starts_at: "2026-10-17",
          ends_at: "2026-11-17",
        },
        subscriptions: {
          parent_id: null,
          stripe_customer_id: "cus_example",
          stripe_subscription_id: "sub_example",
          status: "active",
          synced_at: "2026-10-18",
        },
      },
    ],
    plans: [
      {
        id: "plan",
        stripe_price_id: "price",
        name: "FirstTouch",
        included_units: 4,
      },
    ],
  };
});
it("explains the actual empty-selection case and includes read-only Stripe customer context", async () => {
  mock.retrieve.mockResolvedValue({
    id: "cus_example",
    name: "Example",
    email: "example@test.test",
  });
  const {
    rows: [r],
  } = await subscriptionReviews({ role: "admin" } as any);
  expect(r.candidates).toEqual([]);
  expect(r.context.customerName).toBe("Example");
  expect(r.context.subscriptionId).toBe("sub_example");
  expect(reviewExplanation(r)).toContain("noch keiner Familie");
  expect(mock.retrieve).toHaveBeenCalledOnce();
});
it("retains review data when Stripe lookup fails instead of an empty broken screen", async () => {
  mock.retrieve.mockRejectedValue(Error("private provider error"));
  const {
    rows: [r],
  } = await subscriptionReviews({ role: "admin" } as any);
  expect(r.context.customerDetailsUnavailable).toBe(true);
  expect(JSON.stringify(r)).not.toContain("private provider error");
  expect(r.product).toBe("FirstTouch");
});
it("uses locally known customer data and explains the single family candidate", async () => {
  mock.tables.stripe_customer_registry = [
    { id: "cus_example", name: "Parent", email: "p@test.test" },
  ];
  mock.tables.parent_stripe_customers = [
    { id: "link", parent_id: "p", stripe_customer_id: "cus_example" },
  ];
  mock.tables.parents = [{ id: "p", full_name: "Parent" }];
  mock.tables.parent_players = [
    {
      id: "pp",
      parent_id: "p",
      player_id: "child",
      players: {
        id: "child",
        first_name: "Child",
        last_name: "Example",
        archived_at: null,
      },
    },
  ];
  const {
    rows: [r],
  } = await subscriptionReviews({ role: "admin" } as any);
  expect(r.candidates).toHaveLength(1);
  expect(r.context.parents).toEqual([{ id: "p", name: "Parent" }]);
  expect(reviewExplanation(r)).toContain("einzige aktive Kind");
  expect(mock.retrieve).not.toHaveBeenCalled();
});
it.each(["staff", "parent", undefined])(
  "denies %s before database or Stripe access",
  async (role) => {
    await expect(subscriptionReviews({ role } as any)).rejects.toThrow();
    expect(mock.calls).toBe(0);
    expect(mock.retrieve).not.toHaveBeenCalled();
  },
);
it("flags a new legacy subscription until its exact tariff has an approval", async () => {
  mock.tables.stripe_customer_registry = [
    { id: "cus_example", name: "Parent", email: "p@test.test" },
  ];
  mock.tables.plans[0].generation = "legacy";
  mock.tables.subscription_assignment_reviews[0].subscriptions.stripe_data = {
    subscription_created_at: "2026-10-16T06:38:42Z",
  };
  expect(
    (await subscriptionReviews({ role: "admin" } as any)).rows[0]
      .requiresLegacyConfirmation,
  ).toBe(true);
  mock.tables.subscription_legacy_approvals = [
    {
      id: "approval",
      subscription_id: "sub_local",
      stripe_price_id: "other_price",
    },
  ];
  expect(
    (await subscriptionReviews({ role: "admin" } as any)).rows[0]
      .requiresLegacyConfirmation,
  ).toBe(true);
  mock.tables.subscription_legacy_approvals[0].stripe_price_id = "price";
  expect(
    (await subscriptionReviews({ role: "admin" } as any)).rows[0]
      .requiresLegacyConfirmation,
  ).toBe(false);
});
