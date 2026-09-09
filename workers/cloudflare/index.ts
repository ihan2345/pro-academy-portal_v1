import { Container } from "@cloudflare/containers";
import { runnerRequest, scheduledRun, type RunnerEnv } from "./gateway";

type Env = RunnerEnv & Record<string, unknown>;
const forwarded = [
  "APP_URL",
  "APP_MODE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "CRON_SECRET",
  "JOBS_ENABLED",
  "MAIL_PROVIDER",
  "EMAIL_TEST_MODE",
  "EMAIL_TEST_RECIPIENT",
  "EMAIL_FROM",
  "PROTON_SMTP_HOST",
  "PROTON_SMTP_PORT",
  "PROTON_SMTP_USER",
  "PROTON_SMTP_TOKEN",
  "WHATSAPP_NUMBER",
  "REPORT_SEND_TIME",
] as const;

export class ProAcademyRunner extends Container<Env> {
  defaultPort = 3001;
  sleepAfter = "30s";
  enableInternet = true; // Required for Proton STARTTLS on TCP 587.
  envVars = Object.fromEntries([
    ["NODE_ENV", "production"],
    ["JOB_RUNNER_PORT", "3001"],
    ...forwarded
      .filter((key) => typeof this.env[key] === "string")
      .map((key) => [key, this.env[key] as string]),
  ]);
  private busy = false;
  private startedAt = 0;

  override async onActivityExpired() {
    if (this.busy && Date.now() - this.startedAt < 300_000) {
      this.renewActivityTimeout();
      return;
    }
    await this.stop();
  }

  override async fetch(request: Request) {
    if (this.busy) return new Response("Job already running", { status: 409 });
    this.busy = true;
    this.startedAt = Date.now();
    try {
      const response = await this.containerFetch(request);
      const body = await response.text();
      return new Response(body, {
        status: response.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return new Response('{"error":"Runner unavailable"}', { status: 502 });
    } finally {
      // Keep the lock until the process has stopped; a second request cannot be killed by this stop.
      try {
        await this.stop();
      } finally {
        this.busy = false;
      }
    }
  }
}

export default {
  fetch: runnerRequest,
  scheduled(
    _event: unknown,
    env: Env,
    ctx: { waitUntil(task: Promise<void>): void },
  ) {
    ctx.waitUntil(scheduledRun(env));
  },
};
