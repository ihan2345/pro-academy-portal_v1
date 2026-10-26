import { chromium, request } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
const origin = "http://127.0.0.1:3110",
  out = "output/products-review";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await context.route("**/*", (r) =>
  ["127.0.0.1", "localhost"].includes(new URL(r.request().url()).hostname)
    ? r.continue()
    : r.abort(),
);
const name = `Lokale Stundenprüfung ${Date.now()}`;
try {
  await page.goto(`${origin}/lokaler-test`);
  await page
    .getByRole("button", { name: "Produktverwaltung · admin", exact: true })
    .click();
  await page.getByRole("heading", { name: "Produkte.", exact: true }).waitFor();
  await page
    .getByText("Bestellungen, Tarifwechsel & Zahlungsbetrieb", { exact: true })
    .click();
  await page.getByText(/Automatischer Ereignisabruf: aktiv/).waitFor();
  await page.screenshot({
    path: `${out}/workflow-status-desktop.png`,
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Tarife & Trainingseinheiten verwalten →" })
    .click();
  await page
    .getByRole("heading", { name: "Produkte & Preise.", exact: true })
    .waitFor();
  await page.getByRole("table").waitFor();
  await page.screenshot({ path: `${out}/plans-desktop.png`, fullPage: true });
  await page
    .getByRole("link", { name: "← Zum Verkaufskatalog", exact: true })
    .click();
  await page.locator(".product-list-row").first().waitFor();
  await page
    .getByRole("button", { name: "Produkt anlegen", exact: true })
    .first()
    .click();
  await page.getByLabel("Produktname", { exact: true }).fill(name);
  await page
    .getByLabel("Fußball-Zeitstunden pro Monat", { exact: true })
    .fill("6");
  await page
    .getByLabel("Zusätzliche Athletik-Zeitstunden pro Monat", { exact: true })
    .fill("2");
  if (await page.getByText("Produktnutzung", { exact: true }).count())
    throw Error("Abo exposes an ineffective usage rule");
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Entwurf gespeichert." })
    .waitFor();
  const response = await page.request.get(
    `${origin}/api/admin/products?q=${encodeURIComponent(name)}`,
  );
  const data = await response.json();
  const stored = data.rows.find((r) => r.name === name);
  if (
    stored?.draft.training_content.football_hours !== 6 ||
    stored?.draft.training_content.athletics_hours !== 2
  )
    throw Error("Subscription time-hour fields were not persisted");
  await page.screenshot({
    path: `${out}/subscription-hours-desktop.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Camp", exact: true }).click();
  await page
    .getByLabel("Gesamttrainingsstunden im Camp", { exact: true })
    .fill("12");
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Entwurf gespeichert." })
    .waitFor();
  const r = await page.request.get(`${origin}/api/admin/products/${stored.id}`);
  if ((await r.json()).draft.training_content.camp_hours !== 12)
    throw Error("Camp hours were not persisted");
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 2,
    )
  )
    throw Error("Mobile workflow overflows");
  await page.screenshot({
    path: `${out}/camp-hours-mobile.png`,
    fullPage: true,
  });
  if (errors.length) throw Error(errors.join("; "));
  writeFileSync(
    `${out}/workflow-ui-results.json`,
    JSON.stringify(
      {
        passed: true,
        checks: [
          "worker status visible",
          "old plan management reachable",
          "football and athletics time hours persist",
          "camp total time hours persist",
          "no ineffective subscription usage rules",
          "mobile layout",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "Product workflow UI passed: processing status, plans, Abo/Camp hours, usage-rule scope and mobile layout.",
  );
} catch (e) {
  await page.screenshot({
    path: `${out}/workflow-ui-failure.png`,
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
}
