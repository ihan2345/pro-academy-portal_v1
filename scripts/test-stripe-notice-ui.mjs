// Isolated component browser checks: no credentials, database, Stripe, SMTP or deployment.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const output = resolve("output/stripe-notice-filter");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["tests/ui/stripe-notice-entry.tsx"],
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

const now = Date.now();
const sample = Array.from({ length: 21 }, (_, i) => ({
  id: `notice_${i}`,
  kind: "activity",
  at: new Date(now - (i === 11 ? 45 : 1) * 86400000).toISOString(),
  customer: `Familie ${i}`,
  title: i < 12 ? "Aktion erforderlich" : "Information oder bearbeitet",
  actionRequired: i < 17,
  state: i < 12 || i >= 17 ? "open" : i < 15 ? "done" : "ignored",
}));
const reports = [];
try {
  for (const [viewport, width] of [
    ["desktop", 1440],
    ["mobile", 390],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const rows = {
      conflicts: structuredClone(sample),
      activities: structuredClone(sample),
    };
    const errors = [];
    let failSave = false;
    const reads = { conflicts: 0, activities: 0 };
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/admin/**", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        if (failSave)
          return route.fulfill({
            status: 503,
            json: { error: "Speichern fehlgeschlagen" },
          });
        const [section, id] = body.token.split(":");
        rows[section].find((r) => r.id === id).state = body.state;
        return route.fulfill({ json: { ok: true } });
      }
      const section = url.searchParams.get("section");
      reads[section]++;
      let selected = rows[section];
      const openCount = selected.filter(
        (r) =>
          r.actionRequired &&
          r.state === "open" &&
          now - Date.parse(r.at) <= 30 * 86400000,
      ).length;
      if (section === "activities") {
        if (url.searchParams.get("window") === "month")
          selected = selected.filter(
            (r) => now - Date.parse(r.at) <= 30 * 86400000,
          );
        if (url.searchParams.get("state") === "open")
          selected = selected.filter(
            (r) => r.actionRequired && r.state === "open",
          );
      }
      const total = selected.length;
      const number = Number(url.searchParams.get("page"));
      if (section === "activities")
        selected = selected.slice((number - 1) * 10, number * 10);
      return route.fulfill({
        json: {
          rows: selected.map((r) => ({ ...r, token: `${section}:${r.id}` })),
          total,
          openCount,
          checkedAt: new Date(now).toISOString(),
        },
      });
    });
    await page.goto(base);
    for (const section of ["conflicts", "activities"]) {
      const box = page.getByRole("region", {
        name:
          section === "conflicts"
            ? "Stripe/Abo-Konflikte"
            : "Stripe-Aktivitäten",
        exact: true,
      });
      await box.getByRole("button", { expanded: false }).click();
      await expect(box.locator(".dashboard-action-count")).toHaveText("11");
      await expect(
        box.getByRole("button", { name: "Letzte 30 Tage", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      const before = reads.conflicts;
      await box.getByRole("button", { name: "Offen", exact: true }).click();
      await expect(
        box.getByRole("button", { name: "Offen", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(box.getByText("1–10 von 12", { exact: true })).toBeVisible();
      await expect(box.locator(".stripe-notice-card")).toHaveCount(10);
      await expect(
        box
          .locator(".stripe-notice-state")
          .filter({ hasText: /Information|Ignoriert|Erledigt/ }),
      ).toHaveCount(0);
      await box.getByRole("button", { name: "Weiter", exact: true }).click();
      await expect(
        box.getByText("11–12 von 12", { exact: true }),
      ).toBeVisible();
      await expect(
        box.getByRole("heading", { name: "Familie 11", exact: true }),
      ).toBeVisible();
      failSave = true;
      await box
        .getByRole("button", { name: "Erledigt", exact: true })
        .first()
        .click();
      await expect(box.getByRole("alert")).toHaveText(
        "Speichern fehlgeschlagen",
      );
      await expect(box.locator(".stripe-notice-card")).toHaveCount(2);
      failSave = false;
      await box
        .getByRole("button", { name: "Erledigt", exact: true })
        .first()
        .click();
      await expect(
        box.getByText("11–11 von 11", { exact: true }),
      ).toBeVisible();
      await expect(box.locator(".dashboard-action-count")).toHaveText("10");
      await box
        .getByRole("button", { name: "Ignorieren", exact: true })
        .click();
      await expect(box.getByText("1–10 von 10", { exact: true })).toBeVisible();
      await expect(box.locator(".dashboard-action-count")).toHaveText("10");
      if (section === "conflicts")
        assert.equal(
          reads.conflicts,
          before,
          "Local conflict filter and paging must not repeat Stripe scans",
        );
      await box.getByRole("button", { name: "Gesamt", exact: true }).click();
      await expect(box.getByText("1–10 von 21", { exact: true })).toBeVisible();
      await box.getByRole("button", { name: "Weiter", exact: true }).click();
      await expect(
        box.getByRole("button", { name: "Wieder öffnen", exact: true }).first(),
      ).toBeVisible();
      await box.getByRole("button", { name: "Offen", exact: true }).click();
      for (let i = 0; i < 10; i++) {
        await box
          .getByRole("button", { name: "Erledigt", exact: true })
          .first()
          .click();
        await expect(box.locator(".stripe-notice-card")).toHaveCount(9 - i);
      }
      await expect(
        box.getByText("Keine Meldungen mit offenen Aktionen vorhanden.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(box.locator(".dashboard-action-count")).toHaveText("0");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: `${output}/${viewport}-open-filter.png`,
      fullPage: true,
    });
    reports.push({
      viewport,
      sections: 2,
      old_open: true,
      filter_before_paging: true,
      failed_save_retained: true,
      successful_save_removed: true,
      page_clamped: true,
      badge_30_days: true,
      empty_state: true,
      no_overflow: true,
    });
    await page.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports));
} finally {
  await browser.close();
  server.close();
}
