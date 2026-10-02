import { deliverManualStampCard } from "./manual-stamp-card";
import { runJobs } from "./jobs";
import { createRunnerServer } from "./runner-server";
import { verifyRunnerConnections } from "./verify-connections";
import { acceptanceTestEnabled, runAcceptanceTest } from "./acceptance-test";
import { jobMode } from "./job-mode";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* Deployment injects environment variables directly. */
}
const server = createRunnerServer({
  secret: process.env.CRON_SECRET ?? "",
  enabled: () => jobMode(process.env) !== "disabled",
  run: runJobs,
  verify: verifyRunnerConnections,
  stampCard: deliverManualStampCard,
  acceptance: {
    enabled: acceptanceTestEnabled,
    run: () => runAcceptanceTest(),
  },
  onDeadline: () => process.exit(1),
});
server.listen(Number(process.env.JOB_RUNNER_PORT ?? 3001), "0.0.0.0", () =>
  console.log("ProAcademy job runner ready"),
);
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
