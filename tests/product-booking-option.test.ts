import { beforeEach, expect, it, vi } from "vitest";
import { emptyProduct, productSchema } from "../src/lib/products/domain";
const m = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  validate: vi.fn(),
}));
vi.mock("../src/lib/server/products/stripe", () => ({
  productStripe: () => ({ prices: { list: m.list, create: m.create } }),
  validateProductPrice: m.validate,
}));
import { bookingOptionPrice } from "../src/lib/server/products/booking-option";
const option = {
  amount: 7900,
  title: "Tagesoption",
  description: "Ein Tag",
  alert: "Tag abstimmen",
};
const price = {
  id: "price_original",
  product_id: "prod_camp",
  amount: 9900,
  currency: "eur",
  interval: null,
  interval_count: 1,
  livemode: false,
  checked_at: "2026-11-13T00:00:00Z",
  product_name: "Camp",
  source: "stripe",
} as const;
const product = () => ({
  ...emptyProduct(),
  kind: "camp" as const,
  price,
  booking_option: option,
});
beforeEach(() => {
  vi.resetAllMocks();
  m.list.mockResolvedValue({ data: [] });
  m.create.mockResolvedValue({ id: "price_option" });
  m.validate.mockResolvedValue({ ...price, id: "price_option", amount: 7900 });
});
it("keeps old products compatible and validates option fields", () => {
  expect(productSchema.parse(emptyProduct()).booking_option).toBeUndefined();
  expect(productSchema.parse(product()).booking_option).toEqual(option);
  for (const patch of [
    { amount: 0 },
    { amount: 1.23 },
    { title: "" },
    { alert: "" },
  ])
    expect(
      productSchema.safeParse({
        ...product(),
        booking_option: { ...option, ...patch },
      }).success,
    ).toBe(false);
  expect(productSchema.safeParse({ ...product(), kind: "other" }).success).toBe(
    false,
  );
});
it("creates a checked one-time price on the same Stripe product with deterministic retry keys", async () => {
  const result = await bookingOptionPrice(product());
  expect(result.amount).toBe(7900);
  expect(m.create).toHaveBeenCalledWith(
    expect.objectContaining({
      product: "prod_camp",
      currency: "eur",
      unit_amount: 7900,
    }),
    { idempotencyKey: expect.stringMatching(/^camp-option-/) },
  );
  expect(m.validate).toHaveBeenCalledWith("price_option", "camp", "prod_camp");
  await bookingOptionPrice(product());
  expect(m.create.mock.calls[0][1]).toEqual(m.create.mock.calls[1][1]);
});
it("reuses the matching price and rejects an unexpected amount", async () => {
  m.list.mockResolvedValue({ data: [{ id: "price_option" }] });
  await bookingOptionPrice(product());
  expect(m.create).not.toHaveBeenCalled();
  m.validate.mockResolvedValue({ ...price, amount: 100 });
  await expect(bookingOptionPrice(product())).rejects.toMatchObject({
    status: 409,
  });
});
it("rejects selecting a disabled option", async () => {
  await expect(
    bookingOptionPrice({ ...product(), booking_option: null }),
  ).rejects.toMatchObject({ status: 400 });
  expect(m.list).not.toHaveBeenCalled();
});
