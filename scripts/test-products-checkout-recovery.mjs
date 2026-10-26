// Only opens/expires TEST checkout sessions. No payment is submitted.
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { request } from "@playwright/test";
const file = "output/product-management-local/app/.env.local",
  env = Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
if (
  env.APP_MODE !== "test" ||
  env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:57321"
)
  throw Error("Independent local stack required");
const proof = JSON.parse(
  readFileSync("output/products-review/stripe-workflow-results.json", "utf8"),
);
if (!proof.passed || !proof.testMode)
  throw Error("Successful TEST workflow fixture required");
const db = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ),
  client = await request.newContext({ baseURL: "http://127.0.0.1:3110" }),
  origin = "http://127.0.0.1:3110";
const check = (r) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
await client.post("/lokaler-test/session", {
  headers: { origin },
  form: { key: proof.tag },
});
const post = async (path, data) => {
  const r = await client.post(path, { headers: { origin }, data });
  const v = await r.json();
  if (!r.ok()) throw Error(`${path}: ${v.error ?? r.status()}`);
  return v;
};
const open = [];
try {
  const child = {
      first_name: "Checkout",
      last_name: `Prüfung ${Date.now()}`,
      birth_date: "2016-04-15",
    },
    offer = proof.offers[0];
  const first = await post(`/api/products/${offer}/checkout`, {
    request_id: randomUUID(),
    new_child: child,
    channel: "catalog",
  });
  open.push(first.id);
  if (!first.url) throw Error("No TEST checkout created");
  const second = await post(`/api/products/${offer}/checkout`, {
    request_id: randomUUID(),
    new_child: child,
    channel: "catalog",
  });
  if (first.id !== second.id || first.url !== second.url)
    throw Error("Duplicate checkout created");
  const before = check(
    await db
      .from("product_purchase_intents")
      .select("*")
      .eq("id", first.id)
      .single(),
  );
  check(
    await db
      .from("product_purchase_intents")
      .update({ session_id: null, checkout_url: null, status: "reserved" })
      .eq("id", first.id),
  );
  const recovered = await post(`/api/products/orders/${first.id}/resume`, {});
  const after = check(
    await db
      .from("product_purchase_intents")
      .select("*")
      .eq("id", first.id)
      .single(),
  );
  if (recovered.id !== first.id || after.session_id !== before.session_id)
    throw Error("Lost checkout was not recovered by its original reference");
  const cancelled = await post(`/api/products/orders/${first.id}/cancel`, {});
  if (cancelled.status !== "expired")
    throw Error("Checkout not safely expired");
  const retry = await post(`/api/products/${offer}/checkout`, {
    request_id: randomUUID(),
    new_child: child,
    channel: "catalog",
  });
  open.push(retry.id);
  if (!retry.url || retry.id === first.id)
    throw Error("New attempt after verified expiration failed");
  if (
    check(await db.from("players").select("id").eq("id", before.player_id))
      .length
  )
    throw Error("Unpaid reservation created a regular child");
  await post(`/api/products/orders/${retry.id}/cancel`, {});
  const result = {
    passed: true,
    testMode: true,
    paymentSubmitted: false,
    checks: [
      "duplicate request resumes same checkout",
      "lost remote session reference recovered",
      "verified expiration releases reservation",
      "new attempt succeeds after expiration",
      "no child or membership created before payment",
    ],
  };
  writeFileSync(
    "output/products-review/checkout-recovery-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  for (const id of open)
    await post(`/api/products/orders/${id}/cancel`, {}).catch(() => {});
  await client.dispose();
}
