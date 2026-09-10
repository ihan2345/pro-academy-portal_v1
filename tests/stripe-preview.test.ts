import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  stripeCustomerPage,
  subscriptionPreviewLoader,
} from "../src/lib/server/stripe-preview";

describe("Stripe customer lookup", () => {
  it("loads older customers with the list cursor and stops at the last page", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "cus_first" }], has_more: true })
      .mockResolvedValueOnce({ data: [{ id: "cus_older" }], has_more: false });
    const stripe = { customers: { list } } as unknown as Stripe;
    const first = await stripeCustomerPage(stripe);
    const second = await stripeCustomerPage(stripe, "", first.next_cursor!);
    expect(list.mock.calls[1][0]).toEqual({
      limit: 25,
      starting_after: "cus_first",
    });
    expect(second.data[0].id).toBe("cus_older");
    expect(second.next_cursor).toBeNull();
  });

  it("searches Stripe beyond the loaded list and uses its separate search cursor", async () => {
    const search = vi.fn().mockResolvedValue({
      data: [{ id: "cus_matching_older_customer" }],
      has_more: true,
      next_page: "search_next",
    });
    const list = vi.fn();
    const stripe = { customers: { search, list } } as unknown as Stripe;
    const first = await stripeCustomerPage(stripe, "  Ayhan  ");
    await stripeCustomerPage(stripe, "Ayhan", first.next_cursor!);
    expect(search).toHaveBeenLastCalledWith({
      query: 'name~"Ayhan" OR email~"Ayhan"',
      limit: 25,
      page: "search_next",
    });
    expect(first.data[0].id).toBe("cus_matching_older_customer");
    expect(list).not.toHaveBeenCalled();
  });

  it("quotes names literally so user input cannot add a Stripe query clause", async () => {
    const search = vi.fn().mockResolvedValue({ data: [], has_more: false });
    const stripe = { customers: { search } } as unknown as Stripe;
    const term = 'Ayhan\\" OR email:"other@example.com';
    const result = await stripeCustomerPage(stripe, term);
    expect(search).toHaveBeenCalledWith({
      query:
        'name~"Ayhan\\\\\\" OR email:\\"other@example.com" OR email~"Ayhan\\\\\\" OR email:\\"other@example.com"',
      limit: 25,
    });
    expect(result.next_cursor).toBeNull();
  });
});

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
