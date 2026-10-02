import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunnerServer } from "../workers/runner-server";
import { runnerRequest, scheduledRun } from "../workers/cloudflare/gateway";
import type { Server } from "node:http";

const secret = "test-only-".repeat(5);
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
async function setup(
  overrides: Partial<Parameters<typeof createRunnerServer>[0]> = {},
) {
  const run = vi.fn(async () => ({ ok: true, stripe: 0 }));
  const verify = vi.fn(async () => ({ ok: true, checks: { smtp: true } }));
  const options = {
    secret,
    enabled: () => true,
    run,
    verify,
    onDeadline: vi.fn(),
    ...overrides,
  };
  const server = createRunnerServer(options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const call = (path: string, auth = secret, method = "POST", body?: string) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      body,
      headers: { Authorization: `Bearer ${auth}` },
    });
  return { ...options, call };
}

describe("Node job runner", () => {
  it("delivers only the explicit manual card while regular jobs are disabled", async () => {
    const scope = {
      job_id: crypto.randomUUID(),
      actor_id: crypto.randomUUID(),
    };
    const stampCard = vi.fn(async () => ({ id: scope.job_id, captured: true }));
    const { call, run } = await setup({ enabled: () => false, stampCard });
    expect(
      (await call("/stamp-card-send", "bad", "POST", JSON.stringify(scope)))
        .status,
    ).toBe(401);
    expect(
      (
        await call(
          "/stamp-card-send",
          secret,
          "POST",
          JSON.stringify({ ...scope, email: "foreign@example.com" }),
        )
      ).status,
    ).toBe(400);
    const response = await call(
      "/stamp-card-send",
      secret,
      "POST",
      JSON.stringify(scope),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      id: scope.job_id,
      captured: true,
    });
    expect(stampCard).toHaveBeenCalledExactlyOnceWith(scope);
    expect(run).not.toHaveBeenCalled();
  });
  it("isolates an explicitly enabled test from the normal runner and its lock", async () => {
    const bounded = vi.fn(async () => ({ ok: true, sent: 0 }));
    const { call, run } = await setup({
      enabled: () => false,
      acceptance: { enabled: () => true, run: bounded },
    });
    expect((await call("/test-run", "bad")).status).toBe(401);
    expect((await call("/run")).status).toBe(503);
    expect((await call("/test-run")).status).toBe(200);
    expect(bounded).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    const disabled = await setup({ enabled: () => false });
    expect((await disabled.call("/test-run")).status).toBe(503);
    const normal = await setup({
      acceptance: { enabled: () => true, run: bounded },
    });
    expect((await normal.call("/test-run")).status).toBe(503);
  });
  it("rejects missing/invalid authentication and exposes only harmless health data", async () => {
    const { call, run, verify } = await setup();
    expect((await call("/run", "bad")).status).toBe(401);
    expect((await call("/verify", "bad")).status).toBe(401);
    expect((await call("/unknown")).status).toBe(404);
    expect(await (await call("/health", "bad", "GET")).json()).toEqual({
      ok: true,
      enabled: true,
      running: false,
    });
    expect(run).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
  it("allows connection verification while processing remains disabled", async () => {
    const { call, run, verify } = await setup({ enabled: () => false });
    expect((await call("/run")).status).toBe(503);
    expect((await call("/verify")).status).toBe(200);
    expect(run).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledOnce();
  });
  it("rejects overlapping runs until the first task actually finishes", async () => {
    let finish!: (result: { ok: boolean }) => void;
    const { call } = await setup({
      run: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const first = call("/run");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect((await call("/run")).status).toBe(409);
    expect((await call("/verify")).status).toBe(409);
    finish({ ok: true });
    expect((await first).status).toBe(200);
  });
  it("terminates stuck work without allowing a concurrent retry", async () => {
    let finish!: (result: { ok: boolean }) => void;
    const { call, onDeadline } = await setup({
      maxRunMs: 20,
      run: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    expect((await call("/run")).status).toBe(504);
    expect(onDeadline).toHaveBeenCalledOnce();
    expect((await call("/run")).status).toBe(409);
    finish({ ok: true });
  });
  it("hides internal failure details and permits a subsequent run", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("secret internal details"))
      .mockResolvedValue({ ok: true });
    const { call } = await setup({ run });
    const error = await call("/run");
    expect(error.status).toBe(500);
    expect(await error.json()).toEqual({ error: "Job failed" });
    expect((await call("/run")).status).toBe(200);
  });
});

describe("Cloudflare runner gateway", () => {
  it("validates and forwards only the requested manual card, preserving other delivery blocks", async () => {
    const { env, fetch, getByName } = setupGateway("false");
    const scope = {
      job_id: crypto.randomUUID(),
      actor_id: crypto.randomUUID(),
    };
    const req = (body = JSON.stringify(scope), token = secret) =>
      new Request("https://jobs.example/stamp-card-send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
    expect((await runnerRequest(req(undefined, "bad"), env)).status).toBe(401);
    expect(
      (
        await runnerRequest(
          req(JSON.stringify({ ...scope, recipient: "foreign@example.com" })),
          env,
        )
      ).status,
    ).toBe(400);
    expect((await runnerRequest(req("x".repeat(1025)), env)).status).toBe(413);
    expect(
      (
        await runnerRequest(req(), {
          ...env,
          CAMP_SIDE_EFFECTS_BLOCKED: "true",
        })
      ).status,
    ).toBe(503);
    expect(getByName).not.toHaveBeenCalled();
    expect(
      (await runnerRequest(req(), { ...env, STRIPE_SYNC_ONLY: "true" })).status,
    ).toBe(200);
    const forwarded = (fetch.mock.calls as unknown as [Request][])[0][0];
    expect(forwarded.url).toBe("http://runner/stamp-card-send");
    expect(await forwarded.json()).toEqual(scope);
    expect((await runnerRequest(request("/run"), env)).status).toBe(503);
  });
  it("runs only the restricted schedule while broad jobs and test delivery stay disabled", async () => {
    const { env, fetch, getByName } = setupGateway("false");
    const restricted = {
      ...env,
      STRIPE_SYNC_ONLY: "true",
      ACCEPTANCE_TEST_ENABLED: "true",
    };
    expect(
      (await runnerRequest(request("/run", "wrong"), restricted)).status,
    ).toBe(401);
    expect((await runnerRequest(request("/test-run"), restricted)).status).toBe(
      503,
    );
    expect(getByName).not.toHaveBeenCalled();
    await scheduledRun(restricted);
    expect(getByName).toHaveBeenCalledOnce();
    expect((fetch.mock.calls as unknown as [Request][])[0][0].url).toBe(
      "http://runner/run",
    );
  });
  it("keeps cron inactive during the bounded test and forwards no caller scope", async () => {
    const { env, fetch, getByName } = setupGateway("false");
    expect((await runnerRequest(request("/test-run"), env)).status).toBe(503);
    expect(getByName).not.toHaveBeenCalled();
    const enabled = { ...env, ACCEPTANCE_TEST_ENABLED: "true" };
    await scheduledRun(enabled);
    expect(getByName).not.toHaveBeenCalled();
    expect(
      (
        await runnerRequest(
          new Request("https://jobs.example/test-run", {
            method: "POST",
            headers: { Authorization: `Bearer ${secret}` },
            body: '{"recipient":"foreign@example.com"}',
          }),
          enabled,
        )
      ).status,
    ).toBe(200);
    const forwarded = (fetch.mock.calls as unknown as [Request][])[0][0];
    expect(forwarded.url).toBe("http://runner/test-run");
    expect(await forwarded.text()).toBe("");
  });
  function setupGateway(enabled = "true") {
    const fetch = vi.fn(async () => new Response('{"ok":true}'));
    const getByName = vi.fn(() => ({ fetch }));
    return {
      env: {
        CRON_SECRET: secret,
        JOBS_ENABLED: enabled,
        RUNNER: { getByName },
      },
      fetch,
      getByName,
    };
  }
  const request = (path: string, auth = secret) =>
    new Request(`https://jobs.example${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth}` },
    });
  it("does not start containers for unauthorized, unknown or disabled requests", async () => {
    const { env, getByName } = setupGateway("false");
    expect((await runnerRequest(request("/run", "wrong"), env)).status).toBe(
      401,
    );
    expect((await runnerRequest(request("/anything"), env)).status).toBe(404);
    expect((await runnerRequest(request("/run"), env)).status).toBe(503);
    await scheduledRun(env);
    expect(getByName).not.toHaveBeenCalled();
  });
  it("routes verification and every run to one fixed instance", async () => {
    const { env, fetch, getByName } = setupGateway();
    await runnerRequest(request("/verify"), env);
    await scheduledRun(env);
    expect(getByName.mock.calls).toEqual([
      ["proacademy-jobs"],
      ["proacademy-jobs"],
    ]);
    const forwarded = fetch.mock.calls as unknown as [Request][];
    expect(forwarded[0][0].url).toBe("http://runner/verify");
    expect(forwarded[1][0].url).toBe("http://runner/run");
  });
  it("reports failed scheduled jobs but accepts already-running work", async () => {
    const { env, fetch } = setupGateway();
    fetch.mockResolvedValueOnce(new Response("busy", { status: 409 }));
    await expect(scheduledRun(env)).resolves.toBeUndefined();
    fetch.mockResolvedValueOnce(new Response("failed", { status: 500 }));
    await expect(scheduledRun(env)).rejects.toThrow("500");
  });
});
