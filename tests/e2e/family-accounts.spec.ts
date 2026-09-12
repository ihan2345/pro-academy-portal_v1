import { test, expect } from "@playwright/test";
import { login, localDb, twoChildFamily } from "./local-test";

test("persists a child without birth year in the actual local database", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/admin/spieler");
  await page.getByRole("button", { name: "Neu anlegen" }).click();
  const suffix = crypto.randomUUID().slice(0, 8);
  await page.getByLabel("Vorname", { exact: true }).fill("E2E");
  await page.getByLabel("Nachname", { exact: true }).fill(suffix);
  await page.getByLabel("Altersklasse", { exact: true }).fill("U10");
  await expect(page.getByLabel("Geburtsjahr (optional)")).not.toHaveAttribute(
    "required",
  );
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/players") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const id = (await response.json()).id;
  try {
    await page.reload();
    await expect(
      page.getByRole("row").filter({ hasText: suffix }),
    ).toBeVisible();
    const { data, error } = await localDb
      .from("players")
      .select("birth_year")
      .eq("id", id)
      .single();
    expect(error).toBeNull();
    expect(data?.birth_year).toBeNull();
  } finally {
    const { error } = await localDb.from("players").delete().eq("id", id);
    if (error) throw error;
  }
});

test("shows both billing accounts without exposing a birth year", async ({
  page,
}) => {
  await login(page, twoChildFamily.key);
  await expect(
    page.getByRole("button", { name: /Abo für .* verwalten/ }),
  ).toHaveCount(2);
  await expect(page.locator("body")).not.toContainText("Geburtsjahr");
  await expect(page.locator("body")).not.toContainText("DEMO · TESTDATEN");
  const forbidden = await page.request.get("/api/admin/parents");
  expect(forbidden.status()).toBe(403);
});

test("family invitation queue stays held without usable links", async ({
  page,
}) => {
  await login(page, "admin");
  const response = await page.request.get("/api/admin/notification_jobs");
  expect(response.status()).toBe(200);
  const invitations = (await response.json()).rows.filter(
    (r: { kind: string }) => r.kind === "invitation",
  );
  expect(invitations).toHaveLength(84);
  expect(
    invitations.every((r: { status: string }) => r.status === "held"),
  ).toBe(true);
  const { data, error } = await localDb.from("parent_invitations").select("id");
  expect(error).toBeNull();
  expect(data).toHaveLength(0);
});
