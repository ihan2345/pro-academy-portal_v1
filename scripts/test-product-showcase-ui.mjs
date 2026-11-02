import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const token = "a".repeat(64);
const base =
  process.env.PRODUCT_SHOWCASE_PREVIEW_ORIGIN || "http://127.0.0.1:3116";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw Error("Use a local preview only.");
mkdirSync("output/showcase-embed", { recursive: true });
const parent = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<html><body style="margin:0"><iframe title="Bühne" src="${base}/einbettung/produktbuehne/${token}" style="width:100%;height:100svh;border:0;display:block"></iframe></body></html>`,
  );
}).listen(3117, "127.0.0.1");
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let revoked = false;
    const decision = {
      visible: true,
      purchasable: true,
      usable: false,
      mode: "purchase",
      label: "Kaufen",
      reasons: [],
      audiences: ["visitor"],
      player_id: null,
    };
    const row = (n) => ({
      id: `d6000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      name: n === 1 ? "GameChanger" : "Performance",
      kind: "subscription",
      short_description: "Dein Training. Dein nächstes Level.",
      description: "Aktuelles Training",
      category: "Fußballtraining",
      price: { amount: 5900, currency: "EUR", interval: "month" },
      featured: true,
      popular: false,
      effect_color: "#8B53FE",
      asset_ids: [],
      training_content: null,
      decision,
    });
    await page.route("**/api/public/product-showcase/*", async (route) =>
      route.fulfill({
        status: revoked ? 404 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          revoked ? { error: "revoked" } : { rows: [row(1), row(2)] },
        ),
      }),
    );
    await page.goto("http://127.0.0.1:3117");
    const frame = page.frameLocator("iframe");
    await frame
      .getByRole("heading", { name: "GameChanger", exact: true })
      .waitFor();
    assert.equal(
      await frame
        .getByRole("link", { name: "Produkt ansehen" })
        .getAttribute("href"),
      "/produkte?product=d6000000-0000-4000-8000-000000000001",
    );
    assert.equal(
      await frame
        .getByRole("link", { name: "Produkt ansehen" })
        .getAttribute("target"),
      "_blank",
    );
    await frame
      .getByRole("button", { name: "Nächstes Produkt", exact: true })
      .click();
    await frame
      .getByRole("heading", { name: "Performance", exact: true })
      .waitFor();
    await frame.locator(".is-leaving").waitFor({ state: "detached" });
    assert.equal(
      await frame.getByRole("link", { name: "Zum Shop" }).getAttribute("href"),
      "/produkte",
    );
    const f = page.frames().find((f) => f.url().includes("/einbettung/"));
    const sizes = await f.evaluate(() => ({
      viewport: innerWidth,
      width: document.documentElement.scrollWidth,
      height: document
        .querySelector(".product-showcase")
        .getBoundingClientRect().height,
      windowHeight: innerHeight,
    }));
    assert(sizes.width <= sizes.viewport, JSON.stringify(sizes));
    assert(sizes.height >= sizes.windowHeight);
    await page.screenshot({
      path: `output/showcase-embed/${viewport.width}.png`,
      fullPage: true,
    });
    await page.clock.install();
    revoked = true;
    await page.clock.fastForward(31000);
    await frame.getByRole("status").waitFor();
    assert.equal(await frame.locator(".product-showcase").count(), 0);
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      sizes,
      iframe: true,
      links: true,
      carousel: true,
      revocation: true,
      errors,
    });
    await page.close();
  }
  const embed = await fetch(`${base}/einbettung/produktbuehne/${token}`);
  assert.equal(embed.headers.get("x-frame-options"), null);
  assert(
    embed.headers
      .get("content-security-policy")
      .includes("frame-ancestors https:"),
  );
  for (const path of [
    "/login",
    "/einbettung/produktbuehne/invalid",
    `/einbettung/produktbuehne/${token}/nested`,
  ]) {
    const response = await fetch(base + path, {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.headers.get("x-frame-options"), "DENY", path);
  }
  console.log(
    JSON.stringify({ passed: true, results, headers: true }, null, 2),
  );
} finally {
  await browser.close();
  parent.close();
}
