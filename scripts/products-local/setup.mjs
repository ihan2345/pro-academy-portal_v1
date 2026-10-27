// Creates ONLY an independent local stack. Never reads the repository .env.local.
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  cpSync,
  symlinkSync,
  chmodSync,
} from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { applyProductSchema } from "./schema.mjs";
const root = resolve("output/product-management-local"),
  app = `${root}/app`,
  container = "supabase_db_pabyak-products-local";
mkdirSync(`${root}/supabase`, { recursive: true });
const config = `project_id = "pabyak-products-local"
[api]
enabled = true
port = 57321
schemas = ["public", "storage"]
[db]
port = 57322
major_version = 17
[db.seed]
enabled = false
[auth]
enabled = true
site_url = "http://127.0.0.1:3110"
additional_redirect_urls = ["http://127.0.0.1:3110/auth/callback"]
enable_signup = true
[auth.email]
enable_signup = true
enable_confirmations = true
[storage]
enabled = true
file_size_limit = "10MiB"
[studio]
enabled = false
[inbucket]
enabled = true
port = 57324
[analytics]
enabled = false
`;
writeFileSync(`${root}/supabase/config.toml`, config);
const cli = process.env.PRODUCTS_SUPABASE_CLI || "supabase";
if (process.argv.includes("--start")) {
  // Docker's default host binding is set BEFORE container creation.
  const network = "pabyak-products-loopback";
  try {
    execFileSync("docker", ["network", "inspect", network], {
      stdio: "ignore",
    });
  } catch {
    execFileSync(
      "docker",
      [
        "network",
        "create",
        "--opt",
        "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
        network,
      ],
      { stdio: "ignore" },
    );
  }
  execFileSync(
    cli,
    [
      "start",
      "--workdir",
      root,
      "--network-id",
      network,
      "-x",
      "realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}
execFileSync("python3", ["scripts/products-local/bind-loopback.py"], {
  stdio: "inherit",
});
const status = JSON.parse(
  execFileSync(cli, ["status", "--workdir", root, "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);
if (status.API_URL !== "http://127.0.0.1:57321")
  throw Error("Only the independent product localhost stack is allowed");
const info = JSON.parse(
  execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
)[0];
if (info.Name !== `/${container}`) throw Error("Wrong database");
// Check all stack ports before creating synthetic accounts.
const running = execFileSync(
  "docker",
  ["ps", "--filter", "name=pabyak-products-local", "--format", "{{.Names}}"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
for (const name of running) {
  const v = JSON.parse(
    execFileSync("docker", ["inspect", name], { encoding: "utf8" }),
  )[0];
  for (const bindings of Object.values(v.HostConfig.PortBindings ?? {}))
    for (const binding of bindings ?? [])
      if (binding.HostIp !== "127.0.0.1")
        throw Error(`Non-loopback port on ${name}; fix binding before setup`);
}
const sql = (query) =>
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
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
if (!sql("select to_regclass('public.catalog_products')").trim())
  await applyProductSchema((query) => sql(query));
if (
  !sql(
    "select 1 from information_schema.columns where table_schema='public' and table_name='product_purchase_intents' and column_name='channel'",
  ).trim()
)
  sql(
    readFileSync("supabase/release/023-product-checkout-hardening.sql", "utf8"),
  );
if (
  !sql(
    "select 1 from information_schema.columns where table_schema='public' and table_name='catalog_products' and column_name='published_sort_order'",
  ).trim()
)
  sql(
    readFileSync("supabase/release/024-product-catalog-isolation.sql", "utf8"),
  );
if (
  sql(
    "select coalesce((select value::text from system_settings where key='product_payment_schema_version'),'0')",
  ).trim() !== "25"
)
  sql(
    readFileSync(
      "supabase/release/025-product-payment-consistency.sql",
      "utf8",
    ),
  );
if (
  !sql(
    "select to_regprocedure('public.apply_product_grant_change(jsonb)')",
  ).trim()
)
  sql(readFileSync("supabase/release/026-product-grant-preview.sql", "utf8"));
if (
  sql(
    "select coalesce((select value::text from system_settings where key='product_workflow_schema_version'),'0')",
  ).trim() !== "27"
)
  sql(readFileSync("supabase/release/027-product-workflows.sql", "utf8"));
if (
  !sql(
    "select to_regprocedure('public.resolve_product_payment_review(jsonb)')",
  ).trim()
)
  sql(readFileSync("supabase/release/028-product-payment-review.sql", "utf8"));
if (!sql("select to_regclass('public.product_runtime')").trim())
  sql(readFileSync("supabase/release/029-product-production-shop.sql", "utf8"));
if (!sql("select to_regclass('public.stripe_notice_decisions')").trim())
  sql(readFileSync("supabase/release/030-stripe-notice-decisions.sql", "utf8"));
if (!sql("select to_regclass('public.product_guest_messages')").trim())
  sql(readFileSync("supabase/release/031-product-guest-checkout.sql", "utf8"));
mkdirSync(app, { recursive: true });
for (const path of [
  "src",
  "public",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "next-env.d.ts",
  "postcss.config.mjs",
])
  if (existsSync(path)) cpSync(path, `${app}/${path}`, { recursive: true });
mkdirSync(`${app}/scripts/camp`, { recursive: true });
cpSync(
  "scripts/camp/stripe-review-lib.mjs",
  `${app}/scripts/camp/stripe-review-lib.mjs`,
);
if (!existsSync(`${app}/node_modules`))
  symlinkSync(resolve("node_modules"), `${app}/node_modules`, "dir");
const env = [
  "APP_MODE=test",
  "APP_URL=http://127.0.0.1:3110",
  `NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${status.ANON_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}`,
  "PRODUCT_MANAGEMENT_ENABLED=true",
  "PRODUCT_PAYMENTS_ENABLED=false",
  "PRODUCT_GUEST_MAIL_ENABLED=true",
  "TRIAL_TRAINING_ENABLED=true",
  "JOBS_ENABLED=false",
  "STRIPE_SYNC_ONLY=false",
  "MAIL_PROVIDER=capture",
  "EMAIL_TEST_MODE=true",
  "EMAIL_TEST_RECIPIENT=nobody@example.invalid",
  "CAMP_PROCESSING_ENABLED=false",
  "LOCAL_PROFILE_STRIPE_READ=false",
];
// Explicitly supplied TEST secrets only. Never inherit STRIPE_SECRET_KEY.
const priorEnv = existsSync(`${app}/.env.local`)
  ? Object.fromEntries(
      readFileSync(`${app}/.env.local`, "utf8")
        .split("\n")
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    )
  : {};
env.push(
  "PRODUCT_IMAGE_PROCESSOR_URL=http://127.0.0.1:3111",
  `PRODUCT_IMAGE_PROCESSOR_SECRET=${priorEnv.PRODUCT_IMAGE_PROCESSOR_SECRET || randomBytes(32).toString("hex")}`,
);
const productKey =
  process.env.PRODUCT_STRIPE_SECRET_KEY || priorEnv.PRODUCT_STRIPE_SECRET_KEY;
if (productKey) {
  if (!/^(sk|rk)_test_/.test(productKey))
    throw Error("Only Stripe test keys allowed");
  env.push(
    `PRODUCT_STRIPE_SECRET_KEY=${productKey}`,
    "PRODUCT_PAYMENTS_ENABLED=true",
  );
}
if (
  process.env.PRODUCT_STRIPE_WEBHOOK_SECRET ||
  priorEnv.PRODUCT_STRIPE_WEBHOOK_SECRET
)
  env.push(
    `PRODUCT_STRIPE_WEBHOOK_SECRET=${process.env.PRODUCT_STRIPE_WEBHOOK_SECRET || priorEnv.PRODUCT_STRIPE_WEBHOOK_SECRET}`,
  );
writeFileSync(`${app}/.env.local`, env.join("\n") + "\n", { mode: 0o600 });
cpSync("scripts/products-local/network-guard.cjs", `${app}/network-guard.cjs`);
let layout = readFileSync(`${app}/src/app/layout.tsx`, "utf8");
layout = layout.replace(
  /(<body[^>]*>)/,
  '$1<div style={{position:"relative",zIndex:100,background:"#172133",color:"white",padding:"8px 20px",fontSize:12}}>Lokale Produkt-Testumgebung · erfundene Familien und Preisbeispiele · <a href="/lokaler-test" style={{color:"#8eff01"}}>Testkonto wechseln</a></div>',
);
writeFileSync(`${app}/src/app/layout.tsx`, layout);
// Test logins exist ONLY in the generated local copy, not in deployable source.
const db = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const privateFile = `${root}/accounts.private.json`;
let accounts = existsSync(privateFile)
  ? JSON.parse(readFileSync(privateFile, "utf8"))
  : [];
if (!accounts.length)
  for (const [key, role, name] of [
    ["admin", "admin", "Produktverwaltung"],
    ["staff", "staff", "Testcoach"],
    ["new", "parent", "Familie Neumann"],
    ["trial", "parent", "Familie Sommer"],
    ["subscriber", "parent", "Familie Berger"],
    ["mixed", "parent", "Familie Weber"],
    ["former", "parent", "Familie Winter"],
    ["camp", "parent", "Familie Roth"],
    ["foreign", "parent", "Familie Fremd"],
  ]) {
    const email = `${key}@products.example.invalid`,
      password = randomBytes(24).toString("base64url");
    const u = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (u.error) throw u.error;
    const uid = u.data.user.id;
    const profile = await db
      .from("profiles")
      .insert({ id: uid, full_name: name, role });
    if (profile.error) throw profile.error;
    let parentId = null;
    if (role === "parent") {
      const p = await db
        .from("parents")
        .insert({
          auth_user_id: uid,
          full_name: name,
          contact_email: email,
          notifications_held: true,
        })
        .select("id")
        .single();
      if (p.error) throw p.error;
      parentId = p.data.id;
    }
    accounts.push({
      key,
      role,
      name,
      email,
      password,
      user_id: uid,
      parent_id: parentId,
    });
  }
writeFileSync(privateFile, JSON.stringify(accounts), { mode: 0o600 });
chmodSync(privateFile, 0o600);
mkdirSync(`${app}/src/app/lokaler-test/session`, { recursive: true });
writeFileSync(
  `${app}/src/app/lokaler-test/session/route.ts`,
  `import { NextRequest,NextResponse } from "next/server";
import { sessionDb } from "@/lib/server/supabase";
import { readFileSync } from "node:fs";
export async function POST(req:NextRequest){
 if(req.headers.get("origin")!=="http://127.0.0.1:3110"||req.headers.get("host")!=="127.0.0.1:3110")return new Response(null,{status:403});
 const f=await req.formData();const a=JSON.parse(readFileSync(${JSON.stringify(privateFile)},"utf8")).find((x:any)=>x.key===f.get("key"));if(!a)return new Response(null,{status:400});
 const db=await sessionDb();const r=await db.auth.signInWithPassword({email:a.email,password:a.password});if(r.error)return new Response("Local login failed",{status:500});
 return NextResponse.redirect("http://127.0.0.1:3110/"+(a.role==="admin"?"admin/produkte":"produkte"),303);}
`,
);
writeFileSync(
  `${app}/src/app/lokaler-test/page.tsx`,
  `import Link from "next/link";export default function Page(){return <main style={{maxWidth:800,margin:"60px auto",padding:24}}><p>PROACADEMY · LOKALER PRODUKTTEST</p><h1>Testkonto auswählen</h1><p>Ausschließlich erfundene Familien. Kein produktiver Zugriff.</p>${accounts.map((a) => `<form action="/lokaler-test/session" method="post" style={{marginTop:16}}><input type="hidden" name="key" value="${a.key}"/><button className="primary-button">${a.name} · ${a.key}</button></form>`).join("")}<p><Link href="/produkte">Öffentliche Produktübersicht</Link></p></main>}`,
);
console.log(
  "Independent product app prepared: http://127.0.0.1:3110/lokaler-test. Only synthetic accounts; payments disabled unless explicit TEST key supplied.",
);
