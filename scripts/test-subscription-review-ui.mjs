// Isolated component browser checks: no credentials, database, Stripe, SMTP or deployment.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const output = resolve("output/subscription-review");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["tests/ui/subscription-review-entry.tsx"],
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

const firstChild = "50000000-0000-0000-0000-000000000001",
  secondChild = "50000000-0000-0000-0000-000000000002";
const context = {
  customerId: "cus_example",
  customerName: "Erika Beispiel",
  customerEmail: "erika@example.com",
  customerDetailsUnavailable: false,
  subscriptionId: "sub_example",
  status: "active",
  createdAt: "2026-10-17",
  syncedAt: "2026-10-18",
  itemId: "si_new",
  priceId: "price_example",
  parents: [{ id: "parent", name: "Erika Beispiel" }],
};
const review = {
  context,
  id: "10000000-0000-0000-0000-000000000001",
  signature: "a".repeat(32),
  product: "FirstTouch",
  units: 4,
  startsAt: "2026-10-01",
  endsAt: "2026-11-01",
  quantity: 1,
  suggestions: [
    { playerId: firstChild, name: "Max Beispiel", previousItemId: "si_old_1" },
    {
      playerId: secondChild,
      name: "Alex Beispiel",
      previousItemId: "si_old_2",
    },
  ],
  candidates: [
    { id: firstChild, name: "Max Beispiel" },
    { id: secondChild, name: "Alex Beispiel" },
  ],
};
try {
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport });
    let saved = false,
      attempt = 0;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", async (route) => {
      if (route.request().url().includes("stripe-parent-inputs"))
        return route.fulfill({
          json: {
            entries: [
              {
                sessionId: "cs_demo",
                submittedAt: "2026-10-17",
                subscriptionId: "sub_example",
                fields: [
                  {
                    key: "child",
                    label: "Name des Kindes",
                    value: "Max Elternangabe",
                  },
                  { key: "birth", label: "Geburtsdatum", value: "01.01.2015" },
                ],
              },
            ],
            partial: false,
          },
        });
      if (!route.request().url().includes("subscription-reviews"))
        return route.fulfill({ json: { ok: true } });
      if (route.request().method() === "GET")
        return route.fulfill({
          json: { rows: saved ? [] : [review], total: saved ? 0 : 1 },
        });
      assert.deepEqual(route.request().postDataJSON(), {
        review_id: review.id,
        signature: review.signature,
        player_id: firstChild,
        previous_item_id: "si_old_1",
      });
      attempt++;
      if (attempt === 1)
        return route.fulfill({
          status: 409,
          json: { error: "Prüfung bitte erneut bestätigen" },
        });
      saved = true;
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto(base);
    await expect(
      page.getByRole("button", { name: "Kinder und Vorschläge prüfen →" }),
    ).toBeVisible();
    await expect(page.locator(".stamp.over-quota")).toHaveCount(2);
    await page.screenshot({
      path: `${output}/${name}-overview.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Kinder und Vorschläge prüfen →" })
      .click();
    await expect(
      page.getByRole("button", { name: "Zuordnung bestätigen" }),
    ).toBeDisabled();
    await page
      .getByLabel("Bisherige Zuordnung ersetzen")
      .selectOption("si_old_1");
    await expect(page.getByLabel("Kind für das neue Paket")).toHaveValue(
      firstChild,
    );
    await expect(
      page.getByText(/Das Kontingent wird sofort angepasst/),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `${output}/${name}-review.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Zuordnung bestätigen" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Prüfung bitte erneut bestätigen",
    );
    await page.getByRole("button", { name: "Zuordnung bestätigen" }).click();
    await expect(
      page.getByText("Alle Zuordnungen sind geprüft."),
    ).toBeVisible();
    await page.unroute("**/api/**");
    await page.route("**/api/**", (route) =>
      route.fulfill({
        json: route.request().url().includes("stripe-parent-inputs")
          ? {
              entries: [
                {
                  sessionId: "cs_demo",
                  submittedAt: "2026-10-17",
                  subscriptionId: "sub_example",
                  fields: [
                    {
                      key: "child",
                      label: "Name des Kindes",
                      value: "Max Elternangabe",
                    },
                  ],
                },
              ],
              partial: false,
            }
          : route.request().url().includes("subscription-reviews")
            ? {
                rows: [
                  {
                    ...review,
                    suggestions: [],
                    candidates: [],
                    context: { ...context, parents: [] },
                  },
                ],
                total: 1,
              }
            : { ok: true },
      }),
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Kinder und Vorschläge prüfen →" })
      .click();
    await expect(
      page.getByText(/Dieser Stripe-Kunde ist noch keiner Familie/),
    ).toBeVisible();
    await expect(page.getByLabel("Kind für das neue Paket")).toBeDisabled();
    await expect(
      page.getByRole("link", { name: /Diesen Kunden zuordnen/ }),
    ).toHaveAttribute("href", "/admin/stripe?customer=cus_example");
    await expect(page.getByText(/erika@example.com/)).toBeVisible();
    await expect(
      page.getByText("Max Elternangabe", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `${output}/${name}-unlinked.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `${name}: review suggestion, confirmation, retry and quota markers passed`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
