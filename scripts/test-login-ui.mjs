// Isolated component browser checks: no credentials, database, Stripe, SMTP or deployment.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const output = resolve("output/login-review");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["tests/ui/login-entry.tsx"],
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
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let sends = 0,
      verifies = 0;
    const player = "12345678-1234-4234-8234-123456789012";
    await page.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.pathname === "/api/auth/login") {
        sends++;
        assert.deepEqual(request.postDataJSON(), {
          email: "parent@example.com",
          player_id: player,
          return_to_shop: true,
        });
        return route.fulfill({ json: { ok: true } });
      }
      if (url.pathname === "/api/auth/verify") {
        verifies++;
        assert.deepEqual(request.postDataJSON(), {
          email: "parent@example.com",
          code: "012345",
        });
        return route.fulfill(
          verifies === 1
            ? {
                status: 400,
                json: {
                  error:
                    "Der Code ist ungültig, abgelaufen oder bereits verwendet.",
                },
              }
            : { json: { ok: true, redirect: "/signed-in" } },
        );
      }
      if (url.pathname === "/signed-in")
        return route.fulfill({
          contentType: "text/html",
          body: "<h1>Angemeldet</h1>",
        });
      if (url.origin !== base) return route.abort();
      return route.continue();
    });
    await page.clock.install();
    await page.goto(`${base}/?player=${player}&shop=1`);
    await page.getByLabel("Deine E-Mail-Adresse").fill("Parent@example.com");
    await page.getByRole("button", { name: "Anmeldecode anfordern" }).click();
    const code = page.getByLabel("Dein sechsstelliger E-Mail-Code");
    await code.waitFor();
    assert.equal(await code.getAttribute("autocomplete"), "one-time-code");
    assert.equal(await code.getAttribute("inputmode"), "numeric");
    assert(await code.evaluate((el) => el === document.activeElement));
    assert(
      await page
        .getByText("Alternativ kannst du den Anmeldelink", { exact: false })
        .isVisible(),
    );
    assert(
      await page
        .getByRole("button", { name: "Mit Code anmelden" })
        .isDisabled(),
    );
    await code.fill("01234");
    assert(
      await page
        .getByRole("button", { name: "Mit Code anmelden" })
        .isDisabled(),
    );
    await code.fill("01a2345");
    assert.equal(await code.inputValue(), "01234");
    await code.fill("012345");
    await page.getByRole("button", { name: "Mit Code anmelden" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await code.inputValue(), "012345");
    await page.screenshot({
      path: `${output}/code-${width}.png`,
      fullPage: true,
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.clock.fastForward(61000);
    await page
      .getByRole("button", { name: "Neuen Code anfordern", exact: true })
      .click();
    await expect(code).toHaveValue("");
    assert.equal(sends, 2);
    await page.getByRole("button", { name: "Andere E-Mail verwenden" }).click();
    assert.equal(
      await page.getByLabel("Deine E-Mail-Adresse").inputValue(),
      "Parent@example.com",
    );
    await page.getByRole("button", { name: "Anmeldecode anfordern" }).click();
    await code.fill("012345");
    await code.press("Enter");
    await page.getByRole("heading", { name: "Angemeldet" }).waitFor();
    assert.equal(verifies, 2);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `Email code UI passed: ${width}px, invalid code, resend, switch email, Enter and redirect.`,
    );
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
