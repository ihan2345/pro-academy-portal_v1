// Run after the implementation and verification, never as part of normal app startup.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const manifestPath = "output/camp-v0/manifest.json";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.reset_at)
  throw Error(
    "v0 already restored; create a new explicit baseline before working again",
  );
const sha = (b) => createHash("sha256").update(b).digest("hex");
const paths = [
  "package.json",
  "src/proxy.ts",
  "src/app/api/[...path]/route.ts",
  "src/components/portal.tsx",
  "src/lib/mail.ts",
  "src/lib/server/data.ts",
  "src/lib/types.ts",
  "workers/job-mode.ts",
  "next-env.d.ts",
  "tests/camps.test.ts",
  "tests/camp-review.test.ts",
  "docs/CAMP-LOCAL.md",
  "docs/CAMP-RELEASE.md",
  ".env.camp.local",
];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) walk(p);
    else paths.push(p);
  }
}
for (const dir of [
  "src/lib/camps",
  "src/components/camps",
  "src/app/camp",
  "src/app/camps",
  "src/app/api/camp",
  "scripts/camp",
  "supabase/camp",
])
  walk(dir);
manifest.touched = {};
for (const p of paths) {
  if (!fs.existsSync(p)) continue;
  const hash = sha(fs.readFileSync(p));
  if (hash !== manifest.baseline[p]) manifest.touched[p] = hash;
}
manifest.sealed_at = new Date().toISOString();
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), {
  mode: 0o600,
});
console.log(
  `Camp reset manifest sealed: ${Object.keys(manifest.touched).length} files; pre-existing README/V2/docs changes excluded.`,
);
