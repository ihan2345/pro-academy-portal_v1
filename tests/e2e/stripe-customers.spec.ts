import { test, expect } from "@playwright/test";
import { login } from "./local-test";
test.beforeEach(async ({page}) => { await login(page, "admin"); });

test("Stripe customers: older pages, global name search and fresh search cursors", async ({
  page,
  isMobile,
}) => {
  const calls: { q: string | null; after: string | null }[] = [];
  const customer = (id: string, name: string) => ({
    id,
    name,
    email: `${id}@example.com`,
    subscriptions: [],
    ambiguous: false,
  });
  await page.route("**/api/admin/stripe-customers*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const q = params.get("q"),
      after = params.get("after");
    calls.push({ q, after });
    const result =
      q === "Ayhan"
        ? after
          ? { rows: [customer("cus_ayhan2", "Kaan Ayhan")], has_more: false }
          : {
              rows: [customer("cus_ayhan1", "Muhsin Ayhan")],
              has_more: true,
              next_cursor: "search_next",
            }
        : q
          ? { rows: [], has_more: false }
          : after
            ? { rows: [customer("cus_old", "Ältere Familie")], has_more: false }
            : {
                rows: [customer("cus_new", "Neue Familie")],
                has_more: true,
                next_cursor: "cus_new",
              };
    await route.fulfill({ json: result });
  });
  await page.goto("/admin/stripe");
  await page.getByRole("button", { name: "Kunden laden", exact: true }).click();
  await expect(page.getByText("Neue Familie", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Weitere Kunden laden" }).click();
  await expect(page.getByText("Ältere Familie", { exact: true })).toBeVisible();
  await expect(page.getByText("Neue Familie", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Weitere Kunden laden" }),
  ).toHaveCount(0);

  const search = page.getByRole("searchbox", {
    name: "Eltern nach Name oder E-Mail suchen",
  });
  await search.fill("Ayhan");
  await search.press("Enter");
  await expect(page.getByText("Muhsin Ayhan", { exact: true })).toBeVisible();
  await expect(page.getByText("Neue Familie", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Weitere Kunden laden" }).click();
  await expect(page.getByText("Kaan Ayhan", { exact: true })).toBeVisible();
  await expect(page.getByText("Muhsin Ayhan", { exact: true })).toBeVisible();
  if (isMobile)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  await page.screenshot({
    path: `test-results/stripe-search-${isMobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Zuordnen", exact: true })
    .first()
    .click();
  await expect(
    page.getByLabel("Name des Elternteils", { exact: true }),
  ).toHaveValue("Muhsin Ayhan");
  await page.getByRole("button", { name: "Dialog schließen" }).click();

  await search.fill("Unbekannt");
  await page.getByRole("button", { name: "Suchen", exact: true }).click();
  await expect(page.getByText(/Keine Kunden gefunden/)).toBeVisible();
  await expect(page.getByText("Kaan Ayhan", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Kunden laden", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByText("Neue Familie", { exact: true })).toBeVisible();
  expect(calls).toEqual([
    { q: null, after: null },
    { q: null, after: "cus_new" },
    { q: "Ayhan", after: null },
    { q: "Ayhan", after: "search_next" },
    { q: "Unbekannt", after: null },
    { q: null, after: null },
  ]);
});
