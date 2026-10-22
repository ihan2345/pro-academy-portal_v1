// Isolated real-component checks; no database, Stripe, SMTP, credentials or deployment.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const output = resolve("output/trials-review");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["tests/ui/trials-entry.tsx"],
  bundle: true,
  outfile: `${output}/app.js`,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "isolated-next",
      setup(b) {
        b.onResolve({ filter: /^next\/(navigation|link|image)$/ }, (args) => ({
          path: args.path,
          namespace: "next-stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "next-stub" }, (args) => ({
          loader: "jsx",
          resolveDir: process.cwd(),
          contents: args.path.endsWith("navigation")
            ? "export const useRouter=()=>({refresh(){},push(){},replace(){}});"
            : `import React from 'react';export default function C({children,priority,fill,unoptimized,...props}){return React.createElement('${args.path.endsWith("link") ? "a" : "img"}',props,children)}`,
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
  `${output}/all.css`,
  css.css + "\n" + (await readFile(`${output}/app.css`, "utf8")),
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
  if (["/app.js", "/all.css"].includes(path)) {
    res.setHeader(
      "Content-Type",
      path.endsWith(".js") ? "text/javascript" : "text/css",
    );
    res.end(await readFile(output + path));
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><html lang="de"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/all.css"><body><div id="root"></div><script src="/app.js"></script></body></html>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
    });
    await page.clock.install({ time: new Date("2026-10-21T12:00:00Z") });
    const errors = [],
      posts = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const common = {
      family_id: "family",
      player_id: "player",
      birth_date: "2015-01-01",
      club: "FC Beispiel",
      team_note: "Nur intern",
      parent_name: "Mina Beispiel",
      email: "parent@test.invalid",
      phone: "+4915112345678",
      preferred_location: "Gelsenkirchen",
      availability: "Dienstags",
      email_verified: true,
      event_id: null,
      participant_id: null,
      confirmed_at: null,
      event_title: null,
      starts_at: null,
      ends_at: null,
      event_status: null,
      attendance: null,
      location_name: null,
      address: null,
      coach_name: null,
      academy_rating: null,
      academy_feedback: null,
      academy_ready: false,
      parent_rating: null,
      parent_feedback: null,
      subscribed: false,
    };
    let rows = [
      {
        ...common,
        id: "new",
        first_name: "Emir",
        last_name: "Beispiel",
        status: "new",
      },
      {
        ...common,
        id: "review",
        first_name: "Mira",
        last_name: "Beispiel",
        status: "attended",
        event_id: "event",
        confirmed_at: "2026-10-20T14:00:00Z",
        starts_at: "2026-10-20T12:00:00Z",
        ends_at: "2026-10-20T13:00:00Z",
        event_title: "Techniktraining",
        attendance: "attended_manual",
        location_name: "Sportplatz",
        coach_name: "Coach",
      },
    ];
    await page.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === "/api/probetraining/team" && req.method() === "GET")
        return route.fulfill({
          json: {
            rows,
            events: [
              {
                id: "future",
                title: "Gruppentraining",
                starts_at: "2026-10-25T12:00:00Z",
              },
            ],
          },
        });
      if (url.pathname === "/api/probetraining/summary")
        return route.fulfill({
          json: {
            new: 1,
            review: rows.filter((r) => r.confirmed_at && !r.academy_ready)
              .length,
          },
        });
      if (
        url.pathname.startsWith("/api/probetraining/") &&
        req.method() === "POST"
      ) {
        const body = req.postDataJSON();
        posts.push({ path: url.pathname, body });
        if (body.action === "review")
          rows = rows.map((r) =>
            r.id === body.request_id
              ? {
                  ...r,
                  academy_ready: body.ready,
                  academy_rating: body.rating,
                  academy_feedback: body.feedback,
                }
              : r,
          );
        return route.fulfill({
          json:
            body.action === "feedback" || body.action === "comment"
              ? {
                  id: "request",
                  event_id: "event",
                  first_name: "Emir",
                  parent_rating: 5,
                  parent_feedback: body.feedback,
                  comment_submitted_at:
                    body.action === "comment" ? new Date().toISOString() : null,
                }
              : { ok: true, id: "trial-id" },
        });
      }
      if (url.pathname === "/api/activities/summary")
        return route.fulfill({
          json: { open: 0, recent: 0, asOf: new Date().toISOString() },
        });
      if (url.pathname === "/api/platform/availability")
        return route.fulfill({ json: { pai: false, mascot: false } });
      if (url.pathname === "/api/activity")
        return route.fulfill({ json: { ok: true } });
      if (url.pathname.startsWith("/api/"))
        throw Error("Unexpected API " + url.pathname);
      return route.continue();
    });
    await page.goto(base);
    await page.getByLabel("Dein Vor- und Nachname").fill("Mina Beispiel");
    await page
      .getByLabel("E-Mail *", { exact: true })
      .fill("parent@test.invalid");
    await page.getByLabel("Telefonnummer").fill("+4915112345678");
    await page
      .getByRole("button", { name: "Weiteres Kind hinzufügen" })
      .click();
    await page
      .getByRole("button", { name: "Weiteres Kind hinzufügen" })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Weiteres Kind hinzufügen" })
        .count(),
      0,
    );
    for (let i = 0; i < 3; i++) {
      const group = page.getByRole("group", { name: `Kind ${i + 1}` });
      await group
        .getByLabel("Vorname *", { exact: true })
        .fill(["Emir", "Mira", "Ada"][i]);
      await group.getByLabel("Nachname *", { exact: true }).fill("Beispiel");
      await group.getByLabel("Geburtsdatum").fill("2015-01-01");
    }
    await page
      .getByRole("button", { name: "Kostenloses Probetraining anfragen" })
      .click();
    assert.equal(posts.length, 0);
    await page.locator("[name=operational]").check();
    await page.locator("[name=privacy]").check();
    assert.equal(await page.locator("[name=marketing]").isChecked(), false);
    assert.equal(
      await page.getByRole("link", { name: /Herbstcamp/ }).count(),
      1,
    );
    await page.screenshot({
      path: `${output}/form-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Kostenloses Probetraining anfragen" })
      .click();
    await page
      .getByRole("heading", { name: "Willkommen bei der ProAcademy!" })
      .waitFor();
    assert.equal(posts[0].body.children.length, 3);
    assert.equal(posts[0].body.marketing_consent, false);
    await page.goto(base + "?screen=team");
    await page.getByRole("button", { name: "Teilnehmer bewerten (1)" }).click();
    await page.getByRole("heading", { name: "Mira Beispiel" }).waitFor();
    await page
      .getByText("Profil, Termin und Aktionen öffnen", { exact: true })
      .click();
    await page.getByLabel("Eindruck vom Probetraining").selectOption("4");
    await page
      .getByLabel("Persönliche Beobachtung und nächster Schritt")
      .fill("Aufmerksam mitgemacht. Weiter so!");
    await page.getByLabel("Für Eltern und Feedbackmail freigeben").check();
    await page.screenshot({
      path: `${output}/review-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Bewertung speichern" }).click();
    await page
      .getByRole("button", { name: "Teilnehmer bewerten (0)" })
      .waitFor();
    assert.equal(posts.at(-1).body.ready, true);
    await page.goto(base + "?screen=welcome");
    await page.getByText("Du hast aufmerksam mitgemacht. Weiter so!").waitFor();
    assert.equal(await page.getByText("Nur intern").count(), 0);
    await page.getByRole("button", { name: "5 von 5 für Emir" }).click();
    await page.getByLabel("Gespeicherte Bewertung: 5 von 5").waitFor();
    await page
      .getByLabel("Persönliche Nachricht (freiwillig, einmalig)")
      .fill("Hat Spaß gemacht!");
    await page
      .getByRole("button", { name: "Nachricht einmalig speichern" })
      .click();
    await page.getByText("Danke für eure persönliche Rückmeldung.").waitFor();
    assert.equal(posts.at(-1).body.event_id, "event");
    await page.screenshot({
      path: `${output}/welcome-${width}.png`,
      fullPage: true,
    });
    await page.goto(base + "?screen=manual");
    await page
      .getByRole("button", { name: "Emir: als Probetraining kennzeichnen" })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Probetraining übernehmen" })
        .isDisabled(),
      true,
    );
    await page
      .getByLabel(
        "Zustimmung zur Termin- und Feedbackkommunikation sowie Datenschutzhinweis liegen vor.",
      )
      .check();
    await page
      .getByRole("button", { name: "Probetraining übernehmen" })
      .click();
    await page.getByRole("link", { name: /Feedback vorbereiten/ }).waitFor();
    assert.equal(posts.at(-1).body.action, "mark");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      `${width}: request limit/consent, camps, review queue, parent one-click feedback and manual marking passed`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
