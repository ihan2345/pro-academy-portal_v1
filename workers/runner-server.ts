import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

export function createRunnerServer(options: {
  secret: string;
  enabled: () => boolean;
  run: () => Promise<{ ok: boolean; [key: string]: unknown }>;
  verify: () => Promise<unknown>;
  onDeadline: () => void;
  maxRunMs?: number;
}) {
  if (options.secret.length < 32)
    throw new Error("CRON_SECRET mit mindestens 32 Zeichen erforderlich.");
  let running = false;
  return createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    const reply = (status: number, body: unknown) => {
      res.writeHead(status);
      res.end(JSON.stringify(body));
    };
    // The health endpoint contains no customer data and never performs work.
    if (req.method === "GET" && req.url === "/health")
      return reply(200, { ok: true, enabled: options.enabled(), running });
    if (req.method !== "POST" || !["/run", "/verify"].includes(req.url ?? ""))
      return reply(404, { error: "Not found" });
    const given = Buffer.from(req.headers.authorization ?? ""),
      expected = Buffer.from(`Bearer ${options.secret}`);
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return reply(401, { error: "Unauthorized" });
    if (req.url === "/run" && !options.enabled())
      return reply(503, {
        error: "Jobs disabled until launch checks are complete",
      });
    if (running) return reply(409, { error: "Job already running" });
    running = true;
    // Terminate the process on a stuck run. Never unlock while its work continues.
    const deadline = setTimeout(() => {
      reply(504, { error: "Job deadline exceeded" });
      options.onDeadline();
    }, options.maxRunMs ?? 240_000);
    deadline.unref();
    try {
      const result =
        req.url === "/verify" ? await options.verify() : await options.run();
      if (!res.writableEnded)
        reply((result as { ok?: boolean }).ok === false ? 500 : 200, result);
    } catch {
      if (!res.writableEnded) reply(500, { error: "Job failed" });
    } finally {
      clearTimeout(deadline);
      running = false;
    }
  });
}
