import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { collectCampReview } from "./stripe-review-lib.mjs";

const directory = path.resolve("output/camp-v0");
const filename = path.join(directory, "stripe-review.private.json");
const lock = path.join(directory, "stripe-review.lock");
const once = process.argv.includes("--once");
if (
  process.env.CAMP_LOCAL_REVIEW_ENABLED !== "true" ||
  process.env.NODE_ENV !== "development" ||
  process.env.CAMP_SIDE_EFFECTS_BLOCKED !== "true" ||
  process.env.CAMP_DEPLOYMENT_ENABLED === "true"
)
  throw new Error("Local Camp review is not enabled");
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!/^(rk|sk)_live_/.test(key)) throw new Error("Live read key required");
const config = JSON.parse(
  fs.readFileSync(
    new URL("./stripe-review-links.json", import.meta.url),
    "utf8",
  ),
);
if (!config.links.length || config.interval_seconds < 60)
  throw new Error("Invalid review configuration");
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
if (fs.existsSync(lock)) {
  const previousPid = Number(fs.readFileSync(lock, "utf8"));
  let exists = false;
  if (Number.isInteger(previousPid) && previousPid > 0) {
    try {
      process.kill(previousPid, 0);
      exists = true;
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  }
  if (exists) throw new Error("A Camp review process is already running");
  fs.unlinkSync(lock);
}
fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
let snapshot = { records: [], checked_at: null, error: null };
try {
  snapshot = JSON.parse(fs.readFileSync(filename, "utf8"));
} catch {}
function save(extra) {
  snapshot = {
    ...snapshot,
    ...extra,
    pid: process.pid,
    interval_seconds: config.interval_seconds,
    sources: config.links.map(({ camp_id, payment_link_id }) => ({
      camp_id,
      payment_link_id,
    })),
  };
  const temporary = filename + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(snapshot, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(temporary, filename);
}
process.on("exit", () => {
  try {
    save({ running: false });
    if (fs.readFileSync(lock, "utf8") === String(process.pid))
      fs.unlinkSync(lock);
  } catch {}
});
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
const stripe = new Stripe(key, { timeout: 15000, maxNetworkRetries: 1 });
async function run() {
  // A killed launcher must not leave an orphaned recurring task.
  const parentPid = Number(process.env.CAMP_REVIEW_PARENT_PID);
  if (parentPid && process.ppid !== parentPid) process.exit(0);
  save({ running: true, attempted_at: new Date().toISOString() });
  try {
    const result = await collectCampReview(stripe, config.links);
    save({ ...result, checked_at: new Date().toISOString(), error: null });
    console.log(
      `Camp-Abgleich: ${result.records.length} bezahlte Zahlungen geprüft; keine Datenbankänderung.`,
    );
  } catch {
    // Preserve the last complete snapshot; never replace it with a partial fetch.
    save({
      error:
        "Stripe-Abgleich fehlgeschlagen. Der letzte vollständige Stand bleibt erhalten.",
    });
    console.error(
      "Camp-Abgleich fehlgeschlagen; erneuter Versuch beim nächsten Lauf.",
    );
    if (once) process.exitCode = 1;
  }
  if (!once) setTimeout(run, config.interval_seconds * 1000);
}
await run();
