import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  data: true as unknown,
  error: null as unknown,
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ rpc: vi.fn(async () => state) }),
}));
import {
  productsEnabled,
  productShopEnabled,
  requireProductShop,
} from "../src/lib/server/products/runtime";
beforeEach(() => {
  vi.stubEnv("PRODUCT_MANAGEMENT_ENABLED", "true");
  vi.stubEnv("APP_MODE", "production");
  vi.stubEnv("APP_URL", "https://portal.example.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://database.example.invalid");
  state.data = true;
  state.error = null;
});
afterEach(() => vi.unstubAllEnvs());
it("installation and storefront access remain separate", async () => {
  expect(productsEnabled()).toBe(true);
  expect(await productShopEnabled()).toBe(true);
  state.data = false;
  expect(productsEnabled()).toBe(true);
  await expect(requireProductShop()).rejects.toMatchObject({ status: 404 });
});
it("a failed or missing database switch never opens the shop", async () => {
  state.data = null;
  expect(await productShopEnabled()).toBe(false);
  state.data = true;
  state.error = { code: "connection_failure" };
  expect(await productShopEnabled()).toBe(false);
});
it("production cannot be enabled against loopback or insecure endpoints", () => {
  vi.stubEnv("APP_URL", "http://portal.example.invalid");
  expect(productsEnabled()).toBe(false);
  vi.stubEnv("APP_URL", "https://portal.example.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
  expect(productsEnabled()).toBe(false);
});
it("test mode remains confined to an isolated local application and database", () => {
  vi.stubEnv("APP_MODE", "test");
  expect(productsEnabled()).toBe(false);
  vi.stubEnv("APP_URL", "http://127.0.0.1:3110");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
  expect(productsEnabled()).toBe(true);
  vi.stubEnv("PRODUCT_MANAGEMENT_ENABLED", "false");
  expect(productsEnabled()).toBe(false);
});
