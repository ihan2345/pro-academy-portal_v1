import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
try {
  process.loadEnvFile(".env.camp.local");
} catch {}
const root = process.cwd(),
  file = path.join(root, "output/camp-v0/manifest.json");
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const conflicts = [];
for (const [name, hash] of Object.entries(manifest.touched)) {
  const p = path.join(root, name);
  if (fs.existsSync(p) && sha(fs.readFileSync(p)) !== hash)
    conflicts.push(name);
}
if (conflicts.length)
  throw Error(
    "Seit Abschluss weitere Änderungen; zuerst gezielt zusammenführen: " +
      conflicts.join(", "),
  );
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const before = JSON.parse(
  fs.readFileSync("output/camp-v0/database-before.private.json"),
);
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== before.project)
  throw Error("Falsches Supabase-Projekt");
const installation = await db
  .from("camp_installation")
  .select("*")
  .maybeSingle();
const absent = installation.error?.code === "PGRST205";
if (installation.error && !absent)
  throw Error("Datenbankzustand unklar; Reset abgebrochen.");
const installed = !installation.error && !!installation.data;
if (installed) {
  const imports = await db
    .from("camp_bookings")
    .select("id", { count: "exact", head: true })
    .eq("booking_origin", "stripe_import");
  if (
    (imports.error && !["42703", "PGRST204"].includes(imports.error.code)) ||
    imports.count
  )
    throw Error(
      "Echte Stripe-Bestandsbuchungen vorhanden oder Importstatus unklar. Automatischer reset=v0 gesperrt; gezielten Rückbau prüfen.",
    );
}
if (installed && installation.data.version === "v2") {
  const live = await db
    .from("camps")
    .select("id", { count: "exact", head: true })
    .eq("payment_mode", "live");
  if (live.error || live.count || installation.data.live_payments_enabled)
    throw Error(
      "Live-Camp-Daten oder Live-Freigabe vorhanden. Camp-Funktion deaktivieren; reset=v0 ist gesperrt.",
    );
}
const assets = installed
  ? await db.from("camp_stripe_assets").select("*")
  : { data: [], error: null };
if (assets.error) throw Error("Stripe-Register nicht lesbar");
console.log(
  JSON.stringify(
    {
      mode: process.argv.includes("--dry-run") ? "Prüfung" : "reset=v0",
      campDatabaseInstalled: installed,
      trackedFiles: Object.keys(manifest.touched).length,
      stripeTestAssets: assets.data.length,
      existingPortalData: "wird nicht pauschal zurückgesetzt",
    },
    null,
    2,
  ),
);
if (process.argv.includes("--dry-run")) process.exit(0);
if (!process.argv.includes("reset=v0"))
  throw Error("Explizites reset=v0 erforderlich");
if (
  execFileSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  }).trim() !== manifest.branch
)
  throw Error("Anderer Branch aktiv; Reset nicht automatisch anwenden");
if (!Object.keys(manifest.touched).length)
  throw Error("Dateimanifest noch nicht versiegelt");
// Stop only the recorded Camp launcher when PID, command and working directory agree.
const runtimeFile = "output/camp-v0/runtime.json";
if (fs.existsSync(runtimeFile)) {
  const runtime = JSON.parse(fs.readFileSync(runtimeFile));
  let running = false;
  try {
    process.kill(runtime.pid, 0);
    running = true;
  } catch {}
  if (running) {
    const command = execFileSync(
      "ps",
      ["-p", String(runtime.pid), "-o", "command="],
      { encoding: "utf8" },
    );
    const cwd = execFileSync(
      "lsof",
      ["-a", "-p", String(runtime.pid), "-d", "cwd", "-Fn"],
      { encoding: "utf8" },
    );
    if (
      runtime.cwd !== root ||
      !command.includes("scripts/camp/dev.mjs") ||
      !cwd.split("\n").includes("n" + root)
    )
      throw Error("Lokalen Camp-Server zuerst manuell beenden");
    process.kill(runtime.pid, "SIGTERM");
    for (let n = 0; n < 30; n++) {
      try {
        process.kill(runtime.pid, 0);
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
if (assets.data.length) {
  const key = process.env.CAMP_STRIPE_SECRET_KEY ?? "";
  if (!/^(sk|rk)_test_/.test(key))
    throw Error("Nur Stripe-Testobjekte dürfen zurückgebaut werden");
  const stripe = new Stripe(key);
  // Deactivate externally reachable links first. Never refund or erase financial history.
  for (const a of assets.data.filter((a) => a.kind === "payment_link"))
    await stripe.paymentLinks.update(a.id, { active: false });
  for (const a of assets.data.filter((a) => a.kind === "promotion"))
    await stripe.promotionCodes.update(a.id, { active: false });
  for (const a of assets.data.filter((a) => a.kind === "price"))
    await stripe.prices.update(a.id, { active: false });
  for (const a of assets.data.filter((a) => a.kind === "product"))
    await stripe.products.update(a.id, { active: false });
  for (const a of assets.data.filter((a) => a.kind === "customer")) {
    const customer = await stripe.customers.retrieve(a.id);
    if (customer.deleted) continue;
    if (customer.livemode) throw Error("Live-Kunde wird niemals gelöscht");
    const subs = await stripe.subscriptions.list({
      customer: a.id,
      status: "all",
      limit: 1,
    });
    if (subs.data.length)
      throw Error("Camp-Testkunde hat inzwischen ein Abo; manuell prüfen");
    await stripe.customers.del(a.id);
  }
  for (const a of assets.data.filter((a) => a.kind === "coupon")) {
    try {
      await stripe.coupons.del(a.id);
    } catch (e) {
      if (e.code !== "resource_missing") throw e;
    }
  }
  fs.writeFileSync(
    "output/camp-v0/stripe-reset.private.json",
    JSON.stringify({ at: new Date().toISOString(), assets: assets.data }),
    { mode: 0o600 },
  );
}
if (installed) {
  const result = await db.rpc("camp_reset_v0");
  if (result.error)
    throw Error(
      "Datenbank-Reset wurde sicher abgebrochen: " + result.error.message,
    );
  const verify = await db.from("camp_installation").select("version");
  if (verify.error?.code !== "PGRST205")
    throw Error("Schema-Rückbau noch nicht bestätigt; Code bleibt erhalten");
}
// Restore only Camp-touched files, including the original uncommitted v0 versions.
for (const name of Object.keys(manifest.touched)) {
  const p = path.join(root, name),
    source = path.join(root, "output/camp-v0/files", name);
  if (manifest.baseline[name]) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.copyFileSync(source, p);
  } else if (fs.existsSync(p)) fs.unlinkSync(p);
}
fs.rmSync(".next", { recursive: true, force: true });
fs.rmSync("tsconfig.tsbuildinfo", { force: true });
manifest.reset_at = new Date().toISOString();
manifest.database_applied = false;
fs.writeFileSync(file, JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(
  "v0 wiederhergestellt. Lokalen Dev-Server neu starten. Stripe-Testhistorie, Datenbank-Audit und private Rückbausicherung bleiben nachvollziehbar erhalten.",
);
