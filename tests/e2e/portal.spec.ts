import { test, expect } from "@playwright/test";
import { login, twoChildFamily } from "./local-test";

test("parent account uses real local data and enforces section access", async ({
  page,
  isMobile,
}) => {
  await login(page, twoChildFamily.key);
  await expect(
    page.getByRole("heading", { name: "Dein Elternkonto" }),
  ).toBeVisible();
  for (const child of twoChildFamily.children)
    await expect(page.locator(".account-panel").first()).toContainText(child);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/berichte");
  await expect(
    page.getByRole("heading", { name: "Deine Trainingsberichte" }),
  ).toBeVisible();
  if (isMobile)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
});

test("admin and coach export a real database-backed stamp card", async ({
  page,
  isMobile,
}) => {
  for (const [key, area] of [
    ["admin", "admin"],
    ["trainer", "team"],
  ]) {
    await login(page, key);
    await page.goto(`/${area}/stempelkarten`);
    await expect(
      page.getByRole("heading", { name: "Stempelkarten." }),
    ).toBeVisible();
    const response = page.waitForResponse(
      (r) => r.url().includes("/api/team/stamp-card?") && r.status() === 200,
    );
    await page
      .getByRole("button", { name: "Aktualisieren", exact: false })
      .click();
    await response;
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF exportieren" }).click();
    expect((await download).suggestedFilename()).toContain("Stempelkarte");
    await page.getByLabel("Kind suchen").fill("nicht-vorhanden-xyz");
    await expect(
      page.getByText("Keine passenden Kinder gefunden."),
    ).toBeVisible();
    if (isMobile)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
  }
});

test("local test blocks external actions and has no unauthenticated demo", async ({
  page,
  request,
}) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByText("Testportal mit Beispieldaten öffnen →"),
  ).toHaveCount(0);
  for (const path of ["stripe/portal", "auth/login", "cron"])
    expect(
      (
        await request.post(`/api/${path}`, {
          data: {},
          headers: { origin: "http://127.0.0.1:3107" },
        })
      ).status(),
    ).toBe(403);
  expect((await request.get("/api/admin/players")).status()).toBe(401);
});
