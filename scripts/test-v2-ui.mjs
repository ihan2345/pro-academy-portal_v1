// Isolated component browser checks: no credentials, database, Stripe, SMTP or deployment.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const output = resolve("output/v2-review");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["tests/ui/v2-entry.tsx"],
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
await writeFile(`${output}/app.css`, css.css);
const server = createServer(async (req, res) => {
  const path = req.url.split("?")[0];
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
try {
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 1100 }],
    ["tablet", { width: 820, height: 1180 }],
    ["mobile", { width: 390, height: 844 }],
    ["small-mobile", { width: 320, height: 740 }],
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const customers = Array.from({ length: 27 }, (_, i) => ({
      id: `cus_${String(i).padStart(2, "0")}`,
      name: `Familie ${String(i).padStart(2, "0")}`,
      email: `family${i}@example.invalid`,
      first_seen_at: new Date(Date.now() - i * 86400000).toISOString(),
      assigned: i >= 23,
      has_active_subscription: i % 2 === 0,
    }));
    const stripeOrder = [...customers]
      .reverse()
      .map((c) => ({ id: c.id, created: 1760000000 }));
    const syncCalls = [];
    const snapshot = {
      player_name: "Max Beispiel",
      product_name: "GameChanger",
      starts_at: "2026-08-11T22:00:00Z",
      ends_at: "2026-09-11T22:00:00Z",
      included_units: 8,
      completed: 1,
      minutes: 90,
      created_at: new Date().toISOString(),
      version: 1,
      attendance_policy: "charged_absences_v1",
      whatsapp: "491234",
      events: [
        {
          id: "regular",
          title: "Techniktraining",
          starts_at: "2026-09-01T14:00:00Z",
          ends_at: "2026-09-01T15:30:00Z",
          status: "attended_manual",
        },
      ],
    };
    let saved;
    let sentCard;
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== base) {
        await route.abort();
        return;
      }
      if (!url.pathname.startsWith("/api/")) {
        await route.continue();
        return;
      }
      let json = { rows: [] };
      if (url.pathname.endsWith("stripe-customers-sync")) {
        const body = route.request().postDataJSON();
        syncCalls.push(body.after ?? null);
        json = {
          count: body.after ? 7 : 20,
          next_cursor: body.after ? null : "cus_07",
          customers: body.after
            ? stripeOrder.slice(20)
            : stripeOrder.slice(0, 20),
        };
      } else if (url.pathname.endsWith("stripe-customers"))
        json = { rows: customers };
      else if (url.pathname.endsWith("stripe-customer-detail"))
        json = {
          ...customers.find((c) => c.id === url.searchParams.get("id")),
          family_matches: [],
          subscriptions: [],
        };
      else if (
        url.pathname.endsWith("players") &&
        route.request().method() === "POST"
      )
        json = { ok: true, id: "new-child" };
      else if (url.pathname.endsWith("stamp-card-send")) {
        sentCard = route.request().postDataJSON();
        json = { ok: true, message: "Stempelkarte per E-Mail versendet." };
      } else if (url.pathname.endsWith("stamp-card"))
        json = {
          snapshot,
          recipients: [],
          testRecipient: "own@example.invalid",
          privateNotes: saved ? { bf: saved.internal_note } : {},
        };
      else if (url.pathname.endsWith("backfills")) {
        saved = route.request().postDataJSON();
        snapshot.events.push({
          id: "bf",
          title: "Nachgetragen",
          event_type: saved.event_type,
          status: "attended_manual",
          starts_at: snapshot.created_at,
          ends_at: snapshot.created_at,
          retrospective: true,
          duration_minutes: saved.duration_minutes,
          parent_note: saved.parent_note,
          occurred_on: saved.occurred_on,
        });
        json = { ok: true, id: "bf" };
      }
      await route.fulfill({ json });
    });
    await page.goto(base);
    await page
      .getByRole("button", { name: "Kunden laden", exact: true })
      .click();
    await page
      .getByText("Bestand vollständig geladen.", { exact: false })
      .waitFor();
    assert.deepEqual(syncCalls, [null, "cus_07"]);
    await page
      .getByRole("button", { name: "Noch nicht zugeordnet", exact: true })
      .click();
    await expect(page.locator(".account-row:visible")).toHaveCount(10);
    await page.screenshot({
      path: `${output}/stripe-default-${name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "10 weitere anzeigen" }).click();
    assert.equal(await page.locator(".account-row:visible").count(), 20);
    await page.getByRole("button", { name: "10 weitere anzeigen" }).click();
    assert.equal(await page.locator(".account-row:visible").count(), 23);
    assert.equal(
      new Set(await page.locator(".account-row:visible b").allTextContents())
        .size,
      23,
    );
    assert.deepEqual(
      await page.locator(".account-row:visible b").allTextContents(),
      customers
        .slice(0, 23)
        .reverse()
        .map((c) => c.name),
    );
    const activeFilter = page.getByRole("button", {
      name: "Aktive Abos",
      exact: true,
    });
    await activeFilter.click();
    await expect(activeFilter).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".account-row:visible")).toHaveCount(10);
    await expect(
      page.getByText("Noch nicht zugeordnet · 12", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `${output}/stripe-active-${name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "10 weitere anzeigen" }).click();
    await expect(page.locator(".account-row:visible")).toHaveCount(12);
    assert.deepEqual(
      await page.locator(".account-row:visible b").allTextContents(),
      customers
        .slice(0, 23)
        .filter((c) => c.has_active_subscription)
        .reverse()
        .map((c) => c.name),
    );
    await page.getByRole("searchbox").fill("Familie 21");
    await expect(page.locator(".account-row:visible")).toHaveCount(0);
    await page.getByRole("searchbox").fill("Familie 20");
    await expect(page.locator(".account-row:visible")).toHaveCount(1);
    await page.getByRole("searchbox").fill("");
    await page
      .getByRole("button", { name: "Bereits zugeordnet", exact: true })
      .click();
    await expect(page.locator(".account-row:visible")).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "Zugeordnet", exact: true }),
    ).toHaveCount(2);
    await page
      .getByRole("button", { name: "Noch nicht zugeordnet", exact: true })
      .click();
    await activeFilter.click();
    await expect(activeFilter).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByText("Noch nicht zugeordnet · 23", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Im Portal hinzugefügt/ }).click();
    assert.equal(
      await page.locator(".account-row:visible b").first().textContent(),
      "Familie 00",
    );
    await expect(page.locator(".account-row:visible")).toHaveCount(10);
    await page.getByRole("button", { name: /Im Portal hinzugefügt/ }).click();
    assert.equal(
      await page.locator(".account-row:visible b").first().textContent(),
      "Familie 22",
    );
    await page
      .getByRole("button", { name: "Stripe-Reihenfolge", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Stripe-Reihenfolge", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("button", { name: "Name A–Z", exact: true }).click();
    assert.equal(
      await page.locator(".account-row:visible b").first().textContent(),
      "Familie 00",
    );
    await page.getByRole("button", { name: "Name A–Z", exact: true }).click();
    assert.equal(
      await page.locator(".account-row:visible b").first().textContent(),
      "Familie 22",
    );
    await page.getByRole("searchbox").fill("Familie 21");
    assert.equal(await page.locator(".account-row:visible").count(), 1);
    await page.getByRole("button", { name: "Zuordnen", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    assert.equal(
      await page
        .getByLabel("Name des Elternteils", { exact: true })
        .inputValue(),
      "Familie 21",
    );
    await page
      .getByLabel("Stripe-Abonnement-ID", { exact: true })
      .fill("sub_keep");
    await page
      .getByRole("button", { name: "Neues Kind anlegen", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Kind anlegen", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.getByLabel("Vorname", { exact: true }).fill("Neues");
    await page.getByLabel("Nachname", { exact: true }).fill("Kind");
    await page.getByLabel("Altersklasse", { exact: true }).fill("U12");
    await page
      .getByRole("button", { name: "Kind speichern", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Kind", exact: true }),
    ).toHaveValue("new-child");
    await expect(
      page.getByLabel("Stripe-Abonnement-ID", { exact: true }),
    ).toHaveValue("sub_keep");
    await page.getByRole("button", { name: "Dialog schließen" }).click();
    await page.getByRole("searchbox").fill("");
    await page
      .getByRole("button", { name: "Bereits zugeordnet", exact: true })
      .click();
    await expect(page.locator(".account-row:visible")).toHaveCount(4);
    await page.getByLabel("In den letzten 14 Tagen erstmals erfasst").check();
    assert.equal(await page.locator(".account-row:visible").count(), 0);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `${output}/stripe-${name}.png`,
      fullPage: true,
    });
    await page.goto(`${base}/?view=cards`);
    await page
      .getByLabel("E-Mail-Adresse", { exact: true })
      .fill("manual@example.com");
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Per E-Mail senden", exact: true })
      .click();
    await expect(
      page.getByText("Stempelkarte per E-Mail versendet.", { exact: true }),
    ).toBeVisible();
    assert.equal(sentCard.email, "manual@example.com");
    assert.equal(sentCard.parent_id, undefined);
    await page
      .getByRole("button", { name: "Einheit 2 nachtragen", exact: true })
      .click();
    await page.getByLabel("Trainingsstunden (Pflichtfeld)").fill("1.5");
    await page
      .getByLabel("Elternnotiz (Pflichtfeld)")
      .fill("Die Einheit vom letzten Monat wurde nachgeholt. Vielen Dank!");
    await page
      .getByLabel("Interne Notiz (optional)")
      .fill("INTERN: Rücksprache mit Coach");
    await page.screenshot({
      path: `${output}/backfill-form-${name}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Eine Einheit nachtragen", exact: true })
      .click();
    await page.locator(".stamp.retrospective").waitFor();
    assert.equal(saved.duration_minutes, 90);
    assert.equal(saved.notify_parents, false);
    assert.equal(
      await page.locator(".stamp.retrospective").textContent(),
      "OK",
    );
    assert.equal(
      await page
        .locator(".backfill-notes")
        .getByText(
          "Die Einheit vom letzten Monat wurde nachgeholt. Vielen Dank!",
          { exact: true },
        )
        .count(),
      1,
    );
    await page.getByText("Interne Notiz", { exact: true }).click();
    await page
      .getByText("INTERN: Rücksprache mit Coach", { exact: true })
      .waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: `${output}/stamp-card-${name}.png`,
      fullPage: true,
    });
    await page.close();
    console.log(
      `${name}: complete customer pagination, sorting, search, assignment filters, child popup, direct email, backfill form and stamp passed`,
    );
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
