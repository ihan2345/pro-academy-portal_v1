import { manualStampCardRequest } from "../../src/lib/manual-stamp-card";
import { jobMode, type JobFlags } from "../job-mode";

export interface RunnerEnv extends JobFlags {
  CRON_SECRET: string;
  JOBS_ENABLED: string;
  STRIPE_SYNC_ONLY?: string;
  ACCEPTANCE_TEST_ENABLED?: string;
  RUNNER: {
    getByName(name: string): { fetch(request: Request): Promise<Response> };
  };
}

async function authorized(request: Request, secret: string) {
  if (!secret || secret.length < 32) return false;
  const encoder = new TextEncoder();
  const [given, expected] = await Promise.all([
    crypto.subtle.digest(
      "SHA-256",
      encoder.encode(request.headers.get("authorization") ?? ""),
    ),
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${secret}`)),
  ]);
  const a = new Uint8Array(given),
    b = new Uint8Array(expected);
  return a.reduce((diff, value, i) => diff | (value ^ b[i]), 0) === 0;
}

export async function runnerRequest(request: Request, env: RunnerEnv) {
  const path = new URL(request.url).pathname;
  if (
    request.method !== "POST" ||
    !["/run", "/verify", "/test-run", "/stamp-card-send"].includes(path)
  )
    return new Response("Not found", { status: 404 });
  if (!(await authorized(request, env.CRON_SECRET)))
    return new Response("Unauthorized", { status: 401 });
  if (path === "/run" && jobMode(env) === "disabled")
    return new Response("Jobs disabled", { status: 503 });
  if (
    path === "/test-run" &&
    (env.JOBS_ENABLED !== "false" ||
      jobMode(env) !== "disabled" ||
      env.ACCEPTANCE_TEST_ENABLED !== "true")
  )
    return new Response("Bounded test disabled", { status: 503 });
  let body: string | undefined;
  if (path === "/stamp-card-send") {
    if (env.CAMP_SIDE_EFFECTS_BLOCKED === "true")
      return new Response("Manual delivery disabled", { status: 503 });
    try {
      const reader = request.body?.getReader();
      if (!reader) return new Response("Missing request", { status: 400 });
      let text = "";
      const decoder = new TextDecoder();
      let bytes = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024) {
          await reader.cancel();
          return new Response("Request too large", { status: 413 });
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      body = JSON.stringify(manualStampCardRequest.parse(JSON.parse(text)));
    } catch {
      return new Response("Invalid stamp card request", { status: 400 });
    }
  }
  // One stable instance for every trigger. Arbitrary URL paths cannot create instances.
  return env.RUNNER.getByName("proacademy-jobs").fetch(
    new Request(`http://runner${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CRON_SECRET}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body,
    }),
  );
}

export async function scheduledRun(env: RunnerEnv) {
  if (jobMode(env) === "disabled") return;
  const response = await runnerRequest(
    new Request("https://runner/run", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    }),
    env,
  );
  // An existing run already owns this batch; do not start a parallel retry.
  if (!response.ok && response.status !== 409)
    throw new Error(`Background run failed: ${response.status}`);
}
