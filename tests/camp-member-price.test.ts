import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), verify: vi.fn() }));
vi.mock("../src/lib/camps/option-price", () => ({
  findCampOptionPrice: m.find,
}));
vi.mock("../src/lib/server/products/stripe", () => ({
  productStripe: () => ({}),
  validateProductPrice: m.verify,
}));
import { campMemberPrice } from "../src/lib/server/products/camp-member-price";
const base: any = {
  id: "price_base",
  product_id: "prod_camp",
  amount: 20610,
  currency: "eur",
  livemode: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  m.find.mockResolvedValue({ id: "price_net" });
  m.verify.mockResolvedValue({ ...base, id: "price_net", amount: 17518 });
});
it("uses the existing Camp product and identical cent rounding for its member price", async () => {
  expect(await campMemberPrice(base, 15)).toMatchObject({
    id: "price_net",
    amount: 17518,
  });
  expect(m.find).toHaveBeenCalledWith(
    expect.anything(),
    "prod_camp",
    17518,
    "eur",
  );
  expect(m.verify).toHaveBeenCalledWith("price_net", "camp", "prod_camp");
});
it.each([{ amount: 1 }, { currency: "usd" }, { livemode: true }])(
  "rejects an unverified or mismatched member price %j",
  async (patch) => {
    m.verify.mockResolvedValue({
      ...base,
      id: "price_net",
      amount: 17518,
      ...patch,
    });
    await expect(campMemberPrice(base, 15)).rejects.toMatchObject({
      status: 409,
    });
  },
);
it("rejects arbitrary entitlement percentages before creating a price", async () => {
  await expect(campMemberPrice(base, 100)).rejects.toMatchObject({
    status: 400,
  });
  expect(m.find).not.toHaveBeenCalled();
});
