// Isolated component browser checks: no credentials, database, Stripe, SMTP or deployment.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const output = resolve("output/camp-option-review");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["tests/ui/camp-option-entry.tsx"],
  bundle: true,
  outfile: `${output}/app.js`,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "isolated-next-ui",
      setup(b) {
        b.onResolve({ filter: /^next\/(navigation|link|image)$/ }, (args) => ({
          path: args.path,
          namespace: "test-next",
        }));
        b.onLoad({ filter: /.*/, namespace: "test-next" }, (args) => ({
          loader: "jsx",
          resolveDir: process.cwd(),
          contents: args.path.endsWith("navigation")
            ? "export const useRouter = () => ({refresh(){},push(){},replace(){},prefetch(){}});"
            : `import React from 'react'; export default function Component({children,priority,fill,unoptimized,...props}) { return React.createElement('${args.path.endsWith("link") ? "a" : "img"}',props,children); }`,
        }));
      },
    },
  ],
});
const css = await postcss([tailwind()]).process(
  await readFile("src/app/globals.css", "utf8"),
  { from: resolve("src/app/globals.css") },
);
await writeFile(
  `${output}/app.css`,
  css.css +
    "\n" +
    (await readFile("src/components/products/products.css", "utf8")) +
    "\n" +
    (await readFile("src/components/camps/camps.css", "utf8")) +
    "\n" +
    (await readFile("src/components/camps/guest-email-entry.css", "utf8")),
);
const server = createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  if (path === "/sw.js") {
    res.writeHead(404);
    res.end();
    return;
  }
  if (path === "/brand/logo-neon.png") {
    res.setHeader("Content-Type", "image/png");
    res.end(await readFile("public/brand/logo-neon.png"));
    return;
  }
  if (path === "/app.js" || path === "/app.css") {
    res.setHeader(
      "Content-Type",
      path.endsWith("js") ? "text/javascript" : "text/css",
    );
    res.end(await readFile(`${output}${path}`));
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><html lang="de"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });

