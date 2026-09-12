import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

// Credentials belong exclusively to the isolated local database, never the repository .env.local.
const root = resolve("output/eltern-kind-lokal");
export const localAccounts = JSON.parse(
  readFileSync(`${root}/accounts.private.json`, "utf8"),
).accounts as { key: string; name: string; children: string[]; role: string }[];
const values = Object.fromEntries(
  readFileSync(`${root}/app/.env.local`, "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [
      line.slice(0, line.indexOf("=")),
      line.slice(line.indexOf("=") + 1),
    ]),
);
if (values.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:55321")
  throw Error("E2E tests require the isolated localhost database");
export const localDb = createClient(
  values.NEXT_PUBLIC_SUPABASE_URL,
  values.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
export async function login(page: Page, key: string) {
  await page.goto("/lokaler-test");
  const account = localAccounts.find((a) => a.key === key)!;
  await page
    .locator("form")
    .filter({
      has: page.getByRole("heading", { name: account.name, exact: true }),
    })
    .getByRole("button")
    .click();
  await page.waitForURL(
    key === "admin" ? "**/admin" : key === "trainer" ? "**/team" : "**/konto",
  );
}
export const twoChildFamily = localAccounts.find(
  (a) => a.role === "parent" && a.children.length === 2,
)!;
