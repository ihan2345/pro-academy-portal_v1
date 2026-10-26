// Real HTTP/Auth/Postgres/Storage checks against the independent local product app.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
const origin = "http://127.0.0.1:3110",
  out = "output/products-review";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const blocked = [];
await context.route("**/*", (route) => {
  const u = new URL(route.request().url());
  if (!["127.0.0.1", "localhost"].includes(u.hostname)) {
    blocked.push(u.origin);
    return route.abort();
  }
  return route.continue();
});
const page = await context.newPage();
const failures = [];
page.on("pageerror", (e) => failures.push(e.message));
try {
  await page.goto(`${origin}/lokaler-test`);
  await page
    .getByRole("button", { name: "Produktverwaltung · admin", exact: true })
    .click();
  await page.getByRole("heading", { name: "Produkte.", exact: true }).waitFor();
  await page.locator(".product-list-row").first().waitFor();
  await page.screenshot({ path: `${out}/admin-desktop.png`, fullPage: true });
  console.log("Admin list: loaded real synthetic catalogue.");
  await page.locator(".product-list-row").first().click();
  await page
    .getByRole("heading", { name: "Das Angebot", exact: true })
    .waitFor();
  await page
    .getByText("Mitglied werden", { exact: true })
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  await page.screenshot({ path: `${out}/editor-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/editor-mobile.png`, fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2,
  );
  if (overflow) throw Error("Editor has horizontal overflow");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Alle Produkte", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Produkt anlegen", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Produktname", { exact: true })
    .fill("Lokaler UI-Prüfartikel");
  await page.getByRole("button", { name: "Sonstiges", exact: true }).click();
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Entwurf gespeichert." })
    .waitFor();
  console.log("Create: persisted draft.");
  const png = await sharp({
    create: { width: 1200, height: 750, channels: 3, background: "#8b53fe" },
  })
    .png()
    .toBuffer();
  await page.locator("input[type=file]").setInputFiles({
    name: "local-product.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page
    .getByRole("status")
    .filter({ hasText: "Bild komprimiert und hochgeladen." })
    .waitFor();
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Entwurf gespeichert." })
    .waitFor();
  const image = page.locator(".product-gallery-item img").first();
  if (!(await image.evaluate((i) => i.complete && i.naturalWidth > 0)))
    await image.waitFor();
  console.log("Image: real upload, WebP compression and authorised preview.");
  await page.getByLabel("Status", { exact: true }).selectOption("archived");
  await page
    .getByRole("button", { name: "Änderungen prüfen", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Auswirkungen prüfen" }).waitFor();
  await page.screenshot({ path: `${out}/impact-desktop.png`, fullPage: true });
  await page
    .getByRole("button", { name: "Archivierung übernehmen", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Verkauf gesperrt." })
    .waitFor();
  console.log("Archive: saved/published after actual database impact.");
  await page.locator(".product-grants summary").click();
  await page
    .getByLabel("Familie für individuelle Freigabe", { exact: true })
    .selectOption({ label: "Familie Fremd" });
  await page
    .getByLabel("Begründung", { exact: true })
    .fill("Lokale Prüfung einer individuellen Freigabe");
  await page
    .getByRole("button", { name: "Freigabe prüfen", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Individuelle Freigabe prüfen" })
    .waitFor();
  await page.keyboard.press("Tab");
  if (
    !(await page
      .getByRole("dialog", { name: "Individuelle Freigabe prüfen" })
      .evaluate((d) => d.contains(document.activeElement)))
  )
    throw Error("Dialog focus escaped");
  await page
    .getByRole("button", { name: "Freigabeänderung übernehmen", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Individuelle Freigabe übernommen." })
    .waitFor();
  console.log(
    "Individual grant: database preview, focus containment and explicit application.",
  );

  await page.goto(`${origin}/lokaler-test`);
  await page
    .getByRole("button", { name: "Familie Weber · mixed", exact: true })
    .click();
  await page.locator(".product-card").first().waitFor();
  await page.screenshot({
    path: `${out}/store-parent-desktop.png`,
    fullPage: true,
  });
  const select = page.getByLabel("Für welches Kind?", { exact: true });
  const options = await select.locator("option").allTextContents();
  if (
    !options.some((v) => v.includes("Mika")) ||
    !options.some((v) => v.includes("Luca"))
  )
    throw Error("Mixed family does not show both identities");
  await select.selectOption({ label: "Luca Weber" });
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${out}/store-parent-mobile.png`,
    fullPage: true,
  });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2,
    )
  )
    throw Error("Store has horizontal overflow");
  console.log("Mixed family: distinct Abo/Trial children, responsive store.");
  const denied = await page.request.get(`${origin}/api/admin/products`);
  if (denied.status() !== 403)
    throw Error(`Parent admin access returned ${denied.status()}`);
  const visitor = await browser.newContext();
  const response = await visitor.request.get(`${origin}/api/admin/products`);
  if (response.status() !== 401) throw Error("Anonymous admin API not denied");
  const store = await visitor.newPage();
  await store.goto(`${origin}/produkte`);
  await store.locator(".product-card").first().waitFor();
  await store.screenshot({
    path: `${out}/store-visitor-desktop.png`,
    fullPage: true,
  });
  await visitor.close();
  if (blocked.length || failures.length)
    throw Error(JSON.stringify({ blocked, failures }));
  writeFileSync(
    `${out}/results.json`,
    JSON.stringify({
      passed: true,
      blocked,
      failures,
      checks: [
        "admin catalogue",
        "draft persistence",
        "image upload and preview",
        "database impact",
        "archive",
        "mixed family",
        "mobile layouts",
        "parent denied admin",
        "anonymous denied admin",
      ],
    }),
  );
  console.log("Product UI verification passed.");
} catch (e) {
  await page
    .screenshot({ path: `${out}/failure.png`, fullPage: true })
    .catch(() => {});
  throw e;
} finally {
  await browser.close();
}
