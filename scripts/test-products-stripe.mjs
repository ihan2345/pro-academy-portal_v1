// Real Stripe TEST API regression. Creates only clearly named synthetic test data.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { request } from "@playwright/test";
const root = "output/product-management-local",
  env = Object.fromEntries(
    readFileSync(`${root}/app/.env.local`, "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
if (
  env.APP_MODE !== "test" ||
  env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:57321" ||
  !/^(sk|rk)_test_/.test(env.PRODUCT_STRIPE_SECRET_KEY ?? "")
)
  throw Error("Independent local stack and explicit TEST credential required");
process.env.PRODUCT_STRIPE_SECRET_KEY = env.PRODUCT_STRIPE_SECRET_KEY;
process.env.PRODUCT_PAYMENTS_ENABLED = "true";
await import("./products-local/network-guard.cjs");
const stripe = new Stripe(env.PRODUCT_STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
  maxNetworkRetries: 1,
});
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const check = (r) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
const origin = "http://127.0.0.1:3110",
  admin = await request.newContext({ baseURL: origin }),
  parentApi = await request.newContext({ baseURL: origin });
await admin.post("/lokaler-test/session", {
  headers: { origin },
  form: { key: "admin" },
});
const api = async (client, path, method = "GET", data) => {
  const r = await client.fetch(path, {
    method,
    headers: { origin },
    ...(data === undefined ? {} : { data }),
  });
  const v = await r.json();
  if (!r.ok()) throw Error(`${path}: ${v.error ?? r.status()}`);
  return v;
};
async function until(name, fn) {
  for (let n = 0; n < 40; n++) {
    const v = await fn();
    if (v) {
      console.log("Passed:", name);
      return v;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw Error("Timed out: " + name);
}
const tag = `local-product-${Date.now()}`,
  checks = [];
let sub, account, customer;
try {
  const email = `${tag}@products.example.invalid`,
    password = randomBytes(24).toString("base64url");
  const user = check(
    await db.auth.admin.createUser({ email, password, email_confirm: true }),
  ).user;
  check(
    await db
      .from("profiles")
      .insert({ id: user.id, full_name: "Stripe-Prüffamilie", role: "parent" }),
  );
  const parent = check(
    await db
      .from("parents")
      .insert({
        auth_user_id: user.id,
        full_name: "Stripe-Prüffamilie",
        contact_email: email,
        notifications_held: true,
      })
      .select("*")
      .single(),
  );
  const child = check(
    await db
      .from("players")
      .insert({
        first_name: "Stripe",
        last_name: "Testkind",
        birth_year: 2016,
        camp_birth_date: "2016-04-15",
      })
      .select("*")
      .single(),
  );
  check(
    await db
      .from("parent_players")
      .insert({ parent_id: parent.id, player_id: child.id }),
  );
  account = {
    key: tag,
    name: "Stripe-Prüffamilie",
    role: "parent",
    email,
    password,
    user_id: user.id,
    parent_id: parent.id,
  };
  const accountsFile = `${root}/accounts.private.json`,
    accounts = JSON.parse(readFileSync(accountsFile, "utf8"));
  accounts.push(account);
  writeFileSync(accountsFile, JSON.stringify(accounts), { mode: 0o600 });
  await parentApi.post("/lokaler-test/session", {
    headers: { origin },
    form: { key: tag },
  });
  const product = await stripe.products.create({
    name: `LOKALER PRODUKTTEST ${tag}`,
    metadata: { local_product_test: tag },
  });
  if (product.livemode) throw Error("Live object blocked");
  const prices = [];
  const offers = [];
  for (const [name, amount, units] of [
    ["FirstTouch", 9900, 4],
    ["GameChanger", 15900, 8],
  ]) {
    const price = await stripe.prices.create({
      product: product.id,
      currency: "eur",
      unit_amount: amount,
      recurring: { interval: "month" },
      metadata: { local_product_test: tag },
    });
    if (price.livemode) throw Error("Live price blocked");
    prices.push(price);
    const plan = check(
      await db
        .from("plans")
        .insert({
          name,
          stripe_price_id: price.id,
          included_units: units,
          athletics_units: 0,
          generation: "current",
          billing_interval: "month",
          active: true,
          is_public: true,
        })
        .select("*")
        .single(),
    );
    const verified = await api(
      admin,
      "/api/admin/products/validate-price",
      "POST",
      { id: price.id, kind: "subscription", product_id: product.id },
    );
    const open = {
      mode: "all",
      clauses: [
        { scope: "player", mode: "any", include: ["all"], exclude: [] },
      ],
    };
    const data = {
      name: `[Stripe-Test] ${name}`,
      internal_name: tag,
      description:
        "Erfundener lokaler Regressionstest. Keine echten Zahlungen.",
      short_description: "Stripe-Testangebot für die lokale Abnahme",
      category: "Stripe-Testabnahme",
      kind: "subscription",
      status: "active",
      sort_order: 100,
      featured: false,
      publish_at: null,
      expires_at: null,
      channels: ["catalog", "parents"],
      price: verified,
      plan_id: plan.id,
      camp_offer_id: null,
      repeatable: false,
      training_content: {
        football_hours: units,
        athletics_hours: 0,
        camp_hours: null,
      },
      rules: { visibility: open, purchase: open, usage: open },
      asset_ids: [],
    };
    const saved = await api(admin, "/api/admin/products", "POST", { data });
    const impact = await api(
      admin,
      `/api/admin/products/${saved.id}/impact`,
      "POST",
      {},
    );
    await api(admin, `/api/admin/products/${saved.id}/publish`, "POST", {
      token: impact.token,
    });
    offers.push(saved.id);
  }
  customer = await stripe.customers.create({
    name: "LOKALER PRODUKTTEST Stripe-Prüffamilie",
    email,
    metadata: { local_product_test: tag },
  });
  if (customer.livemode) throw Error("Live customer blocked");
  const method = await stripe.paymentMethods.attach("pm_card_visa", {
    customer: customer.id,
  });
  check(
    await db
      .from("parent_stripe_customers")
      .insert({ parent_id: parent.id, stripe_customer_id: customer.id }),
  );
  sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: prices[0].id }],
    default_payment_method: method.id,
    payment_behavior: "error_if_incomplete",
    metadata: { local_product_test: tag },
  });
  if (sub.livemode || sub.status !== "active")
    throw Error("Expected active TEST subscription");
  const stored = check(
    await db
      .from("subscriptions")
      .upsert(
        {
          parent_id: parent.id,
          stripe_subscription_id: sub.id,
          stripe_customer_id: customer.id,
          status: sub.status,
          needs_review: false,
        },
        { onConflict: "stripe_subscription_id" },
      )
      .select("*")
      .single(),
  );
  check(
    await db.from("subscription_players").upsert(
      {
        subscription_id: stored.id,
        stripe_item_id: sub.items.data[0].id,
        player_id: child.id,
      },
      { onConflict: "subscription_id,stripe_item_id" },
    ),
  );
  await stripe.subscriptions.update(sub.id, {
    metadata: {
      local_product_test: tag,
      phase: "existing-mapped-subscription",
    },
  });
  const initial = await until(
    "externes Bestandsabo wird automatisch mit 4 Einheiten angezeigt",
    async () => {
      const p = check(
        await db
          .from("entitlement_periods")
          .select("*")
          .eq("player_id", child.id)
          .eq("status", "active"),
      );
      return p.find((x) => x.included_units === 4);
    },
  );
  checks.push("external existing subscription imported with 4 units");
  await stripe.subscriptions.update(sub.id, {
    items: [{ id: sub.items.data[0].id, price: prices[1].id }],
    payment_behavior: "pending_if_incomplete",
    proration_behavior: "always_invoice",
  });
  await until(
    "externes Upgrade erhält dieselbe Kontingent-ID und 8 Einheiten",
    async () => {
      const p = check(
        await db
          .from("entitlement_periods")
          .select("*")
          .eq("id", initial.id)
          .single(),
      );
      return p.included_units === 8 && p.stripe_price_id === prices[1].id;
    },
  );
  checks.push(
    "external upgrade preserves allowance identity and raises units to 8",
  );
  await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
  await until(
    "externe Kündigungsvormerkung wird im Elternportal angezeigt",
    async () => {
      const v = await api(parentApi, `/api/products?player=${child.id}`);
      return v.rows.some(
        (p) =>
          p.id === offers[0] && p.decision.label === "Kündigung vorgemerkt",
      );
    },
  );
  checks.push("external scheduled cancellation updates parent action");
  await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false });
  await until("externe Rücknahme der Kündigung wird übernommen", async () => {
    const v = await api(parentApi, `/api/products?player=${child.id}`);
    return v.context.children
      .find((c) => c.id === child.id)
      ?.memberships.every((m) => !m.cancel_at_period_end && !m.cancel_at);
  });
  const preview = await api(
    parentApi,
    `/api/products/${offers[0]}/change-preview`,
    "POST",
    { player_id: child.id, channel: "catalog" },
  );
  const change = await api(
    parentApi,
    `/api/products/changes/${preview.id}/confirm`,
    "POST",
    {},
  );
  if (change.status !== "scheduled") throw Error("Downgrade not scheduled");
  checks.push("local downgrade scheduled on the same Stripe subscription");
  const scheduled = await stripe.subscriptions.retrieve(sub.id);
  const scheduleId =
    typeof scheduled.schedule === "string"
      ? scheduled.schedule
      : scheduled.schedule?.id;
  if (!scheduleId) throw Error("Stripe schedule missing");
  await stripe.subscriptionSchedules.cancel(scheduleId);
  await until(
    "externe Beendigung sperrt Kontingente und schließt Wechsel",
    async () => {
      const s = check(
        await db
          .from("subscriptions")
          .select("status")
          .eq("id", stored.id)
          .single(),
      );
      const c = check(
        await db
          .from("product_change_requests")
          .select("status")
          .eq("id", preview.id)
          .single(),
      );
      const periods = check(
        await db
          .from("entitlement_periods")
          .select("status")
          .eq("player_id", child.id),
      );
      return (
        s.status === "canceled" &&
        c.status === "failed" &&
        periods.every((p) => !["active", "trialing"].includes(p.status))
      );
    },
  );
  checks.push(
    "external cancellation suspends entitlements and releases scheduled change",
  );
  await until(
    "Elternaktion wechselt nach Beendigung auf Reaktivierung",
    async () => {
      const v = await api(parentApi, `/api/products?player=${child.id}`);
      return v.rows.some(
        (p) => p.id === offers[0] && p.decision.mode === "reactivate",
      );
    },
  );
  checks.push("parent action becomes reactivate after external cancellation");
  const invoice = await stripe.invoices.retrieve(
    typeof sub.latest_invoice === "string"
      ? sub.latest_invoice
      : sub.latest_invoice.id,
  );
  let paymentIntent;
  for await (const p of stripe.invoicePayments.list({
    invoice: invoice.id,
    status: "paid",
  })) {
    if (p.payment.payment_intent) {
      paymentIntent =
        typeof p.payment.payment_intent === "string"
          ? p.payment.payment_intent
          : p.payment.payment_intent.id;
      break;
    }
  }
  if (!paymentIntent) throw Error("Test invoice payment reference missing");
  await stripe.refunds.create({
    payment_intent: paymentIntent,
    metadata: { local_product_test: tag },
  });
  await until(
    "Abo-Erstattung wird über Rechnungs-/Zahlungszuordnung erkannt",
    async () =>
      check(
        await db
          .from("product_payment_links")
          .select("status")
          .eq("payment_intent_id", paymentIntent),
      ).some((p) => p.status === "refunded"),
  );
  checks.push("subscription refund resolves invoice payment and flags review");
  mkdirSync("output/products-review", { recursive: true });
  writeFileSync(
    "output/products-review/stripe-workflow-results.json",
    JSON.stringify(
      {
        passed: true,
        testMode: true,
        tag,
        checks,
        subscription_id: sub.id,
        customer_id: customer.id,
        parent_id: parent.id,
        child_id: child.id,
        offers,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, testMode: true, checks }));
} catch (error) {
  console.error("Stripe TEST regression failed:", error.message);
  mkdirSync("output/products-review", { recursive: true });
  writeFileSync(
    "output/products-review/stripe-workflow-failure.json",
    JSON.stringify(
      {
        passed: false,
        testMode: true,
        tag,
        checks,
        subscription_id: sub?.id,
        customer_id: customer?.id,
        parent_id: account?.parent_id,
        error: error.message,
      },
      null,
      2,
    ),
  );
  if (sub) await stripe.subscriptions.cancel(sub.id).catch(() => {});
  process.exitCode = 1;
} finally {
  await admin.dispose();
  await parentApi.dispose();
}
