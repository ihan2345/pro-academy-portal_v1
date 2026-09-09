import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { subscriptionPreviewLoader } from "../src/lib/server/stripe-preview";

function fixture(product: string | object = "prod_current") {
  const list = vi.fn(async (params: Stripe.SubscriptionListParams) => {
    if (params.expand?.some((path) => path.split(".").length > 4))
      throw new Error("property_expansion_max_depth");
    return {
      data: [
        {
          id: "sub_fixture",
          status: "active",
          items: {
            data: [
              {
                id: "si_fixture",
                price: {
                  id: "price_fixture",
                  product,
                  unit_amount: 30000,
                  currency: "eur",
                },
              },
            ],
          },
        },
      ],
    };
  });
  const retrieve = vi.fn(async (id: string) => ({
    id,
    name: "PRO Player - Pass",
  }));
  const stripe = {
    subscriptions: { list },
    products: { retrieve },
  } as unknown as Stripe;
  return { stripe, list, retrieve };
}

describe("Stripe subscription import preview", () => {
  it("loads product names without exceeding Stripe's expansion depth", async () => {
    const { stripe, list } = fixture();
    const result = await subscriptionPreviewLoader(stripe)("cus_fixture");
    expect(list).toHaveBeenCalledWith({
      customer: "cus_fixture",
      status: "all",
      limit: 100,
    });
    expect(result).toEqual([
      {
        id: "sub_fixture",
        status: "active",
        items: [
          {
            id: "si_fixture",
            price: "price_fixture",
            product: "PRO Player - Pass",
            amount: 30000,
            currency: "eur",
          },
        ],
      },
    ]);
  });

  it("shares in-flight product reads across customers but not requests", async () => {
    const { stripe, retrieve } = fixture();
    const load = subscriptionPreviewLoader(stripe);
    await Promise.all([load("cus_one"), load("cus_two")]);
    expect(retrieve).toHaveBeenCalledTimes(1);
    await subscriptionPreviewLoader(stripe)("cus_three");
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      { id: "prod_expanded", name: "Archived plan", active: false },
      "Archived plan",
    ],
    [{ id: "prod_deleted", deleted: true }, "prod_deleted"],
  ])(
    "handles existing product objects without another read",
    async (product, expected) => {
      const { stripe, retrieve } = fixture(product);
      const result = await subscriptionPreviewLoader(stripe)("cus_fixture");
      expect(result[0].items[0].product).toBe(expected);
      expect(retrieve).not.toHaveBeenCalled();
    },
  );

  it("propagates API failures instead of showing an incomplete successful preview", async () => {
    const { stripe, retrieve } = fixture();
    retrieve.mockRejectedValueOnce(new Error("permission denied"));
    await expect(
      subscriptionPreviewLoader(stripe)("cus_fixture"),
    ).rejects.toThrow("permission denied");
  });
});
