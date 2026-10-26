import { readFileSync } from "node:fs";
import vm from "node:vm";
import { it, expect, vi } from "vitest";
function guard(enabled = true) {
  const fetch = vi.fn(async (_input?: unknown, _init?: unknown) => ({
    ok: true,
  }));
  const globals = { fetch };
  vm.runInNewContext(
    readFileSync("scripts/products-local/network-guard.cjs", "utf8"),
    {
      globalThis: globals,
      process: {
        env: {
          PRODUCT_PAYMENTS_ENABLED: String(enabled),
          PRODUCT_STRIPE_SECRET_KEY: "sk_test_local",
        },
      },
      Headers,
      Request,
      URL,
      Promise,
      Error,
    },
  );
  return { fetch, guard: globals.fetch };
}
it("allows the local Supabase API and forces redirects to stay disabled", async () => {
  const v = guard();
  await v.guard("http://127.0.0.1:57321/rest/v1/parents", {
    redirect: "follow",
  });
  expect(v.fetch).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ redirect: "error" }),
  );
});
it("blocks production databases and unrelated external services", async () => {
  const v = guard();
  await expect(
    v.guard("https://production.supabase.co/rest/v1/parents"),
  ).rejects.toThrow(/blocked/);
  expect(v.fetch).not.toHaveBeenCalled();
});
it("permits only the explicitly configured Stripe test credential", async () => {
  const v = guard();
  await v.guard("https://api.stripe.com/v1/prices/price_test", {
    headers: { Authorization: "Bearer sk_test_local" },
  });
  expect(v.fetch).toHaveBeenCalledOnce();
});
it("blocks inherited live credentials even while test Stripe access is enabled", async () => {
  const v = guard();
  await expect(
    v.guard("https://api.stripe.com/v1/customers", {
      headers: { Authorization: "Bearer sk_live_forbidden" },
    }),
  ).rejects.toThrow(/blocked/);
  expect(v.fetch).not.toHaveBeenCalled();
});
it("blocks all Stripe networking in offline mode", async () => {
  const v = guard(false);
  await expect(
    v.guard("https://api.stripe.com/v1/prices/price_test", {
      headers: { Authorization: "Bearer sk_test_local" },
    }),
  ).rejects.toThrow(/blocked/);
});
