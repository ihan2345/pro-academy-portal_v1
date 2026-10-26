// Build validation from a clean source copy. No production env, login bypass or deployment config.
import {
  mkdirSync,
  cpSync,
  existsSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
const root = resolve("output/product-management-build");
mkdirSync(root, { recursive: true });
for (const p of [
  "src",
  "public",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next-env.d.ts",
  "next.config.ts",
  "postcss.config.mjs",
  "open-next.config.ts",
])
  if (existsSync(p)) cpSync(p, `${root}/${p}`, { recursive: true });
mkdirSync(`${root}/scripts/camp`, { recursive: true });
cpSync(
  "scripts/camp/stripe-review-lib.mjs",
  `${root}/scripts/camp/stripe-review-lib.mjs`,
);
if (!existsSync(`${root}/node_modules`))
  symlinkSync(resolve("node_modules"), `${root}/node_modules`, "dir");
const lines = readFileSync(
  "output/product-management-local/app/.env.local",
  "utf8",
).split("\n");
const keep = lines.filter((l) =>
  /^(APP_MODE|APP_URL|NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|TRIAL_TRAINING_ENABLED|EMAIL_TEST_MODE|MAIL_PROVIDER)=/.test(
    l,
  ),
);
if (
  !keep.includes("NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:57321") ||
  !keep.includes("APP_MODE=test")
)
  throw Error("Independent local build configuration required");
writeFileSync(
  `${root}/.env.local`,
  keep
    .concat([
      "PRODUCT_MANAGEMENT_ENABLED=true",
      "PRODUCT_PAYMENTS_ENABLED=false",
      "JOBS_ENABLED=false",
    ])
    .join("\n") + "\n",
  { mode: 0o600 },
);
writeFileSync(
  `${root}/wrangler.jsonc`,
  JSON.stringify({
    name: "proacademy-products-local-build",
    main: ".open-next/worker.js",
    compatibility_date: "2026-09-01",
    compatibility_flags: ["nodejs_compat"],
    assets: { directory: ".open-next/assets", binding: "ASSETS" },
    vars: { APP_MODE: "test" },
  }),
);
if (process.argv.includes("--cloudflare")) {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
  pkg.scripts.build = "next build";
  writeFileSync(`${root}/package.json`, JSON.stringify(pkg, null, 2));
}
let nextConfig = readFileSync(`${root}/next.config.ts`, "utf8");
nextConfig = nextConfig.replace(
  "const config: NextConfig = {",
  `const config: NextConfig = { turbopack: { root: ${JSON.stringify(resolve("."))} }, outputFileTracingRoot: ${JSON.stringify(resolve("."))},`,
);
writeFileSync(`${root}/next.config.ts`, nextConfig);
const command = process.argv.includes("--cloudflare")
  ? "build:cloudflare"
  : "build";
const child = spawn("npm", ["run", command], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    ...Object.fromEntries(
      keep.map((l) => [
        l.slice(0, l.indexOf("=")),
        l.slice(l.indexOf("=") + 1),
      ]),
    ),
    PRODUCT_PAYMENTS_ENABLED: "false",
    PRODUCT_STRIPE_SECRET_KEY: "",
    STRIPE_SECRET_KEY: "",
    CAMP_STRIPE_SECRET_KEY: "",
    CAMP_STRIPE_READ_KEY: "",
    LOCAL_PROFILE_STRIPE_READ: "false",
    NEXT_TELEMETRY_DISABLED: "1",
    WRANGLER_SEND_METRICS: "false",
    NODE_OPTIONS: `--require=${resolve("scripts/products-local/network-guard.cjs")}`,
  },
});
child.on("exit", (c) => process.exit(c ?? 0));
