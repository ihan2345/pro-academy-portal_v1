// Local Supabase + hosted Stripe TEST Checkout + real local Auth confirmation.
// No card charge and no SMTP. A 100% code is required before submitting Checkout.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { chromium, request } from "@playwright/test";
import Stripe from "stripe";

if (process.env.PRODUCT_GUEST_LOCAL_CONFIRM !== "synthetic-stripe-test-only")
  throw Error("Explicit local TEST confirmation required");
const root = "output/product-management-local";
const env = parseEnv(readFileSync(`${root}/app/.env.local`, "utf8"));
const origin = "http://127.0.0.1:3110";
if (
  env.APP_MODE !== "test" ||
  env.APP_URL !== origin ||
  env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:57321" ||
  env.MAIL_PROVIDER !== "capture" ||
  env.EMAIL_TEST_MODE !== "true" ||
  !/^(sk|rk)_test_/.test(env.PRODUCT_STRIPE_SECRET_KEY ?? "")
)
  throw Error(
    "Independent local Auth/database, mail capture and TEST key required",
  );
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const stripe = new Stripe(env.PRODUCT_STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
  maxNetworkRetries: 1,
});
const checked = (r) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
async function until(name, fn) {
  for (let n = 0; n < 45; n++) {
    const result = await fn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw Error(`Timed out: ${name}`);
}
const admin = await request.newContext({ baseURL: origin });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: origin });
const outsider = await request.newContext({ baseURL: origin });
const api = async (client, path, data) => {
  const r = await client.post(path, { headers: { origin }, data });
  const body = await r.json();
  if (!r.ok()) throw Error(`${path}: ${body.error ?? r.status()}`);
  return body;
};
const run = Date.now().toString(36);
const email = `guest-${run}@products.example.invalid`;
const results = [];
let product, price, coupon, promo, offer, order, customer;
try {
  const login = await admin.post("/lokaler-test/session", {
    headers: { origin },
    form: { key: "admin" },
  });
  assert.equal(login.ok(), true);
  product = await stripe.products.create({
    name: `TEST Gastkauf lokal ${run}`,
    metadata: { synthetic_guest_local: run },
  });
  assert.equal(product.livemode, false);
  price = await stripe.prices.create({
    product: product.id,
    unit_amount: 9900,
    currency: "eur",
  });
  coupon = await stripe.coupons.create({
    percent_off: 100,
    duration: "once",
    applies_to: { products: [product.id] },
  });
  promo = await stripe.promotionCodes.create({
    coupon: coupon.id,
    code: `PALO${run}`,
  });
  const verified = await api(admin, "/api/admin/products/validate-price", {
    id: price.id,
    kind: "other",
    product_id: product.id,
  });
  const open = {
    mode: "all",
    clauses: [{ scope: "player", mode: "any", include: ["all"], exclude: [] }],
  };
  const data = {
    name: `[Gastkauf-Test] ${run}`,
    internal_name: `synthetic-guest-local-${run}`,
    description:
      "Ausschließlich synthetischer lokaler Gastkauf ohne Abbuchung.",
    short_description: "Lokaler Gastkauf mit Bestätigung nach Stripe-Abschluss",
    category: "Lokale Testabnahme",
    kind: "other",
    status: "active",
    sort_order: 999,
    featured: false,
    publish_at: null,
    expires_at: null,
    channels: ["catalog"],
    price: verified,
    plan_id: null,
    camp_offer_id: null,
    repeatable: false,
    training_content: {
      football_hours: null,
      athletics_hours: null,
      camp_hours: null,
    },
    rules: { visibility: open, purchase: open, usage: open },
    asset_ids: [],
  };
  offer = await api(admin, "/api/admin/products", { data });
  const impact = await api(admin, `/api/admin/products/${offer.id}/impact`, {});
  await api(admin, `/api/admin/products/${offer.id}/publish`, {
    token: impact.token,
  });
  order = await api(context.request, `/api/products/${offer.id}/checkout`, {
    request_id: randomUUID(),
    guest_parent: { full_name: "Synthetische Gastfamilie", email },
    new_child: {
      first_name: "Gastkind",
      last_name: run,
      birth_date: "2016-04-15",
    },
    discount_code: promo.code,
    channel: "catalog",
  });
  const before = checked(
    await db
      .from("product_purchase_intents")
      .select("*")
      .eq("id", order.id)
      .single(),
  );
  customer = before.customer_id;
  assert.equal(before.parent_id, null);
  assert.equal(before.auth_id, null);
  assert.equal(before.expected_amount, 0);
  assert.equal(before.discount.promotion_id, promo.id);
  assert.equal(
    checked(await db.from("parents").select("id").eq("contact_email", email))
      .length,
    0,
  );
  assert.equal(
    checked(await db.from("players").select("id").eq("id", before.player_id))
      .length,
    0,
  );
  const unauthorised = await outsider.get(
    `/api/products/purchases/${order.id}`,
  );
  assert.equal(unauthorised.status(), 404);
  results.push(
    "guest reservation has no parent, player or auth identity; browser access isolated",
  );
  const checkout = await stripe.checkout.sessions.retrieve(before.session_id);
  assert.equal(checkout.livemode, false);
  assert.equal(checkout.amount_total, 0);
  assert.equal(checkout.amount_subtotal, 9900);
  const page = await context.newPage();
  await page.goto(order.url);
  await page
    .getByRole("button", { name: /Bestell|Pay|Bezahl|Abschlie|Complete/i })
    .last()
    .waitFor({ timeout: 45000 });
  // Only submit the already verified zero-total TEST Session.
  await page
    .getByRole("button", { name: /Bestell|Pay|Bezahl|Abschlie|Complete/i })
    .last()
    .click();
  await page.waitForURL(`${origin}/produkte**`, { timeout: 60000 });
  const paid = await until("verified zero-cost fulfillment", async () => {
    await api(
      context.request,
      `/api/products/purchases/${order.id}/reconcile`,
      {},
    );
    const i = checked(
      await db
        .from("product_purchase_intents")
        .select("*")
        .eq("id", order.id)
        .single(),
    );
    if (i.status === "review")
      throw Error(`Order needs review: ${i.last_error}`);
    return i.status === "fulfilled" ? i : null;
  });
  assert.equal(paid.proof.payment_status, "paid");
  assert.equal(paid.auth_id, null);
  const parent = checked(
    await db.from("parents").select("*").eq("id", paid.parent_id).single(),
  );
  assert.equal(parent.auth_user_id, null);
  assert.equal(parent.notifications_held, true);
  const links = checked(
    await db
      .from("parent_players")
      .select("*")
      .eq("parent_id", paid.parent_id)
      .eq("player_id", paid.player_id),
  );
  assert.equal(links.length, 1);
  results.push(
    "real hosted Stripe TEST Checkout completed without card charge; family created only afterward",
  );
  const captured = await until(
    "private receipt and access-link capture",
    async () => {
      try {
        const file = readdirSync(`${root}/guest-mail`).find((f) =>
          f.includes(order.id),
        );
        return file
          ? JSON.parse(readFileSync(`${root}/guest-mail/${file}`, "utf8"))
          : null;
      } catch {
        return null;
      }
    },
  );
  const access = captured.text.match(
    /http:\/\/127\.0\.0\.1:3110\/auth\/product\?[^\s]+/,
  )?.[0];
  assert.ok(access, "real local Auth confirmation URL is present");
  results.push("transactional receipt captured locally without SMTP");
  // Confirmation works in another browser: no dependence on the purchase cookie.
  const confirming = await browser.newContext({ baseURL: origin });
  try {
    const confirmation = await confirming.newPage();
    await confirmation.goto(access);
    await confirmation.waitForURL(`${origin}/produkte?account=confirmed`, {
      timeout: 45000,
    });
    const claimed = checked(
      await db.from("parents").select("*").eq("id", paid.parent_id).single(),
    );
    assert.ok(claimed.auth_user_id);
    const user = checked(
      await db.auth.admin.getUserById(claimed.auth_user_id),
    ).user;
    assert.equal(user.email, email);
    assert.ok(user.email_confirmed_at);
    const profile = checked(
      await db.from("profiles").select("*").eq("id", user.id).single(),
    );
    assert.equal(profile.role, "parent");
    assert.equal(
      checked(
        await db
          .from("parent_players")
          .select("*")
          .eq("parent_id", paid.parent_id)
          .eq("player_id", paid.player_id),
      ).length,
      1,
    );
    const catalog = await confirming.request.get("/api/products");
    assert.equal(catalog.status(), 200);
    assert.equal((await catalog.json()).context.role, "parent");
    results.push(
      "real local Auth confirmation assigns the same parent and child exactly once across browsers",
    );
  } finally {
    await confirming.close();
  }
} finally {
  if (order) {
    const i = checked(
      await db
        .from("product_purchase_intents")
        .select("session_id")
        .eq("id", order.id)
        .single(),
    );
    if (i.session_id)
      await stripe.checkout.sessions.expire(i.session_id).catch(() => {});
  }
  if (promo) await stripe.promotionCodes.update(promo.id, { active: false });
  if (coupon) await stripe.coupons.del(coupon.id);
  if (price) await stripe.prices.update(price.id, { active: false });
  if (customer) await stripe.customers.del(customer);
  if (product) await stripe.products.update(product.id, { active: false });
  if (offer)
    checked(
      await db
        .from("catalog_products")
        .update({ status: "archived", published: null })
        .eq("id", offer.id),
    );
  await context.close();
  await browser.close();
  await admin.dispose();
  await outsider.dispose();
  mkdirSync("output/product-guest-local", { recursive: true });
  writeFileSync(
    "output/product-guest-local/results.json",
    JSON.stringify(
      {
        passed: results.length === 4,
        at: new Date().toISOString(),
        run,
        results,
        stripe_test_only: true,
        charged: false,
        smtp: false,
        remote_cleanup: true,
      },
      null,
      2,
    ),
  );
}
console.log(
  JSON.stringify({
    passed: true,
    results,
    stripe_test_only: true,
    charged: false,
    smtp: false,
  }),
);
