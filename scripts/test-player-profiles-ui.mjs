// Isolated component browser checks: no credentials, database, Stripe, SMTP or deployment.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const output = resolve("output/player-profiles-review");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["tests/ui/player-profiles-entry.tsx"],
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
            : `import React from 'react'; export default function Component({children,priority,fill,unoptimized,prefetch,...props}) { return React.createElement('${args.path.endsWith("link") ? "a" : "img"}',props,children); }`,
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
const cards = Array.from({ length: 35 }, (_, i) => ({
  id: `child-${i}`,
  first_name: `Spieler ${i + 1}`,
  last_name: "Beispiel",
  name: `Spieler ${i + 1} Beispiel`,
  age: "Jahrgang 2015",
  team: "U12",
  birth_year: 2015,
  archived: false,
  products: [["First Touch"], ["Gamechanger"], ["Next Level"]][i % 3],
  since: "2025-01-01",
  months: 12 + i,
  camps: 2,
  stats: {
    all: { count: 30 + i, minutes: 1800 + i * 60 },
    month: { count: 4, minutes: 240 },
  },
  trainingAvailable: true,
  parents: [{ id: `parent-${i}`, name: "Familie Beispiel" }],
}));
try {
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 1050 }],
    ["mobile", { width: 390, height: 844 }],
    ["mobile-small", { width: 320, height: 740 }],
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    const requests = [];
    let failNext = false;
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/player-profiles")
        return route.fulfill({ json: { ok: true } });
      requests.push(url.search);
      const offset = Number(url.searchParams.get("cursor") ?? 0);
      if (offset && failNext) {
        failNext = false;
        return route.fulfill({
          status: 503,
          json: { error: "Test: Verbindung unterbrochen" },
        });
      }
      const search = url.searchParams.get("search");
      const list = search
        ? cards.filter((c) => c.name.includes(search))
        : url.searchParams.get("sort") === "newest"
          ? [...cards].reverse()
          : cards;
      await route.fulfill({
        json: {
          rows: list.slice(offset, offset + 10),
          total: list.length,
          next: offset + 10 < list.length ? String(offset + 10) : null,
        },
      });
    });
    await page.goto(base);
    await expect(page.locator(".player-directory-card").first()).toBeVisible();
    if (name !== "desktop") {
      await expect(page.locator(".player-directory-card")).toHaveCount(10);
      assert.equal(requests.length, 1);
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await expect(
      page.locator(".player-directory-card-link").first(),
    ).toHaveAttribute("href", "/admin/spieler/child-0");
    await expect(
      page.locator(".player-directory-family a").first(),
    ).toHaveAttribute("href", "/admin/elternprofile/parent-0");
    await expect(
      page.getByRole("option", {
        name: "Abo (Pro → Gamechanger → Firsttouch)",
      }),
    ).toHaveCount(1);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    failNext = true;
    await page
      .locator(".player-directory-scroll")
      .evaluate((e) => (e.scrollTop = e.scrollHeight));
    await expect(page.getByText("Test: Verbindung unterbrochen")).toBeVisible();
    await page.getByRole("button", { name: "Erneut versuchen" }).click();
    await expect(page.locator(".player-directory-card")).toHaveCount(20);
    await page.getByLabel("Spielerprofile sortieren").selectOption("newest");
    await expect(page.locator(".player-directory-card").first()).toContainText(
      "Spieler 35 Beispiel",
    );
    await page
      .getByLabel("Spieler oder Eltern suchen")
      .fill("Spieler 2 Beispiel");
    await expect(page.locator(".player-directory-card")).toHaveCount(1);
    await expect(page.locator(".player-directory-card")).toContainText(
      "Spieler 2 Beispiel",
    );
    await page.locator(".player-directory-card-link").first().click();
    await expect(page).toHaveURL(/\/admin\/spieler\/child-1$/);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${name}: pagination, retry, sort, search, overflow passed`);
  }
} finally {
  await browser.close();
  server.close();
}
