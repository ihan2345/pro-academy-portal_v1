import { test, expect } from "@playwright/test";
import { login } from "./local-test";

test.beforeEach(async ({ page }) => {
  await login(page, "admin");
});

test("Stripe registry: complete ten-row batches, global sorting and first-seen filtering", async ({
  page,
  isMobile,
}) => {
  const rows = Array.from({ length: 27 }, (_, i) => ({
    id: `cus_${String(i).padStart(2, "0")}`,
    name: `Familie ${String(i).padStart(2, "0")}`,
    email: `family${i}@example.invalid`,
    assigned: i >= 23,
    first_seen_at: new Date(Date.now() - i * 86400000).toISOString(),
  }));
  const stripeOrder = [...rows]
    .reverse()
    .map((c) => ({ id: c.id, created: 1760000000 }));
  const calls: (string | null)[] = [];
  await page.route("**/api/admin/stripe-customers*", async (route) => {
    if (route.request().method() === "POST") {
      const after = route.request().postDataJSON().after ?? null;
      calls.push(after);
      await route.fulfill({
        json: {
          count: after ? 7 : 20,
          next_cursor: after ? null : "cus_07",
          customers: after ? stripeOrder.slice(20) : stripeOrder.slice(0, 20),
        },
      });
    } else await route.fulfill({ json: { rows } });
  });
  await page.route("**/api/admin/stripe-customer-detail*", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    await route.fulfill({
      json: {
        ...rows.find((r) => r.id === id),
        family_matches: [],
        subscriptions: [],
      },
    });
  });
  await page.goto("/admin/stripe");
  await page.getByRole("button", { name: "Kunden laden", exact: true }).click();
  await expect(page.getByText(/Bestand vollständig geladen/)).toBeVisible();
  expect(calls).toEqual([null, "cus_07"]);
  await expect(page.locator(".account-row:visible")).toHaveCount(10);
  await page.getByRole("button", { name: "10 weitere anzeigen" }).click();
  await expect(page.locator(".account-row:visible")).toHaveCount(20);
  await page.getByRole("button", { name: "10 weitere anzeigen" }).click();
  await expect(page.locator(".account-row:visible")).toHaveCount(23);
  expect(
    new Set(await page.locator(".account-row:visible b").allTextContents())
      .size,
  ).toBe(23);
  expect(
    await page.locator(".account-row:visible b").allTextContents(),
  ).toEqual(
    rows
      .slice(0, 23)
      .reverse()
      .map((c) => c.name),
  );
  await page.getByRole("button", { name: /Im Portal hinzugefügt/ }).click();
  await expect(page.locator(".account-row:visible b").first()).toHaveText(
    "Familie 00",
  );
  await page.getByRole("button", { name: /Im Portal hinzugefügt/ }).click();
  await expect(page.locator(".account-row:visible b").first()).toHaveText(
    "Familie 22",
  );
  await page.getByRole("button", { name: "Name A–Z", exact: true }).click();
  await page.getByRole("button", { name: "Name A–Z", exact: true }).click();
  await expect(page.locator(".account-row:visible b").first()).toHaveText(
    "Familie 22",
  );
  await page.getByRole("searchbox").fill("Familie 21");
  await expect(page.locator(".account-row:visible")).toHaveCount(1);
  await page.getByRole("button", { name: "Zuordnen", exact: true }).click();
  await expect(
    page.getByLabel("Name des Elternteils", { exact: true }),
  ).toHaveValue("Familie 21");
  await page.getByRole("button", { name: "Dialog schließen" }).click();
  await page.getByRole("searchbox").fill("");
  await page.getByText("Bereits zugeordnet · 4").click();
  await expect(
    page.locator(".stripe-assigned .account-row:visible"),
  ).toHaveCount(4);
  await page.getByLabel("In den letzten 14 Tagen erstmals erfasst").check();
  await expect(page.locator(".stripe-assigned .account-row")).toHaveCount(0);
  if (isMobile)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
});
