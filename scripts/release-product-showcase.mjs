// Explicit release of the revocable showcase share; never creates an active token.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const project = process.env.PRODUCT_RELEASE_PROJECT_REF;
if (!project || !/^[a-z]{20}$/.test(project))
  throw Error("Set PRODUCT_RELEASE_PROJECT_REF explicitly.");
const token =
  process.env.SUPABASE_ACCESS_TOKEN ||
  execFileSync(
    "security",
    ["find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
const source = readFileSync(
  "supabase/release/041-product-showcase-embed.sql",
  "utf8",
);
async function sql(query) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(90000),
    },
  );
  if (!r.ok) throw Error(`Database release failed: HTTP ${r.status}`);
  return r.json();
}
const version = "202611020041";
const apply = process.argv.includes("--apply");
const history = await sql(
  `select statements from supabase_migrations.schema_migrations where version='${version}'`,
);
if (history[0]) {
  if (history[0].statements?.[0] !== source)
    throw Error("Installed migration differs from source.");
  console.log("Showcase schema already installed and verified.");
} else {
  await sql(`begin; set local lock_timeout='5s'; set local statement_timeout='60s'; select pg_advisory_xact_lock(202611020041);
${source.replace(/^begin;\s*$/gim, "").replace(/^commit;\s*$/gim, "")}
insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','product-showcase-embed',array[$showcase_source$${source}$showcase_source$]);
${apply ? "commit" : "rollback"};`);
  console.log(
    apply
      ? "Showcase schema applied. No active embed token created."
      : "Showcase schema dry-run passed (rolled back).",
  );
}
