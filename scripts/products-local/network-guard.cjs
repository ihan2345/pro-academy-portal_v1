const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  const testStripe =
    process.env.PRODUCT_PAYMENTS_ENABLED === "true" &&
    /^(sk|rk)_test_/.test(process.env.PRODUCT_STRIPE_SECRET_KEY ?? "") &&
    url.origin === "https://api.stripe.com" &&
    url.pathname.startsWith("/v1/") &&
    headers.get("authorization") ===
      `Bearer ${process.env.PRODUCT_STRIPE_SECRET_KEY}`;
  if (!local && !testStripe)
    return Promise.reject(
      new Error("Product local test: external network blocked"),
    );
  return originalFetch(input, { ...init, redirect: "error" });
};
