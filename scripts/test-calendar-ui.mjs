// Isolated component browser checks: no credentials, database, Stripe, SMTP or deployment.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const output = resolve("output/calendar-review");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["tests/ui/calendar-entry.tsx"],
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
try {
  for (const [name, viewport, wide] of [
    ["desktop", { width: 1440, height: 1050 }, true],
    ["tablet-landscape", { width: 1180, height: 820 }, true],
    ["tablet-portrait", { width: 820, height: 1180 }, false],
    ["mobile", { width: 390, height: 844 }, false],
    ["mobile-small", { width: 320, height: 740 }, false],
  ]) {
    const page = await browser.newPage({
      viewport,
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
    });
    const errors = [];
    const cancellations = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-09-23T10:00:00Z") });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === "/api/activity")
        return route.fulfill({ json: { ok: true } });
      if (url.pathname === "/api/team/cancel") {
        cancellations.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
      }
      if (url.pathname.startsWith("/api/"))
        throw Error("Unexpected API request: " + url.pathname);
      await route.continue();
    });
    await page.goto(base);
    await page.locator(".month-calendar").first().waitFor();
    assert.deepEqual(
      await page.locator(".month-calendar h2").allTextContents(),
      ["September 2026", "Oktober 2026"],
    );
    assert.equal(await page.locator(".team-event").count(), 16);
    const cancelled = page.locator(".team-event-cancelled");
    assert.match(
      await page.locator(".team-event").last().textContent(),
      /Training 2/,
    );
    assert.equal(await cancelled.locator(".auto-label").count(), 0);
    assert.match(await cancelled.textContent(), /keine Einheit angerechnet/);
    assert.equal(
      await cancelled.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(255, 240, 240)",
    );
    await cancelled
      .getByRole("button", { name: "Ausnahmen eintragen" })
      .click();
    assert.doesNotMatch(
      await page.getByRole("dialog").textContent(),
      /automatische|Puffer/i,
    );
    await page.getByRole("button", { name: "Dialog schließen" }).click();
    await cancelled.getByRole("button", { name: "Termin bearbeiten" }).click();
    assert.equal(
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Termin stornieren", exact: true })
        .count(),
      0,
    );
    await page.getByRole("button", { name: "Dialog schließen" }).click();

    assert.equal(
      await page
        .locator('.month-day[aria-pressed="true"]')
        .getAttribute("data-date"),
      "2026-09-23",
    );
    const layout = await page.evaluate(() => {
      const months = document
        .querySelector(".calendar-months")
        .getBoundingClientRect();
      const agenda = document
        .querySelector(".calendar-agenda")
        .getBoundingClientRect();
      const list = document.querySelector(".calendar-agenda-list");
      return {
        right: agenda.left >= months.right,
        below: agenda.top >= months.bottom,
        scroll: list.scrollHeight > list.clientHeight,
        listHeight: list.clientHeight,
        contentHeight: list.scrollHeight,
        monthsHeight: months.height,
        agendaHeight: agenda.height,
        overflow: getComputedStyle(list).overflowY,
        horizontal: document.documentElement.scrollWidth > innerWidth,
      };
    });
    await page.screenshot({
      path: `${output}/debug-${name}.png`,
      fullPage: true,
    });
    assert.equal(layout.horizontal, false, name + " horizontal overflow");
    assert.equal(layout.right, wide, name + " column position");
    if (wide) {
      assert(layout.scroll);
      assert.equal(layout.overflow, "auto");
    } else {
      assert(layout.below);
      assert.equal(layout.overflow, "visible");
    }
    await page.screenshot({
      path: `${output}/calendar-${name}.png`,
      fullPage: true,
    });
    await page.screenshot({ path: `${output}/viewport-${name}.png` });
    // The next month remains the second month when one of its days is selected.
    await page.locator('[data-date="2026-10-05"]').click();
    assert.equal(await page.locator(".team-event").count(), 1);
    assert(
      (await page.locator(".team-event").textContent()).includes(
        "Training im Folgemonat",
      ),
    );
    assert.equal(
      await page.locator(".month-calendar h2").first().textContent(),
      "September 2026",
    );
    await page.locator(".calendar-agenda").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/selected-${name}.png` });
    await page.locator('[data-date="2026-10-01"]').click();
    assert(
      (await page.locator(".team-event").textContent()).includes(
        "Später Termin",
      ),
    );
    await page.locator('[data-date="2026-10-02"]').click();
    await page
      .getByRole("heading", { name: "Keine Termine an diesem Tag." })
      .waitFor();
    await page
      .getByRole("button", { name: "Termin erstellen", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    assert.equal(
      await page
        .getByRole("dialog")
        .locator('input[type="date"]')
        .first()
        .inputValue(),
      "2026-10-02",
    );
    await page.getByRole("button", { name: "Dialog schließen" }).click();
    await page.getByRole("button", { name: "Heute", exact: true }).click();
    await page.getByRole("button", { name: "Woche", exact: true }).click();
    assert.equal(await page.locator(".month-calendar").count(), 0);
    assert.equal(await page.locator(".team-event").count(), 16);
    await page.getByRole("button", { name: "Kalender", exact: true }).click();
    await page
      .getByRole("button", { name: "Nächster Monat", exact: true })
      .click();
    assert.deepEqual(
      await page.locator(".month-calendar h2").allTextContents(),
      ["Oktober 2026", "November 2026"],
    );
    await page.getByRole("button", { name: "Heute", exact: true }).click();
    // Native keyboard activation of a day and preserved training editor.
    await page.locator('[data-date="2026-10-05"]').focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Termin bearbeiten", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Dialog schließen" }).click();
    await page
      .getByRole("button", { name: "Ausnahmen eintragen", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    assert.match(
      await page.getByRole("dialog").textContent(),
      /06.10.2026 um 11:00 Uhr/,
    );
    assert.match(
      await page.getByRole("dialog").textContent(),
      /nach Trainingsende/,
    );
    assert.doesNotMatch(
      await page.getByRole("dialog").textContent(),
      /Puffer-Minuten/,
    );
    await page.getByRole("button", { name: "Dialog schließen" }).click();
    // Mock a cancellation: no real database writes or messages.
    await page
      .getByRole("button", { name: "Termin bearbeiten", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Termin stornieren", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Stornierungsgrund" })
      .fill("Coach ist verhindert");
    await page
      .getByRole("button", { name: "Stornierung bestätigen", exact: true })
      .click();
    await page.locator(".team-event-cancelled").waitFor();
    assert.equal(cancellations.length, 1);
    assert.equal(cancellations[0].id, "next-month");
    assert.equal(await page.locator(".team-event .auto-label").count(), 0);
    await page.screenshot({ path: `${output}/cancelled-${name}.png` });
    assert.deepEqual(errors, []);
    console.log(
      name +
        ": layout, day selection, navigation, empty day, editor, exceptions, week and keyboard passed",
    );
    await page.close();
  }
  for (const viewport of [
    { width: 1440, height: 1050 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({
      viewport,
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
    });
    const errors = [],
      saves = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-10-08T10:00:00Z") });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === "/api/activity")
        return route.fulfill({ json: { ok: true } });
      if (url.pathname === "/api/team/events") {
        saves.push(route.request().postDataJSON());
        return route.fulfill({ json: { id: "grace-event" } });
      }
      if (url.pathname.startsWith("/api/"))
        throw Error("Unexpected API request: " + url.pathname);
      await route.continue();
    });
    await page.goto(base + "?grace");
    await page
      .getByRole("button", { name: "Termin erstellen", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const child = dialog.getByRole("checkbox", {
      name: "Levin Günes",
      exact: true,
    });
    const warning =
      "Die Einheit liegt außerhalb des Abozeitraums, bitte prüfen";
    assert.match(await dialog.textContent(), new RegExp(warning));
    // Cancelling the native confirmation must leave the player unselected.
    page.once("dialog", async (d) => {
      assert.match(d.message(), new RegExp(warning));
      await d.dismiss();
    });
    await child.click();
    assert.equal(await child.isChecked(), false);
    page.once("dialog", (d) => d.accept());
    await child.click();
    assert.equal(await child.isChecked(), true);
    await dialog
      .getByText("Hinweis für diesen Trainingsbeginn bestätigt.", {
        exact: true,
      })
      .waitFor();
    // Even changing back to the previous time needs a new confirmation.
    await dialog.locator('input[name="start"]').fill("17:00");
    await dialog.locator('input[name="start"]').fill("16:30");
    await dialog.getByRole("button", { name: "Termin speichern" }).click();
    assert.equal(saves.length, 0);
    assert.match(
      await dialog.textContent(),
      /Bitte den Hinweis beim Kind bestätigen/,
    );
    page.once("dialog", (d) => d.accept());
    await dialog
      .getByRole("button", { name: "Hinweis bestätigen", exact: true })
      .click();
    await dialog.locator('select[name="type"]').selectOption("Einzeltraining");
    await dialog
      .getByRole("button", { name: "Hinweis bestätigen", exact: true })
      .waitFor();
    // Outside the grace window cannot be saved, even after earlier confirmation.
    await dialog.locator('input[name="date"]').fill("2026-10-09");
    await dialog.getByRole("button", { name: "Termin speichern" }).click();
    assert.equal(saves.length, 0);
    assert.match(await dialog.textContent(), /Kein Leistungszeitraum/);
    await dialog.locator('input[name="date"]').fill("2026-10-08");
    await dialog.locator('input[name="start"]').fill("23:59");
    await dialog.locator('input[name="end"]').fill("00:59");
    await dialog
      .getByRole("checkbox", { name: "Training endet am Folgetag" })
      .check();
    page.once("dialog", (d) => d.accept());
    await dialog
      .getByRole("button", { name: "Hinweis bestätigen", exact: true })
      .click();
    assert.doesNotMatch(await dialog.textContent(), /Kein Leistungszeitraum/);
    await page.screenshot({
      path: `${output}/grace-confirmed-${viewport.width}.png`,
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Termin speichern" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(saves.length, 1);
    assert.equal(saves[0].starts_at, "2026-10-08T21:59:00Z");
    assert.deepEqual(saves[0].grace_confirmations, [
      {
        player_id: "max",
        period_id: "period-max",
        period_ends_at: "2026-10-07T12:40:49Z",
        starts_at: "2026-10-08T21:59:00Z",
        event_type: "Einzeltraining",
      },
    ]);
    assert.deepEqual(errors, []);
    console.log(
      `grace ${viewport.width}: cancellation, confirmation, time/type changes, date boundary and save passed`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
