import { test, expect } from "@playwright/test";
test("parent dashboard, multiple children, stamp semantics and WhatsApp details", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Hallo Sarah." }),
  ).toBeVisible();
  await expect(page.getByLabel("Einheit 3: absolviert")).toBeVisible();
  await expect(page.getByLabel("Einheit 4: geplant")).toBeVisible();
  await page.getByLabel("Kind auswählen").selectOption("lena");
  await expect(page.getByText("1 von 4 Einheiten absolviert")).toBeVisible();
  await page.getByLabel("Kind auswählen").selectOption("max");
  await page
    .getByRole("button", { name: "Termindetails", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const link = page.getByRole("link", {
    name: "Team per WhatsApp kontaktieren",
  });
  await expect(link).toHaveAttribute(
    "href",
    /wa.me\/4915143342392\?text=.*PA-1042/,
  );
  await expect(
    page.getByRole("button", { name: /absagen|stornieren/i }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Dialog schließen" }).click();
  if (isMobile) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/dashboard-${isMobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
  });
});
test("staff creates an event and parent sees plan; exceptions update stamp count", async ({
  page,
}) => {
  await page.goto("/team");
  await page
    .getByRole("button", { name: "Termin erstellen", exact: true })
    .click();
  await page.getByLabel("Trainingstitel").fill("E2E Koordination");
  await page.getByLabel("Max Beispiel").check();
  await page.getByRole("button", { name: "Termin speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /E2E Koordination/ }),
  ).toBeVisible();
  await page.goto("/termine");
  await expect(
    page.getByText("E2E Koordination", { exact: true }),
  ).toBeVisible();
  await page.goto("/team");
  const card = page
    .locator(".team-event")
    .filter({ has: page.getByRole("button", { name: /E2E Koordination/ }) });
  await card.getByRole("button", { name: "Ausnahmen eintragen" }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("excused");
  await page
    .getByLabel("Begründung")
    .fill("Test: krankheitsbedingt entschuldigt");
  await page.getByRole("button", { name: "Korrektur bestätigen" }).click();
  await expect(
    page
      .getByRole("dialog")
      .locator(".badge")
      .filter({ hasText: "Entschuldigt" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dialog schließen" }).click();
  await page.goto("/termine");
  await expect(
    page
      .locator("tr")
      .filter({ has: page.getByText("E2E Koordination", { exact: true }) })
      .getByText("Entschuldigt"),
  ).toBeVisible();
});
test("report download, navigation and honest setup feedback", async ({
  page,
  request,
}) => {
  await page.goto("/berichte");
  await expect(
    page.getByRole("heading", { name: "Deine Trainingsberichte" }),
  ).toBeVisible();
  const response = await request.get("/api/reports/report-demo-1");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF");
  await page.goto("/konto");
  await page
    .getByRole("button", { name: "Stripe-Kundenportal öffnen" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "eingerichtete Testumgebung",
  );
});
test("API rejects unsigned webhook, cron and disabled cancellation", async ({
  request,
}) => {
  expect(
    (await request.post("/api/stripe/webhook", { data: {} })).status(),
  ).toBe(400);
  expect((await request.post("/api/cron")).status()).toBe(401);
  expect(
    (
      await request.post("/api/parent/cancel", { data: { id: "any" } })
    ).status(),
  ).toBe(404);
  expect((await request.get("/api/reports/foreign-file")).status()).toBe(404);
});
test("admin screens render and forms validate", async ({ page }) => {
  await page.goto("/admin/spieler");
  await expect(page.getByRole("heading", { name: "Spieler." })).toBeVisible();
  await page.getByRole("button", { name: "Neu anlegen" }).click();
  await page.getByLabel("Vorname", { exact: true }).fill("Test");
  await page.getByLabel("Nachname").fill("Spieler");
  await page.getByLabel("Geburtsjahr").fill("2016");
  await page.getByLabel("Altersklasse").fill("U11");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "2016", exact: true }),
  ).toBeVisible();
  await page.goto("/admin/stripe");
  await page.getByRole("button", { name: "Testkunden laden" }).click();
  await expect(page.getByRole("status")).toContainText("Testumgebung");
});
