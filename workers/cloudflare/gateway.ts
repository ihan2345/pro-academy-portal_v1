export interface RunnerEnv {
  CRON_SECRET: string;
  JOBS_ENABLED: string;
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
    !["/run", "/verify", "/test-run"].includes(path)
  )
    return new Response("Not found", { status: 404 });
  if (!(await authorized(request, env.CRON_SECRET)))
    return new Response("Unauthorized", { status: 401 });
  if (path === "/run" && env.JOBS_ENABLED !== "true")
    return new Response("Jobs disabled", { status: 503 });
  if (
    path === "/test-run" &&
    (env.JOBS_ENABLED !== "false" || env.ACCEPTANCE_TEST_ENABLED !== "true")
  )
    return new Response("Bounded test disabled", { status: 503 });
  // One stable instance for every trigger. Arbitrary URL paths cannot create instances.
  return env.RUNNER.getByName("proacademy-jobs").fetch(
    new Request(`http://runner${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    }),
  );
}

export async function scheduledRun(env: RunnerEnv) {
  if (env.JOBS_ENABLED !== "true") return;
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
