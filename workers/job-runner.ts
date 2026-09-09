import { runJobs } from "./jobs";
import { createRunnerServer } from "./runner-server";
import { verifyRunnerConnections } from "./verify-connections";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* Deployment injects environment variables directly. */
}
const server = createRunnerServer({
  secret: process.env.CRON_SECRET ?? "",
  enabled: () => process.env.JOBS_ENABLED === "true",
  run: runJobs,
  verify: verifyRunnerConnections,
  onDeadline: () => process.exit(1),
});
server.listen(Number(process.env.JOB_RUNNER_PORT ?? 3001), "0.0.0.0", () =>
  console.log("ProAcademy job runner ready"),
);
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
