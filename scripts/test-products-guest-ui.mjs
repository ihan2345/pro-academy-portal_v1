// Isolated component browser checks: no credentials, database, Stripe, SMTP or deployment.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const output = resolve("output/product-guest-ui");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["tests/ui/product-guest-entry.tsx"],
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
    (await readFile("src/components/products/products.css", "utf8")),
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
  name: "FirstTouch",
  kind: "subscription",
  category: "Fußballtraining",
  short_description: "4 Trainingseinheiten im Monat",
  description: "Dein Einstieg ins Fußballtraining.",
  asset_ids: [],
  training_content: {},
  price: {
    amount: 9900,
    currency: "eur",
    interval: "month",
    interval_count: 1,
  },
  decision: {
    mode: "register",
    label: "Jetzt kaufen",
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
const results = [];
try {
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let submitted;
    let receiptStatus = "fulfilled";
    let calls = 0;
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      let json;
      if (path === "/api/products")
        json = {
          rows: [fixture],
          context: visitor,
          next: null,
          payments_enabled: true,
        };
      else if (path.endsWith("/checkout")) {
        submitted = request.postDataJSON();
        calls++;
        json = {
          error: "Test: Stripe-Ziel wird im isolierten UI-Test nicht geöffnet.",
        };
        return route.fulfill({ status: 400, json });
      } else if (path.endsWith("/access"))
        json = {
          message: "Der Zugangslink wird an deine E-Mail-Adresse gesendet.",
        };
      else if (path.endsWith("/cancel")) {
        receiptStatus = "expired";
        json = { status: receiptStatus };
      } else if (path.includes("/purchases/"))
        json = {
          id: "90000000-0000-4000-8000-000000000002",
          name: fixture.name,
          status: receiptStatus,
          guest: true,
          account_pending: true,
          payment_confirmed: receiptStatus === "fulfilled",
        };
      else json = {};
      await route.fulfill({ json });
    });
    await page.goto(base + "/produkte");
    await page.getByRole("button", { name: "Jetzt kaufen" }).click();
    await expect(
      page.getByText("Buche direkt ohne vorherige Anmeldung.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Deine E-Mail")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Zugangslink anfordern", exact: true }),
    ).toHaveCount(0);
    const buy = page
      .getByRole("button", { name: /Weiter|Stripe|Zahlung/ })
      .last();
    await buy.click();
    assert.equal(calls, 0, "required fields must block empty submissions");
    await page
      .getByLabel("Dein vollständiger Name", { exact: true })
      .fill("Neue Familie");
    await page
      .getByLabel("Deine E-Mail", { exact: true })
      .fill("family@example.invalid");
    await page.getByLabel("Telefon (optional)", { exact: true }).fill("01234");
    await page.getByLabel("Vorname", { exact: true }).fill("Neues");
    await page.getByLabel("Nachname", { exact: true }).fill("Kind");
    await page.getByLabel("Geburtsdatum", { exact: true }).fill("2016-04-15");
    await page
      .getByLabel("Rabattcode (optional)", { exact: false })
      .fill("START20");
    await buy.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Test: Stripe-Ziel" }),
    ).toBeVisible();
    assert.equal(calls, 1);
    assert.equal(submitted.guest_parent.email, "family@example.invalid");
    assert.equal(submitted.new_child.first_name, "Neues");
    assert.equal(submitted.discount_code, "START20");
    assert.equal(submitted.player_id, undefined);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.getByRole("dialog").evaluate((el) => {
      el.scrollTop = 0;
    });
    const bounds = await page.getByRole("dialog").boundingBox();
    assert.ok(
      bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1,
      "dialog must fit viewport",
    );
    await page.screenshot({ path: `${output}/${name}-guest-form.png` });
    await page.goto(
      base + "/produkte?purchase=90000000-0000-4000-8000-000000000002",
    );
    await expect(
      page.getByText(
        "Deine Zahlung wurde bestätigt und die Buchung zugeordnet.",
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Zugangslink erneut anfordern" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Zugangslink" }),
    ).toBeVisible();
    await page.screenshot({
      path: `${output}/${name}-paid-access-pending.png`,
      fullPage: true,
    });
    receiptStatus = "checkout";
    await page.goto(
      base + "/produkte?purchase=90000000-0000-4000-8000-000000000002",
    );
    await page
      .getByRole("button", { name: "Unbezahlte Bestellung beenden" })
      .click();
    await expect(
      page.getByText("Dieser Checkout ist abgelaufen."),
    ).toBeVisible();
    receiptStatus = "refunded";
    await page.goto(
      base + "/produkte?purchase=90000000-0000-4000-8000-000000000002",
    );
    await expect(page.getByText("Dein Kauf wurde erstattet.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Zugangslink erneut anfordern" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Status aktualisieren", exact: true }),
    ).toHaveCount(0);
    assert.deepEqual(errors, []);
    results.push({
      viewport: name,
      guest_form: true,
      required_validation: true,
      discount_payload: true,
      paid_access_pending: true,
      resend_access: true,
      cancel_unpaid: true,
      refunded_terminal: true,
      no_overflow: true,
      page_errors: errors,
    });
    await page.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  server.close();
}
