// Explicit, transactional release of the product schema. Credentials stay server-side.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const apply = process.argv.includes("--apply");
const project = process.env.PRODUCT_RELEASE_PROJECT_REF;
if (!project || !/^[a-z]{20}$/.test(project))
  throw Error(
    "Set PRODUCT_RELEASE_PROJECT_REF explicitly; default is dry-run.",
  );
const token =
  process.env.SUPABASE_ACCESS_TOKEN ||
  execFileSync(
    "security",
    ["find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
async function sql(query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(120000),
    },
  );
  if (!response.ok)
    throw Error(
      `Migration failed (${response.status}): ${await response.text()}`,
    );
  return response.json();
}
const files = [
  "022-product-management",
  "023-product-checkout-hardening",
  "024-product-catalog-isolation",
  "025-product-payment-consistency",
  "026-product-grant-preview",
  "027-product-workflows",
  "028-product-payment-review",
  "029-product-production-shop",
  "030-stripe-notice-decisions",
  "031-product-guest-checkout",
  "032-product-presentation",
];
const history = await sql(
  "select version,statements from supabase_migrations.schema_migrations where version between '202610260022' and '202610290032' order by version",
);
const migrations = files.map((file) => {
  const source = readFileSync(`supabase/release/${file}.sql`, "utf8");
  const version =
    (Number(file.slice(0, 3)) >= 32
      ? "20261029"
      : Number(file.slice(0, 3)) >= 30
        ? "20261027"
        : "20261026") + file.slice(0, 3).padStart(4, "0");
  const existing = history.find((row) => row.version === version);
  if (existing && existing.statements?.[0] !== source)
    throw Error(`Migration ${version} has changed since application.`);
  return {
    file,
    source,
    version,
    installed: !!existing,
    sha256: createHash("sha256").update(source).digest("hex"),
  };
});
const snapshot = await sql(`select
 (select jsonb_agg(jsonb_build_object('key',key,'value',value) order by key) from system_settings where key in ('portal_delivery_release','camp_mail_release','training_reminder_release')) delivery,
 (select md5(string_agg(id::text||coalesce(auth_user_id::text,'')||notifications_held::text,',' order by id)) from parents) parent_state,
 (select jsonb_agg(jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid))) from pg_proc where pronamespace='public'::regnamespace and proname in('trial_convert_for_review','resolve_subscription_assignment_before_trials','apply_stripe_package_sync')) functions,
 (select count(*) from subscriptions) subscriptions,
 (select count(*) from entitlement_periods) periods,
 (select count(*) from camp_bookings) camps`);
mkdirSync("output/products-release", { recursive: true });
writeFileSync(
  `output/products-release/db-${apply ? "apply" : "dry-run"}-before.private.json`,
  JSON.stringify(snapshot),
  { mode: 0o600 },
);
let query =
  "begin; set local lock_timeout='5s'; set local statement_timeout='60s'; select pg_advisory_xact_lock(202610260022);\n";
for (const m of migrations.filter((m) => !m.installed)) {
  query +=
    m.source.replace(/^begin;\s*$/gim, "").replace(/^commit;\s*$/gim, "") +
    "\n";
  query += `insert into supabase_migrations.schema_migrations(version,name,statements) values('${m.version}','${m.file.slice(4)}',array[$product_release_history$${m.source}$product_release_history$]);\n`;
}
// A local setup remains test-only; the explicit production release selects live mode.
query += "update public.product_runtime set livemode=true where singleton;\n";
query += apply ? "commit;" : "rollback;";
await sql(query);
const result = {
  at: new Date().toISOString(),
  project,
  applied: apply,
  migrations: migrations.map(({ source, ...m }) => m),
};
writeFileSync(
  `output/products-release/migration-${apply ? "applied" : "checked"}.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
