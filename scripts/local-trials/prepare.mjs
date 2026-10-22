// Updates ONLY the established Docker test stack and ignored local app copy.
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  cpSync,
} from "node:fs";
const container = "supabase_db_pabyak-family-local";
const sql = (input) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input, encoding: "utf8" },
  );
const info = JSON.parse(
  execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
)[0];
for (const bindings of Object.values(info.HostConfig.PortBindings ?? {}))
  if (bindings.some((b) => b.HostIp !== "127.0.0.1"))
    throw Error("Only loopback test database allowed");
sql(
  "create table if not exists public.local_preview_releases(path text primary key,applied_at timestamptz default now()); revoke all on public.local_preview_releases from anon,authenticated;",
);
const files = [
  "supabase/release/001-onboarding-mail.sql",
  ...readdirSync("supabase/camp")
    .filter((f) => /^\d+-/.test(f) && !f.endsWith("-down.sql"))
    .sort()
    .map((f) => "supabase/camp/" + f),
  ...readdirSync("supabase/migrations")
    .filter((f) => f >= "202609230010")
    .sort()
    .map((f) => "supabase/migrations/" + f),
  ...[
    "002-v2-backfill-mail.sql",
    "005-training-notifications.sql",
    "006-manual-training-recipient-exception.sql",
    "007-staff-training-confirmations.sql",
    "008-training-planning-grace.sql",
    "009-parent-email-preference.sql",
    "009-one-time-continuation.sql",
    "011-subscription-package-changes.sql",
    "012-human-activities.sql",
    "014-completed-subscription-reviews.sql",
    "015-legacy-tariff-confirmation.sql",
    "016-calendar-backfills.sql",
    "017-trial-training.sql",
    "018-trial-profiles-feedback.sql",
    "019-trial-release-rules.sql",
    "020-trial-camp-access.sql",
  ].map((f) => "supabase/release/" + f),
];
// Older previews applied some files before migration tracking was introduced.
const known = {
  "202609230010_training_backfills.sql":
    "to_regclass('public.training_backfills') is not null",
  "202610040013_single_parent_assignment.sql":
    "to_regclass('public.parent_players_one_parent_per_player') is not null",
  "202610080001_parent_profile.sql":
    "to_regprocedure('public.update_parent_profile(uuid,text,text)') is not null",
  "202610100001_parent_child_edit.sql":
    "to_regprocedure('public.update_own_child_profile(uuid,uuid,text,text,integer,text)') is not null",
  "202610100002_profile_subscription_history.sql":
    "to_regclass('public.profile_subscription_history') is not null",
  "202610170001_pai.sql": "to_regclass('public.pai_config') is not null",
  "202610190001_platform_features.sql":
    "to_regclass('public.platform_features') is not null",
  "202610190002_pai_mascot.sql":
    "to_regprocedure('public.enforce_pai_feature_dependency()') is not null",
};
for (const [name, check] of Object.entries(known))
  if (sql("select " + check).trim() === "t")
    sql(
      `insert into public.local_preview_releases(path) values('supabase/migrations/${name}') on conflict do nothing`,
    );
const applied = new Set(
  sql("select path from public.local_preview_releases").trim().split("\n"),
);
for (const f of files) {
  if (applied.has(f)) continue;
  sql(readFileSync(f, "utf8"));
  sql(`insert into public.local_preview_releases(path) values('${f}')`);
  console.log("Local schema: " + f);
}
sql(readFileSync("scripts/local-trials/helpers.sql", "utf8"));
execFileSync(process.execPath, ["scripts/local-family-test/prepare.mjs"], {
  stdio: "inherit",
});
const app = "output/eltern-kind-lokal/app";
cpSync("workers", app + "/workers", { recursive: true });
mkdirSync(app + "/scripts/camp", { recursive: true });
cpSync(
  "scripts/camp/stripe-review-lib.mjs",
  app + "/scripts/camp/stripe-review-lib.mjs",
);
let env = readFileSync(app + "/.env.local", "utf8");
env +=
  "TRIAL_TRAINING_ENABLED=true\nMAIL_PROVIDER=capture\nJOBS_ENABLED=false\nCAMP_LOCAL_ENABLED=true\nCAMP_SIDE_EFFECTS_BLOCKED=true\nCAMP_DEPLOYMENT_ENABLED=true\nCAMP_PROCESSING_ENABLED=false\nCAMP_REVIEW_ENABLED=false\nCAMP_STRIPE_MODE=test\nCAMP_LIVE_PAYMENTS_ENABLED=false\n";
writeFileSync(app + "/.env.local", env, { mode: 0o600 });
for (const [from, to] of [
  ["page.tsx.template", "src/app/lokaler-test/probetraining/page.tsx"],
  ["route.ts.template", "src/app/lokaler-test/probetraining/action/route.ts"],
]) {
  const dest = app + "/" + to;
  mkdirSync(dest.slice(0, dest.lastIndexOf("/")), { recursive: true });
  cpSync("scripts/local-trials/" + from, dest);
}
let accounts = readFileSync(app + "/src/app/lokaler-test/page.tsx", "utf8");
accounts = accounts.replace(
  "<h1>",
  '<p><a href="/lokaler-test/probetraining">Probetraining testen · Formular, Mails und Zeitsimulation →</a></p><h1>',
);
writeFileSync(app + "/src/app/lokaler-test/page.tsx", accounts);
let layout = readFileSync(app + "/src/app/layout.tsx", "utf8");
layout = layout.replace(
  "<body>",
  '<body><div style={{padding:12,background:"#173a2a",color:"white"}}>Lokaler Test · <a href="/lokaler-test">Konto wechseln</a> · <a href="/lokaler-test/probetraining">Probetraining / Mailausgang</a></div>',
);
writeFileSync(app + "/src/app/layout.tsx", layout);
console.log(
  "Trial preview prepared at http://127.0.0.1:3107/lokaler-test/probetraining",
);

// Permit only local database actions needed by the full portal preview. Keep Stripe,
// SMTP, imports and background runners blocked by the existing preview guard.
let portalApi = readFileSync(app + "/src/app/api/[...path]/route.ts", "utf8");
portalApi = portalApi.replace(
  'path !== "auth/logout"',
  'path !== "auth/logout" && !(process.env.LOCAL_FAMILY_TEST === "true" && process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:55321" && ["team/events","team/attendance","team/cancel","team/confirm-all-attendance","team/validate-training-staff","admin/subscription-reviews"].includes(path))',
);
writeFileSync(app + "/src/app/api/[...path]/route.ts", portalApi);
