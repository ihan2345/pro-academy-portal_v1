import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  enabled: true,
  records: [] as any[],
  rows: [] as any[],
  error: null as any,
  rpc: vi.fn(),
  list: vi.fn(),
  require: vi.fn(),
}));
vi.mock("../src/lib/server/products/runtime", () => ({
  productsEnabled: () => m.enabled,
  requireProductPayments: m.require,
}));
vi.mock("../src/lib/gifts/runtime", () => ({ giftsEnabled: () => true }));
vi.mock("../src/lib/server/products/catalog", () => ({ listProducts: m.list }));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    rpc: m.rpc,
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        then: (resolve: any) =>
          Promise.resolve({ data: m.records, error: m.error }).then(resolve),
      };
      return q;
    },
  }),
}));
import {
  campShopBooking,
  prepareCampShopBooking,
} from "../src/lib/camps/shop-booking";
const camp = "90000000-0000-4000-8000-000000000001",
  product = "90000000-0000-4000-8000-000000000002";
beforeEach(() => {
  vi.resetAllMocks();
  m.enabled = true;
  m.records = [];
  m.rows = [];
  m.error = null;
  m.list.mockImplementation(async () => ({
    rows: m.rows,
    gifts_enabled: true,
    payments_enabled: true,
  }));
});
it("offers both code types without writing during Camp loading, even without a published shop card", async () => {
  expect(await campShopBooking(camp, ["offer"], null)).toEqual({
    product: null,
    gifts_enabled: true,
    payments_enabled: process.env.PRODUCT_PAYMENTS_ENABLED === "true",
  });
  expect(m.rpc).not.toHaveBeenCalled();
});
it("resolves only a visible Shop product of the same Camp and keeps its channel", async () => {
  m.records = [{ id: product, camp_checkout_for: null }];
  m.rows = [
    {
      id: product,
      kind: "camp",
      camp_booking_url: `/camp/buchung/${camp}?product=${product}`,
    },
  ];
  expect(
    (await campShopBooking(camp, ["offer"], null, product, "homepage"))?.product
      ?.id,
  ).toBe(product);
  expect(m.list.mock.calls[0][1].get("channel")).toBe("homepage");
  expect(m.rpc).not.toHaveBeenCalled();
  m.rows = [
    {
      id: product,
      kind: "camp",
      camp_booking_url: "/camp/buchung/other?product=" + product,
    },
  ];
  await expect(
    campShopBooking(camp, ["offer"], null, product),
  ).rejects.toMatchObject({ status: 404 });
});
it("fails closed on lookup errors and disabled product payments", async () => {
  m.error = { message: "unavailable" };
  await expect(campShopBooking(camp, ["offer"], null)).rejects.toMatchObject({
    status: 503,
  });
  m.enabled = false;
  expect(await campShopBooking(camp, ["offer"], null)).toBeNull();
  await expect(
    campShopBooking(camp, ["offer"], null, product),
  ).rejects.toMatchObject({ status: 503 });
  m.require.mockImplementation(() => {
    throw { status: 503 };
  });
  await expect(prepareCampShopBooking(camp)).rejects.toMatchObject({
    status: 503,
  });
  expect(m.rpc).not.toHaveBeenCalled();
});
it("prepares the single backing record only on explicit booking and validates its result", async () => {
  m.rpc.mockResolvedValue({ data: product, error: null });
  expect(await prepareCampShopBooking(camp)).toEqual({ id: product });
  expect(m.rpc).toHaveBeenCalledWith("camp_ensure_checkout_product", { camp });
  m.rpc.mockResolvedValue({ data: null, error: { message: "closed" } });
  await expect(prepareCampShopBooking(camp)).rejects.toMatchObject({
    status: 409,
  });
});
