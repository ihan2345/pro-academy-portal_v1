import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
const root = resolve("output/eltern-kind-lokal");
const status = JSON.parse(
  execFileSync(
    "npx",
    ["--yes", "supabase", "status", "--workdir", root, "-o", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ),
);
assert.equal(status.API_URL, "http://127.0.0.1:55321");
const accounts = JSON.parse(
  readFileSync(`${root}/accounts.private.json`, "utf8"),
);
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const check = (result) => {
  if (result.error) throw Error(result.error.message);
  return result.data;
};
const result = {};
// Real authenticated PostgREST requests exercise RLS, without mocks or service-role reads.
for (const familyKey of ["F047", "F025"]) {
  const account = accounts.accounts.find((a) => a.key === familyKey);
  const db = createClient(status.API_URL, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  check(
    await db.auth.signInWithPassword({
      email: account.email,
      password: accounts.password,
    }),
  );
  const players = check(
    await db.from("players").select("id,first_name,last_name"),
  );
  assert.deepEqual(
    players.map((p) => `${p.first_name} ${p.last_name}`).sort(),
    [...account.children].sort(),
  );
  const customers = check(
    await db.from("parent_stripe_customers").select("stripe_customer_id"),
  );
  assert.equal(customers.length, 2);
  const parent = check(await db.from("parents").select("full_name"));
  assert.equal(parent.length, 1);
  if (familyKey === "F047")
    assert.equal(parent[0].full_name, "Sevgi Karalıoğlu");
  const periods = check(await db.from("entitlement_periods").select("*"));
  if (familyKey === "F025") {
    const child = players.find((p) => p.first_name === "Menzur");
    assert(
      periods
        .filter((p) => p.player_id === child.id)
        .every((p) => p.included_units === 4),
    );
  }
  const denied = await db
    .from("players")
    .insert({ first_name: "Unauthorized", last_name: "Write" });
  assert(denied.error);
  result[familyKey] = {
    own_children_only: true,
    stripe_accounts: 2,
    unauthorized_write_rejected: true,
  };
}
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const base = "http://127.0.0.1:3107";
const external = [];
await context.route("**/*", async (route) => {
  if (
    !["127.0.0.1", "localhost"].includes(
      new URL(route.request().url()).hostname,
    )
  ) {
    external.push(route.request().url());
    return route.abort();
  }
  await route.continue();
});
let testChild;
try {
  const session = await context.request.post(`${base}/lokaler-test/session`, {
    form: { account: "admin" },
    headers: { origin: base },
  });
  assert.equal(session.status(), 200);
  await page.goto(`${base}/admin/spieler`);
  await page.getByRole("button", { name: "Neu anlegen" }).click();
  await page.getByLabel("Vorname", { exact: true }).fill("Lokaler");
  await page.getByLabel("Nachname", { exact: true }).fill("Speichertest");
  await page.getByLabel("Altersklasse", { exact: true }).fill("U10");
  assert.equal(
    await page.getByLabel("Geburtsjahr (optional)").getAttribute("required"),
    null,
  );
  const savedPromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/players") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  const saved = await savedPromise;
  assert.equal(saved.status(), 200);
  testChild = (await saved.json()).id;
  await page.reload();
  await page.getByRole("row").filter({ hasText: "Speichertest" }).waitFor();
  const stored = check(
    await service
      .from("players")
      .select("birth_year")
      .eq("id", testChild)
      .single(),
  );
  assert.equal(stored.birth_year, null);
  result.persistence = {
    created_through_ui: true,
    visible_after_reload: true,
    birth_year: null,
  };
  for (const path of [
    "stripe/portal",
    "auth/login",
    "cron",
    "admin/stripe-link",
  ]) {
    const blocked = await context.request.post(`${base}/api/${path}`, {
      data: {},
      headers: { origin: base },
    });
    assert.equal(blocked.status(), 403);
  }
  const switched = await context.request.post(`${base}/lokaler-test/session`, {
    form: { account: "F047" },
    headers: { origin: base },
  });
  assert.equal(switched.status(), 200);
  await page.goto(`${base}/konto`);
  await page.getByRole("heading", { name: "Dein Elternkonto" }).waitFor();
  const text = await page.locator("body").innerText();
  assert(
    text.includes("Kuzey Karalioglu") && text.includes("Poyraz Karalioglu"),
  );
  assert(
    !text.includes("Max Beispiel") &&
      !text.includes("DEMO · TESTDATEN") &&
      !text.includes("Geburtsjahr"),
  );
  assert.equal(
    await page.getByRole("button", { name: /Abo für .* verwalten/ }).count(),
    2,
  );
  await page.screenshot({
    path: `${root}/elternkonto-geprueft.png`,
    fullPage: true,
  });
  const denied = await context.request.get(`${base}/api/admin/parents`);
  assert.equal(denied.status(), 403);
  const malformed = await context.request.post(`${base}/lokaler-test/session`, {
    form: { account: "admin" },
    headers: { origin: "http://example.invalid" },
  });
  assert.equal(malformed.status(), 403);
  result.ui = {
    real_names: true,
    both_children: true,
    two_billing_buttons: true,
    no_demo_badge: true,
    parent_admin_access_denied: true,
    external_actions_blocked: true,
  };
  assert.equal(external.length, 0);
  const jobs = check(await service.from("notification_jobs").select("status"));
  assert.equal(jobs.length, 84);
  assert(jobs.every((j) => j.status === "held"));
  result.invitation_jobs = { count: 84, all_held: true };
  writeFileSync(`${root}/test-results.json`, JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
} finally {
  if (testChild)
    check(await service.from("players").delete().eq("id", testChild));
  await browser.close();
}