const fixture = {
  id: "90000000-0000-4000-8000-000000000001",
  revision: 3,
  booking_option_version: 2,
  member_benefits_enabled: false,
  name: "Camp Test",
  kind: "camp",
  description: "Campangebot",
  asset_ids: [],
  price: { amount: 9900, currency: "eur", interval: null },
  booking_option: {
    amount: 7900,
    title: "Tagesoption",
    description: "Nur einen Camp-Tag buchen",
    alert: "Bitte den gewünschten Tag mit unserem Team abstimmen.",
  },
  decision: {
    mode: "register",
    label: "Jetzt buchen",
    purchasable: true,
    reasons: [],
  },
};
const visitor = {
  auth_id: null,
  role: null,
  parent_id: null,
  children: [],
  grants: [],
  complete: true,
};
async function enterNewCampGuest(page, email, screenshot) {
  await expect(
    page.getByRole("button", { name: "Neu bei uns", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Bereits Kunde? Anmelden", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("Dein vollständiger Name", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("E-Mail", { exact: true }).fill(email);
  await page.getByLabel("E-Mail", { exact: true }).press("Tab");
  const prompt = page.getByRole("dialog", {
    name: "Hast du bereits ein aktives Abo bei uns?",
    exact: true,
  });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("Kauf über Stripe");
  if (screenshot) await page.screenshot({ path: screenshot });
  await page.keyboard.press("Escape");
  await expect(prompt).toHaveCount(0);
  await expect(
    page.getByLabel("Dein vollständiger Name", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(prompt).toBeVisible();
  await page
    .getByRole("button", {
      name: "Nein, ich habe kein aktives Abo",
      exact: true,
    })
    .click();
  await expect(prompt).toHaveCount(0);
}
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.log("UI error", e.message);
    });
    let profileContext = null;
    let calls = 0,
      submitted,
      saved;
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (path === "/api/camp/email-check")
        return req.postDataJSON().email === "failure@example.invalid"
          ? route.fulfill({
              status: 503,
              json: { error: "E-Mail-Prüfung nicht verfügbar" },
            })
          : route.fulfill({
              json: {
                requires_login:
                  req.postDataJSON().email === "known@example.invalid",
              },
            });
      if (path.startsWith("/api/camp/public/"))
        return route.fulfill({
          json: {
            camp: {
              id: fixture.id,
              title: fixture.name,
              location: "Testplatz",
              description: "Testcamp",
              status: "open",
              capacity: 30,
              buffer_percent: 10,
              min_age: 5,
              max_age: 18,
              days: [
                {
                  starts_at: "2027-04-01T09:00:00Z",
                  ends_at: "2027-04-01T15:00:00Z",
                },
              ],
              early_bird_until: null,
              booking_option: fixture.booking_option,
              booking_option_version: 2,
            },
            offer: {
              amount: 9900,
              currency: "eur",
              kind: "main",
              automatic_benefit: true,
            },
            occupied: 0,
            maximum: 33,
            context: profileContext ?? visitor,
          },
        });
      if (path === "/api/camp/save" || path === "/api/camp/booking-option") {
        saved = req.postDataJSON();
        return route.fulfill({
          json: { ok: true, url: "/camp/buchung/" + fixture.id },
        });
      }
      if (path === "/api/camp/book") {
        calls++;
        submitted = req.postDataJSON();
        return route.fulfill({
          status: 400,
          json: { error: "Isolierter Test: keine Zahlung ausgelöst." },
        });
      }
      if (path.endsWith("/checkout")) {
        calls++;
        submitted = req.postDataJSON();
        return route.fulfill({
          status: 400,
          json: { error: "Isolierter Test: keine Zahlung ausgelöst." },
        });
      }
      if (path === "/api/admin/products" && req.method() === "POST") {
        saved = req.postDataJSON().data;
        return route.fulfill({
          json: { id: fixture.id, revision: 1, draft: saved, published: null },
        });
      }
      const json =
        path === "/api/products"
          ? {
              rows: [fixture],
              context: profileContext ?? visitor,
              next: null,
              payments_enabled: true,
            }
          : path.endsWith("/references")
            ? { plans: [], offers: [] }
            : path.endsWith("/families")
              ? { rows: [], next: null }
              : path === "/api/admin/products"
                ? { rows: [], next: null }
                : { rows: [], next: null };
      return route.fulfill({ json });
    });
    await page.goto(base + "/produkte");
    await page
      .getByRole("button", { name: "Jetzt buchen", exact: true })
      .first()
      .click();
    await enterNewCampGuest(
      page,
      "camp@example.invalid",
      `${output}/email-entry-shop-${width}.png`,
    );
    const dialog = page.getByRole("dialog");
    const buy = page.getByRole("button", {
      name: "Weiter zur Buchung",
      exact: true,
    });
    await page
      .getByLabel("Dein vollständiger Name", { exact: true })
      .fill("Testfamilie");
    await expect(page.getByLabel("Deine E-Mail", { exact: true })).toHaveValue(
      "camp@example.invalid",
    );
    await expect(
      page.getByLabel("Deine E-Mail", { exact: true }),
    ).toHaveAttribute("readonly", "");
    await page.getByLabel("Vorname", { exact: true }).fill("Kind");
    await page.getByLabel("Nachname", { exact: true }).fill("Test");
    await page.getByLabel("Geburtsdatum", { exact: true }).fill("2016-04-15");
    await page.getByLabel("Kleidergröße", { exact: false }).fill("M");
    await buy.click();
    await expect(page.getByRole("alert")).toContainText("Isolierter Test");
    assert.equal(calls, 1);
    assert.equal(submitted.booking_option_selected, false);
    await page.getByLabel("Tagesoption", { exact: true }).check();
    await expect(
      page.getByRole("status").filter({ hasText: "Gewählter Preis" }),
    ).toContainText("79,00");
    await page
      .getByLabel("Rabattcode (optional)", { exact: false })
      .fill("START20");
    await buy.click();
    await expect(
      page.getByText(fixture.booking_option.alert, { exact: true }),
    ).toBeVisible();
    assert.equal(calls, 1);
    await page.screenshot({ path: `${output}/alert-${width}.png` });
    await page.getByRole("button", { name: "Zurück", exact: true }).click();
    await expect(page.getByLabel("Tagesoption", { exact: true })).toBeChecked();
    await buy.click();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Tagesoption", { exact: true })).toBeVisible();
    assert.equal(calls, 1);
    await buy.click();
    await page
      .getByRole("button", {
        name: "Hinweis bestätigen und weiter",
        exact: true,
      })
      .click();
    await expect(page.getByRole("alert")).toContainText("Isolierter Test");
    assert.equal(calls, 2);
    assert.equal(submitted.booking_option_selected, true);
    assert.equal(submitted.booking_option_revision, 3);
    assert.equal(submitted.booking_option_version, 2);
    assert.equal(submitted.discount_code, "START20");
    assert(
      !/Abo-Vorteil|Abo-Rabatt|Mitgliederrabatt/.test(
        await page.locator("body").innerText(),
      ),
    );
    await expect(
      page.getByRole("link", {
        name: "Mit E-Mail-Code anmelden / Zugang aktivieren",
        exact: true,
      }),
    ).toHaveAttribute("href", "/login?shop=1");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.goto(base + "/camp/settings");
    await page
      .getByRole("button", { name: "Camp bearbeiten", exact: true })
      .click();
    await expect(page.getByLabel("Campname", { exact: true })).toHaveValue(
      "Camp Test",
    );
    await expect(page.getByLabel("Ort / Adresse", { exact: true })).toHaveValue(
      "Testplatz",
    );
    await expect(page.locator('[name="day-date-0"]')).toHaveValue("2027-04-01");
    await expect(page.locator('[name="day-start-0"]')).toHaveValue("11:00");
    await expect(
      page.getByLabel("Normalpreis in €", { exact: true }),
    ).toBeDisabled();
    await page.getByLabel("Campname", { exact: true }).fill("Geändertes Camp");
    await page
      .getByLabel("Ort / Adresse", { exact: true })
      .fill("Neuer Testplatz");
    let updated,
      editAttempts = 0;
    await page.route("**/api/camp/update", async (route) => {
      updated = route.request().postDataJSON();
      editAttempts++;
      await route.fulfill(
        editAttempts === 1
          ? { status: 409, json: { error: "Zwischenzeitlich geändert" } }
          : { json: { ok: true } },
      );
    });
    await page
      .getByRole("button", { name: "Änderungen speichern", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Zwischenzeitlich geändert",
    );
    await expect(page.getByLabel("Campname", { exact: true })).toHaveValue(
      "Geändertes Camp",
    );
    await page
      .getByRole("button", { name: "Änderungen speichern", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Camp bearbeiten", exact: true }),
    ).toBeVisible();
    assert.equal(updated.id, fixture.id);
    assert.equal(updated.title, "Geändertes Camp");
    assert.equal(updated.location, "Neuer Testplatz");
    assert.equal(updated.days[0].starts_at, "2027-04-01T09:00:00Z");
    assert(updated.expected_state);
    assert.equal(updated.main_amount, undefined);
    await page.goto(base + "/admin/products");
    await page
      .getByRole("button", { name: "Produkt anlegen", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Camp", exact: true }).click();
    await expect(
      page.getByLabel("Options-Preis in Euro", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Buchungsoptionen werden zentral beim Camp", {
        exact: false,
      }),
    ).toBeVisible();
    await page.goto(base + "/camp/new");
    await expect(
      page.getByLabel("Gelten Abo-Vorteile?", { exact: false }),
    ).toHaveValue("false");
    await page
      .getByLabel("Campname", { exact: true })
      .fill("Zentrales Testcamp");
    await page
      .getByLabel("Ort / Adresse", { exact: false })
      .selectOption(fixture.id);
    await page.getByLabel("Tag 1", { exact: true }).fill("2027-04-01");
    await page.getByLabel("Buchungsoption aktivieren", { exact: true }).check();
    await page.getByLabel("Options-Preis in Euro", { exact: true }).fill("79");
    await page.getByLabel("Options-Titel", { exact: true }).fill("Tagesoption");
    await page
      .getByLabel("Options-Beschreibung", { exact: true })
      .fill("Nur einen Tag");
    await page
      .getByLabel("Options-Alert", { exact: false })
      .fill("Bitte Tag abstimmen");
    await page
      .getByRole("button", { name: "Camp speichern", exact: true })
      .click();
    await expect.poll(() => saved?.booking_option?.amount).toBe(7900);
    assert.equal(saved.booking_option.title, "Tagesoption");
    assert.equal(saved.member_benefits_enabled, false);
    await page.goto(base + "/camp/edit");
    await page.getByText("Buchungsoption bearbeiten", { exact: true }).click();
    await expect(
      page.getByLabel("Options-Preis in Euro", { exact: true }),
    ).toHaveValue("79");
    await page.getByLabel("Options-Preis in Euro", { exact: true }).fill("89");
    await expect(
      page.getByLabel("Gelten Abo-Vorteile?", { exact: false }),
    ).toHaveValue("false");
    await page
      .getByLabel("Gelten Abo-Vorteile?", { exact: false })
      .selectOption("true");
    await page
      .getByRole("button", { name: "Buchungsoption speichern", exact: true })
      .click();
    await expect.poll(() => saved?.booking_option?.amount).toBe(8900);
    assert.equal(saved.expected_version, 2);
    assert.equal(saved.member_benefits_enabled, true);
    await page.goto(base + "/camp/buchung/" + fixture.id);
    await enterNewCampGuest(
      page,
      "camp@example.invalid",
      `${output}/email-entry-direct-${width}.png`,
    );
    await page.getByLabel("Name", { exact: true }).fill("Testfamilie");
    await expect(page.getByLabel("E-Mail", { exact: true })).toHaveValue(
      "camp@example.invalid",
    );
    await page
      .getByLabel("Telefon für Rückfragen", { exact: true })
      .fill("123456");
    await page.getByLabel("Vorname", { exact: true }).fill("Kind");
    await page.getByLabel("Nachname", { exact: true }).fill("Test");
    await page.getByLabel("Geburtsdatum", { exact: true }).fill("2016-04-15");
    await page.getByLabel("Kleidergröße", { exact: false }).selectOption("140");
    assert(
      !/Abo-Vorteil|Abo-Rabatt|Mitgliederrabatt/.test(
        await page.locator("body").innerText(),
      ),
    );
    const directBuy = page.getByRole("button", {
      name: "Weiter zur Zahlung",
      exact: false,
    });
    await directBuy.click();
    await expect(page.getByRole("alert")).toContainText("Isolierter Test");
    assert.equal(submitted.booking_option_selected, false);
    await page.getByLabel("Tagesoption", { exact: true }).check();
    const before = calls;
    await directBuy.click();
    await expect(page.getByRole("dialog")).toContainText(
      fixture.booking_option.alert,
    );
    assert.equal(calls, before);
    await page.screenshot({ path: `${output}/direct-alert-${width}.png` });
    await page.getByRole("button", { name: "Zurück", exact: true }).click();
    await expect(page.getByLabel("Tagesoption", { exact: true })).toBeChecked();
    await directBuy.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await directBuy.click();
    await page
      .getByRole("button", {
        name: "Hinweis bestätigen und weiter",
        exact: true,
      })
      .click();
    await expect.poll(() => calls).toBe(before + 1);
    assert.equal(submitted.booking_option_selected, true);
    assert.equal(submitted.booking_option_version, 2);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await page.goto(base + "/camp/buchung/" + fixture.id);

    await page
      .getByLabel("E-Mail", { exact: true })
      .fill("failure@example.invalid");
    await page.getByLabel("E-Mail", { exact: true }).press("Tab");
    await expect(page.getByRole("status")).toContainText(
      "E-Mail-Prüfung nicht verfügbar",
    );
    await expect(page.getByLabel("E-Mail", { exact: true })).toHaveValue(
      "failure@example.invalid",
    );
    await page
      .getByLabel("E-Mail", { exact: true })
      .fill("KNOWN@example.invalid");
    await page.getByLabel("E-Mail", { exact: true }).press("Tab");
    await expect(page).toHaveURL(
      base + "/login?next=" + encodeURIComponent("/camp/buchung/" + fixture.id),
    );
    await expect(
      page.getByLabel("Deine E-Mail-Adresse", { exact: true }),
    ).toHaveValue("known@example.invalid");
    await page.goto(base + "/produkte");
    await page
      .getByRole("button", { name: "Jetzt buchen", exact: true })
      .first()
      .click();
    await page
      .getByLabel("E-Mail", { exact: true })
      .fill("unknown@example.invalid");
    await page.getByLabel("E-Mail", { exact: true }).press("Tab");
    await expect(
      page.getByRole("dialog", {
        name: "Hast du bereits ein aktives Abo bei uns?",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByLabel("E-Mail für erneute Prüfung", { exact: true })
      .fill("known@example.invalid");
    await expect(
      page.getByRole("button", {
        name: "Nein, ich habe kein aktives Abo",
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Andere E-Mail prüfen", exact: true })
      .click();
    await expect(page).toHaveURL(
      base +
        "/login?next=" +
        encodeURIComponent("/produkte?product=" + fixture.id),
    );
    await expect(
      page.getByLabel("Deine E-Mail-Adresse", { exact: true }),
    ).toHaveValue("known@example.invalid");
    await page.goto(base + "/camp/buchung/" + fixture.id);
    await page
      .getByLabel("E-Mail", { exact: true })
      .fill("first@example.invalid");
    await page.getByLabel("E-Mail", { exact: true }).press("Tab");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByLabel("E-Mail für erneute Prüfung", { exact: true })
      .fill("second@example.invalid");
    await expect(
      page.getByRole("button", {
        name: "Nein, ich habe kein aktives Abo",
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Andere E-Mail prüfen", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Nein, ich habe kein aktives Abo",
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByRole("button", {
        name: "Nein, ich habe kein aktives Abo",
        exact: true,
      })
      .click();
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
    await expect(page.getByLabel("E-Mail", { exact: true })).toHaveValue(
      "second@example.invalid",
    );
    await page
      .getByRole("button", { name: "Andere E-Mail verwenden", exact: true })
      .click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []);
    profileContext = {
      ...visitor,
      auth_id: "local-parent",
      role: "parent",
      parent_id: "local-family",
      parent_phone: "0123456789",
      parent: {
        full_name: "Testfamilie",
        contact_email: "known@example.invalid",
        phone: "0123456789",
      },
      children: [
        {
          id: "90000000-0000-4000-8000-000000000009",
          name: "Profil Kind",
          first_name: "Profil",
          last_name: "Kind",
          birth_date: "2016-04-15",
          camp_birth_date: "2016-04-15",
          gender: "weiblich",
          camp_gender: "männlich",
          clothing_size: "140",
          camp_clothing_size: "140",
          memberships: [],
          camp_ids: [],
          purchases: [],
          trial: false,
          former_trial: false,
        },
      ],
    };
    await page.goto(base + "/produkte");
    await page
      .getByRole("button", { name: "Jetzt buchen", exact: true })
      .first()
      .click();
    await expect(
      page.getByLabel("Telefon für Rückfragen", { exact: true }),
    ).toHaveValue("0123456789");
    await expect(
      page.getByRole("combobox", { name: "Geschlecht", exact: true }),
    ).toHaveValue("weiblich");
    await expect(page.getByLabel("Kleidergröße", { exact: false })).toHaveValue(
      "140",
    );
    await page
      .getByLabel("Telefon für Rückfragen", { exact: true })
      .fill("0987654321");
    await page
      .getByRole("button", { name: "Weiter zur Buchung", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("Isolierter Test");
    assert.equal(submitted.camp_details.phone, "0987654321");
    assert.equal(submitted.camp_details.gender, "weiblich");
    await page.goto(base + "/camp/buchung/" + fixture.id);
    await expect(
      page.getByLabel("Telefon für Rückfragen", { exact: true }),
    ).toHaveValue("0123456789");
    await page
      .getByRole("combobox", { name: "Kind auswählen", exact: true })
      .selectOption(profileContext.children[0].id);
    await expect(
      page.getByRole("combobox", { name: "Geschlecht", exact: true }),
    ).toHaveValue("weiblich");
    await expect(page.getByLabel("Kleidergröße", { exact: false })).toHaveValue(
      "140",
    );
    await page
      .getByRole("combobox", { name: "Kind auswählen", exact: true })
      .selectOption("new");
    await expect(page.getByLabel("Vorname", { exact: true })).toBeEditable();
    await expect(page.getByLabel("Vorname", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Nachname", { exact: true })).toBeEditable();
    await expect(
      page.getByLabel("Geburtsdatum", { exact: true }),
    ).toBeEditable();
    await page.getByLabel("Vorname", { exact: true }).fill("Neueskind");
    await page.getByLabel("Nachname", { exact: true }).fill("Test");
    await page.getByLabel("Geburtsdatum", { exact: true }).fill("2016-05-16");
    await page.getByLabel("Kleidergröße", { exact: false }).selectOption("152");
    await page
      .getByRole("button", { name: "Weiter zur Zahlung", exact: false })
      .click();
    await expect(page.getByRole("alert")).toContainText("Isolierter Test");
    assert.equal(submitted.new_child, true);
    assert.equal(submitted.player_id, undefined);
    assert.equal(submitted.child.first_name, "Neueskind");
    await page
      .getByRole("combobox", { name: "Kind auswählen", exact: true })
      .selectOption(profileContext.children[0].id);
    await expect(page.getByLabel("Vorname", { exact: true })).toHaveValue(
      "Profil",
    );
    await expect(
      page.getByLabel("Vorname", { exact: true }),
    ).not.toBeEditable();
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Camp booking option UI passed: ${width}px, central Camp creation/editing, product editor removal, shop/direct booking, popup confirmation, price version and discounts.`,
    );
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
