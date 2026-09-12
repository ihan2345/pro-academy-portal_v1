// Builds an isolated copy. No local login bypass is added to the deployable application.
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  existsSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const root = resolve("output/eltern-kind-lokal"),
  app = `${root}/app`;
const status = JSON.parse(
  execFileSync(
    "npx",
    ["--yes", "supabase", "status", "--workdir", root, "-o", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ),
);
if (status.API_URL !== "http://127.0.0.1:55321")
  throw Error("Only isolated localhost API allowed");
mkdirSync(app, { recursive: true });
rmSync(`${app}/src`, { recursive: true, force: true });
rmSync(`${app}/.next`, { recursive: true, force: true });
for (const file of [
  "src",
  "public",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "next-env.d.ts",
  "postcss.config.mjs",
])
  if (existsSync(file)) cpSync(file, `${app}/${file}`, { recursive: true });
if (!existsSync(`${app}/node_modules`))
  symlinkSync(resolve("node_modules"), `${app}/node_modules`, "dir");
writeFileSync(
  `${app}/.env.local`,
  [
    "LOCAL_FAMILY_TEST=true",
    "APP_MODE=test",
    "APP_URL=http://127.0.0.1:3107",
    `NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${status.ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}`,
    "EMAIL_TEST_MODE=true",
    "EMAIL_TEST_RECIPIENT=nobody@example.invalid",
    "AUTH_TEST_EMAILS=",
    "WHATSAPP_NUMBER=",
  ].join("\n") + "\n",
  { mode: 0o600 },
);
for (const [template, destination] of [
  ["page.tsx.template", "src/app/lokaler-test/page.tsx"],
  ["route.ts.template", "src/app/lokaler-test/session/route.ts"],
]) {
  const dest = `${app}/${destination}`;
  mkdirSync(dest.slice(0, dest.lastIndexOf("/")), { recursive: true });
  cpSync(`scripts/local-family-test/${template}`, dest);
}
let layout = readFileSync(`${app}/src/app/layout.tsx`, "utf8");
layout = layout.replace(
  "<body>{children}</body>",
  `<body><div style={{padding:"10px 20px",background:"#173a2a",color:"white",fontSize:14}}>Lokaler Test · echte Zuordnungsdaten vom 12.09.2026 · Versand gesperrt · <a href="/lokaler-test" style={{color:"white",textDecoration:"underline"}}>Konto wechseln</a></div>{children}</body>`,
);
writeFileSync(`${app}/src/app/layout.tsx`, layout);
let api = readFileSync(`${app}/src/app/api/[...path]/route.ts`, "utf8");
api = api.replace(
  "  try {",
  '  try {\n    if (path.startsWith("stripe/") || path === "admin/stripe-customers" || path === "admin/stripe-link" || path === "auth/login" || path === "cron") return json({error:"Im lokalen Test sind Stripe-Verbindungen und Mailversand gesperrt. Konto über ‚Konto wechseln‘ öffnen."}, 403);',
);
writeFileSync(`${app}/src/app/api/[...path]/route.ts`, api);
// No production fetch can leave this Node process, even if an environment variable is later changed accidentally.
cpSync(
  "scripts/local-family-test/network-guard.cjs",
  `${app}/network-guard.cjs`,
);
console.log(
  "Isolated app prepared; no Stripe, SMTP or production keys copied.",
);
