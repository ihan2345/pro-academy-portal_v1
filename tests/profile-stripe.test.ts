import { afterEach, expect, it, vi } from "vitest";
import {
  profileReadFetch,
  profileStripeClient,
} from "../src/lib/server/profile-stripe";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("allows finance and checkout GET requests and refuses writes, other hosts and unrelated endpoints", async () => {
  const network = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", network);
  await profileReadFetch("https://api.stripe.com/v1/charges?customer=cus_one", {
    method: "GET",
  });
  await profileReadFetch("https://api.stripe.com/v1/subscriptions/sub_one", {
    method: "GET",
  });
  await profileReadFetch("https://api.stripe.com/v1/invoices/in_one/lines", {
    method: "GET",
  });
  await profileReadFetch(
    "https://api.stripe.com/v1/checkout/sessions?customer=cus_one",
    { method: "GET" },
  );
  expect(network).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ redirect: "error" }),
  );
  network.mockClear();
  for (const [url, method] of [
    ["https://api.stripe.com/v1/refunds", "POST"],
    ["https://api.stripe.com/v1/checkout/sessions", "POST"],
    ["https://api.stripe.com/v1/customers/cus_one", "DELETE"],
    ["https://api.stripe.com/v1/subscriptions", "GET"],
    ["https://example.com/v1/charges", "GET"],
  ])
    await expect(profileReadFetch(url, { method })).rejects.toThrow(
      "ausschließlich",
    );
  expect(network).not.toHaveBeenCalled();
});

it("requires development and loopback even with explicit opt-in", () => {
  vi.stubEnv("LOCAL_PROFILE_STRIPE_READ", "true");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("STRIPE_SECRET_KEY", "rk_live_fixture");
  vi.stubEnv("NODE_ENV", "production");
  expect(() => profileStripeClient()).toThrow("nur lokal");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("APP_URL", "https://portal.example.com");
  expect(() => profileStripeClient()).toThrow("nur lokal");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  expect(profileStripeClient()).toBeDefined();
});

it("keeps the existing live-key test guard without opt-in", () => {
  vi.stubEnv("LOCAL_PROFILE_STRIPE_READ", "false");
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("STRIPE_SECRET_KEY", "rk_live_fixture");
  expect(() => profileStripeClient()).toThrow("Nur Stripe-Testschlüssel");
});
