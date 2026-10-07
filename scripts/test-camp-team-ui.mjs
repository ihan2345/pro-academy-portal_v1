// Isolated component browser checks: no credentials, database, Stripe, SMTP or deployment.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const output = resolve("output/camp-team-review");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["tests/ui/camp-review-entry.tsx"],
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
  (await readFile("src/app/globals.css", "utf8")) +
    "\n" +
    (await readFile("src/components/camps/camps.css", "utf8")),
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
  for (const role of ["admin", "staff", "parent"]) {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const campId = "a0000000-0000-4000-8000-000000000001";
      const family = {
        id: "parent",
        full_name: "Test Parent",
        parent_players: [
          {
            players: {
              id: "child",
              first_name: "Test",
              last_name: "Child",
              camp_birth_date: "2015-04-17",
              camp_gender: "keine Angabe",
              camp_clothing_size: "152",
              archived_at: null,
            },
          },
        ],
      };
      const requests = [];
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (!url.pathname.startsWith("/api/")) return route.continue();
        let json;
        if (url.pathname.endsWith("/dashboard"))
          json = {
            role,
            local_stripe_review: true,
            camps: [
              {
                id: campId,
                title: "Testcamp",
                location: "Testplatz",
                capacity: 80,
                buffer_percent: 20,
                days: [
                  {
                    starts_at: "2027-10-10T09:00:00Z",
                    ends_at: "2027-10-10T15:00:00Z",
                  },
                ],
                status: "open",
              },
            ],
            bookings: [],
            offers: [],
            plans: [],
            reports: [],
            children: [],
            locations: [],
          };
        else if (url.pathname.endsWith("/review"))
          json = {
            running: true,
            stale: false,
            checked_at: new Date().toISOString(),
            error: null,
            sources: [{ payment_link_id: "plink_test" }],
            imported_count: 0,
            families: [family],
            records: [
              {
                payment_id: "pi_fixture",
                parent_name: "New Parent",
                parent_email: "new@example.invalid",
                parent_phone: "123456",
                created_at: "2026-10-01T10:00:00Z",
                child_name: "Test Child",
                age_at_booking: "11",
                clothing_size: "152",
                amount: 10000,
                status: "paid",
                issues: [],
                draft: null,
                imported: false,
              },
            ],
          };
        else if (
          ["/api/camp/review-save", "/api/camp/review-import"].includes(
            url.pathname,
          )
        ) {
          requests.push({
            path: url.pathname,
            body: route.request().postDataJSON(),
          });
          json = { ok: true };
        } else throw new Error(`Unexpected request: ${url.pathname}`);
        await route.fulfill({ json });
      });
      await page.goto(base);
      if (role === "parent") {
        await expect(
          page.getByText("Die Prüfung ist für diesen Zugang nicht verfügbar."),
        ).toBeVisible();
        await expect(
          page.getByRole("link", {
            name: "Kinder zur Prüfung / Angaben ergänzen",
          }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Zum Camp hinzufügen" }),
        ).toHaveCount(0);
      } else {
        await expect(
          page.getByRole("link", {
            name: "Kinder zur Prüfung / Angaben ergänzen",
          }),
        ).toBeVisible();
        await page
          .getByLabel("Vorhandenes Kind / Elternkonto")
          .selectOption("parent|child");
        await expect(
          page.getByRole("button", { name: "Zum Camp hinzufügen" }),
        ).toBeEnabled();
        await page
          .getByRole("button", { name: "Angaben speichern", exact: true })
          .click();
        await expect(
          page.getByRole("status").filter({ hasText: "Angaben gespeichert." }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Zum Camp hinzufügen" }).click();
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: "Kind zum Camp hinzugefügt." }),
        ).toBeVisible();
        assert.equal(requests.at(-1).body.player_id, "child");
        assert.equal(requests.at(-1).body.child.age_at_booking, 11);
        assert.equal(requests.at(-1).path, "/api/camp/review-import");
        await page
          .getByRole("combobox", { name: /^Familie/ })
          .selectOption("new");
        await page
          .getByLabel("E-Mail der Eltern", { exact: true })
          .fill("new@example.invalid");
        await expect(
          page.getByLabel("Alter bei Buchung", { exact: false }),
        ).toHaveValue("11");
        await expect(
          page.getByLabel("Geburtsdatum", { exact: true }),
        ).toHaveCount(0);
        await page.screenshot({
          path: `${output}/${role}-${width}.png`,
          fullPage: true,
        });
        await page.getByRole("button", { name: "Zum Camp hinzufügen" }).click();
        await expect.poll(() => requests.length).toBe(3);
        assert.equal(requests.at(-1).body.player_id, null);
        assert.equal(
          requests.at(-1).body.new_parent.email,
          "new@example.invalid",
        );
        assert.equal(requests.at(-1).path, "/api/camp/review-import");
        assert.equal(requests.at(-1).body.child.birth_date, undefined);
        await page
          .getByRole("combobox", { name: /^Familie/ })
          .selectOption("sibling");
        await expect(
          page.getByRole("combobox", { name: /^Familie/ }),
        ).toHaveValue("sibling");
        await page
          .getByRole("combobox", { name: /^Vorhandene Familie/ })
          .selectOption("parent");
        await page.getByLabel("Vorname", { exact: true }).fill("Sibling");
        await page.getByRole("button", { name: "Zum Camp hinzufügen" }).click();
        await expect.poll(() => requests.length).toBe(4);
        assert.equal(requests.at(-1).body.new_child, true);
        assert.equal(requests.at(-1).body.parent_id, "parent");
        assert.equal(requests.at(-1).body.player_id, null);
      }
      assert.deepEqual(errors, []);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      console.log(
        `${role} ${width}px: review permissions and existing/new family workflow passed`,
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
