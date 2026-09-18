import { afterEach, describe, expect, it, vi } from "vitest";
import { campApi } from "../src/components/camps/api-client";
import { campStripe } from "../src/lib/camps/stripe";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("Camp checkout connectivity", () => {
  it("uses fetch for Stripe requests in the production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CAMP_LOCAL_ENABLED", "false");
    vi.stubEnv("CAMP_DEPLOYMENT_ENABLED", "true");
    vi.stubEnv("CAMP_PUBLIC_ORIGIN", "https://camp.example.invalid");
    vi.stubEnv("CAMP_STRIPE_MODE", "live");
    vi.stubEnv("CAMP_LIVE_PAYMENTS_ENABLED", "true");
    vi.stubEnv("CAMP_STRIPE_SECRET_KEY", "rk_live_testonly");
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "price_check",
            object: "price",
            unit_amount: 20610,
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const price = await campStripe().prices.retrieve("price_check");
    expect(price.unit_amount).toBe(20610);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/prices/price_check",
      expect.objectContaining({
        method: "GET",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it("aborts a hanging request and restores a useful retry error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    const result = expect(campApi("book", {})).rejects.toThrow(
      "Verbindung dauert zu lange",
    );
    await vi.advanceTimersByTimeAsync(35000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("returns the checkout URL and preserves actionable server validation errors", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ url: "https://buy.stripe.com/example" }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Kind bereits gebucht" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect((await campApi("book", {})).url).toBe(
      "https://buy.stripe.com/example",
    );
    await expect(campApi("book", {})).rejects.toThrow("Kind bereits gebucht");
    expect(vi.getTimerCount()).toBe(0);
  });
});
