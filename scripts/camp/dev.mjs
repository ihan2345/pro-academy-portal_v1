import fs from "node:fs";
import { spawn } from "node:child_process";
try {
  process.loadEnvFile(".env.camp.local");
} catch {}
const port = process.env.CAMP_PORT || "3108";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CAMP_LOCAL_ENABLED: "true",
      CAMP_DEPLOYMENT_ENABLED: "false",
      CAMP_PROCESSING_ENABLED: "false",
      CAMP_REVIEW_ENABLED: "false",
      CAMP_STRIPE_MODE: "test",
      CAMP_LIVE_PAYMENTS_ENABLED: "false",
      CAMP_SIDE_EFFECTS_BLOCKED: "true",
      APP_URL: `http://127.0.0.1:${port}`,
      NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
      JOBS_ENABLED: "false",
      STRIPE_SYNC_ONLY: "false",
      MAIL_PROVIDER: "capture",
      APP_MODE: "test",
    },
  },
);
const review =
  process.env.CAMP_LOCAL_REVIEW_ENABLED === "true"
    ? spawn(process.execPath, ["scripts/camp/stripe-review.mjs"], {
        stdio: "inherit",
        env: {
          ...process.env,
          NODE_ENV: "development",
          CAMP_REVIEW_PARENT_PID: String(process.pid),
          CAMP_SIDE_EFFECTS_BLOCKED: "true",
          CAMP_DEPLOYMENT_ENABLED: "false",
          CAMP_PROCESSING_ENABLED: "false",
          CAMP_REVIEW_ENABLED: "false",
        },
      })
    : null;
review?.on("exit", (code) => {
  if (code)
    console.error(
      "Lokaler Camp-Abgleich beendet. Prüfstand in der Camp-Ansicht kontrollieren.",
    );
});
fs.writeFileSync(
  "output/camp-v0/runtime.json",
  JSON.stringify({
    pid: process.pid,
    childPid: child.pid,
    reviewPid: review?.pid ?? null,
    cwd: process.cwd(),
    port,
  }),
  { mode: 0o600 },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    child.kill(signal);
    review?.kill(signal);
  });
child.on("exit", (code) => {
  if (!review || review.exitCode !== null || review.signalCode !== null)
    process.exit(code ?? 0);
  review.once("exit", () => process.exit(code ?? 0));
  review.kill("SIGTERM");
  setTimeout(() => {
    review.kill("SIGKILL");
    process.exit(code ?? 0);
  }, 2000).unref();
});
