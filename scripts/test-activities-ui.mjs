// Isolated component browser checks: no credentials, database, Stripe, SMTP or deployment.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const output = resolve("output/activities-review");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["tests/ui/activities-entry.tsx"],
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
const now = "2026-10-17T10:00:00Z";
const make = (id, at, help = false) => ({
  id,
  at,
  title: help ? "Abo-Zuordnung noch unklar" : "Teilnahme aktualisiert",
  text: help
    ? "Das geänderte Abo konnte noch keinem Kind eindeutig zugeordnet werden."
    : "Gruppentraining: Teilnahme bestätigt.",
  subject: "Beispielkind",
  actor: "Coach Beispiel",
  tone: help ? "problem" : "normal",
  ...(help
    ? {
        help: {
          text: "Öffne Übersicht → Abo-Zuordnungen prüfen. Vergleiche die Zuordnung und bestätige das passende Kind.",
          href: "/admin",
          label: "Zur Abo-Prüfung",
        },
      }
    : {}),
});
try {
  for (const [label, width, role] of [
    ["admin-desktop", 1440, "admin"],
    ["admin-mobile", 390, "admin"],
    ["staff-mobile", 390, "team"],
  ]) {
    const page = await browser.newPage({
        viewport: { width, height: 950 },
        isMobile: width < 600,
        hasTouch: width < 600,
      }),
      errors = [],
      windows = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/activities"))
        assert.equal(route.request().method(), "GET");
      if (url.pathname === "/api/activities/summary")
        return route.fulfill({ json: { asOf: now, recent: 57, open: 1 } });
      if (url.pathname !== "/api/activities")
        return route.fulfill({ json: { ok: true } });
      const win = url.searchParams.get("window");
      windows.push(win);
      let rows =
        win === "issues"
          ? [make("issue", "2026-10-10T10:00:00Z", true)]
          : win === "all"
            ? [make("today", now), make("yesterday", "2026-10-16T08:00:00Z")]
            : [
                make(
                  win,
                  new Date(
                    Date.parse(now) - Number(win) * 86400000 - 3600000,
                  ).toISOString(),
                ),
              ];
      if (role === "team") rows = rows.map(({ help, ...r }) => r);
      return route.fulfill({ json: { rows, next: null, total: rows.length } });
    });
    await page.goto(`${base}/${role}/aktivitaeten`);
    await expect(
      page.getByRole("heading", { name: "Aktivitäten.", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".activity-day").nth(0)).toHaveAttribute(
      "open",
      "",
    );
    await expect(page.locator(".activity-day").nth(1)).not.toHaveAttribute(
      "open",
      "",
    );
    assert(!windows.includes("1"));
    assert(!windows.includes("2"));
    await page.getByText("Vorheriger Tag", { exact: true }).click();
    await expect(
      page.locator(".activity-day").nth(1).locator(".activity-entry"),
    ).toHaveCount(1);
    assert(windows.includes("1"));
    if (role === "admin") {
      await expect(
        page.getByText("Problem: Aktion erforderlich!", { exact: true }),
      ).toBeVisible();
      const info = page.getByLabel("Hilfsanleitung: Abo-Zuordnung noch unklar");
      if (width > 1000) await info.hover();
      else await info.click();
      await expect(
        page.getByText(/Vergleiche die Zuordnung und bestätige/),
      ).toBeVisible();
      const box = await page.locator(".activity-help-content").boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width);
      const panel = await page.locator(".activity-open").boundingBox();
      assert(
        panel &&
          box.x >= panel.x &&
          box.y >= panel.y &&
          box.x + box.width <= panel.x + panel.width &&
          box.y + box.height <= panel.y + panel.height,
      );
      const helpLink = page.getByRole("link", { name: "Zur Abo-Prüfung →" });
      await helpLink.hover();
      await expect(helpLink).toBeVisible();
      await helpLink.click({ trial: true });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    } else {
      await expect(
        page.getByText("Problem: Aktion erforderlich!", { exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".activity-help")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Menü öffnen", exact: true })
        .click();
      await expect(
        page.getByRole("link", { name: /Aktivitäten/ }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Stripe-Zuordnung/ }),
      ).toHaveCount(0);
      await page
        .locator("#portal-sidebar")
        .getByRole("button", { name: "Menü schließen", exact: true })
        .click();
    }
    await page.screenshot({ path: `${output}/${label}.png`, fullPage: true });
    await page
      .getByRole("link", { name: "Alle Aktivitäten →", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${role}/aktivitaeten/alle$`));
    await expect(
      page.getByRole("heading", { name: "Alle Aktivitäten.", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".activity-day")).toHaveCount(2);
    await expect(page.locator(".activity-day").nth(1)).not.toHaveAttribute(
      "open",
      "",
    );
    await page.locator(".activity-day").nth(1).locator("summary").click();
    await expect(
      page.locator(".activity-day").nth(1).locator(".activity-entry"),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `${label}: periods, read-only access, guidance, archive and layout passed`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
