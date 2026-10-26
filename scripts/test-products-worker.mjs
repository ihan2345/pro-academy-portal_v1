// Exercise actual Cloudflare SSR and API guards before deployment.
import assert from "node:assert/strict";
const origin = process.env.PRODUCTS_PREVIEW_ORIGIN || "http://127.0.0.1:3112";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Use a local Wrangler preview, never live payment requests.");
const results = [];
for (const [path, expected] of [
  ["/login", 200],
  ["/admin/produkte", 307],
  ["/api/admin/products", 401],
  ["/api/platform/features", 401],
  ["/produkte", 404],
  ["/api/products", 404],
]) {
  const r = await fetch(origin + path, { redirect: "manual" });
  assert.equal(r.status, expected, path);
  if (path === "/login") {
    const html = await r.text();
    const assets = [
      ...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g),
    ].map((m) => new URL(m[1], origin).pathname);
    assert(assets.length > 0, "SSR must return application assets");
    for (const asset of new Set(assets))
      assert.equal((await fetch(origin + asset)).status, 200, asset);
  }
  results.push({ path, status: r.status });
}
assert.equal((await fetch(origin + "/Produkte")).status, 404);
const webhook = await fetch(origin + "/api/products/webhook", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "stripe-signature": "t=1,v1=invalid",
  },
  body: "{}",
});
assert.equal(webhook.status, 400, "Unsigned webhook must be refused");
console.log(
  JSON.stringify({
    cloudflare_runtime_smoke: "passed",
    results,
    unsigned_webhook: webhook.status,
  }),
);
