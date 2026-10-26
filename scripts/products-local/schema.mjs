import { readdirSync, readFileSync } from "node:fs";
export function productSchemaFiles() {
  const files = readdirSync("supabase/migrations").sort();
  return [
    ...files
      .filter((f) => f < "202609230010")
      .map((f) => `supabase/migrations/${f}`),
    "supabase/release/001-onboarding-mail.sql",
    ...readdirSync("supabase/camp")
      .filter((f) => /^\d{3}-/.test(f) && f !== "001-down.sql")
      .sort()
      .map((f) => `supabase/camp/${f}`),
    ...files
      .filter((f) => f >= "202609230010")
      .map((f) => `supabase/migrations/${f}`),
    ...[
      "002-v2-backfill-mail.sql",
      "005-training-notifications.sql",
      "006-manual-training-recipient-exception.sql",
      "007-staff-training-confirmations.sql",
      "008-training-planning-grace.sql",
      "009-parent-email-preference.sql",
      "016-calendar-backfills.sql",
      "017-trial-training.sql",
      "011-subscription-package-changes.sql",
      "014-completed-subscription-reviews.sql",
      "015-legacy-tariff-confirmation.sql",
      "018-trial-profiles-feedback.sql",
      "019-trial-release-rules.sql",
      "020-trial-camp-access.sql",
      "021-trial-platform-switch.sql",
      "022-product-management.sql",
      "023-product-checkout-hardening.sql",
      "024-product-catalog-isolation.sql",
      "025-product-payment-consistency.sql",
      "026-product-grant-preview.sql",
      "027-product-workflows.sql",
      "028-product-payment-review.sql",
      "029-product-production-shop.sql",
    ].map((f) => `supabase/release/${f}`),
  ];
}
export async function applyProductSchema(exec) {
  for (const path of productSchemaFiles()) {
    try {
      await exec(readFileSync(path, "utf8"));
    } catch (e) {
      throw new Error(`${path}: ${e.message}`, { cause: e });
    }
  }
}
