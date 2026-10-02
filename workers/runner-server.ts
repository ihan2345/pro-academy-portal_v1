import { createServer } from "node:http";
import {
  manualStampCardRequest,
  type ManualStampCardRequest,
} from "../src/lib/manual-stamp-card";
import { HttpError } from "../src/lib/server/security";
import { timingSafeEqual } from "node:crypto";

export function createRunnerServer(options: {
  secret: string;
  enabled: () => boolean;
  run: () => Promise<{ ok: boolean; [key: string]: unknown }>;
  verify: () => Promise<unknown>;
  stampCard?: (
    input: ManualStampCardRequest,
  ) => Promise<{ id: string; captured: boolean }>;
  acceptance?: { enabled: () => boolean; run: () => Promise<unknown> };
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
    if (
      req.method !== "POST" ||
      !["/run", "/verify", "/test-run", "/stamp-card-send"].includes(
        req.url ?? "",
      )
    )
      return reply(404, { error: "Not found" });
    const given = Buffer.from(req.headers.authorization ?? ""),
      expected = Buffer.from(`Bearer ${options.secret}`);
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return reply(401, { error: "Unauthorized" });
    if (req.url === "/run" && !options.enabled())
      return reply(503, {
        error: "Jobs disabled until launch checks are complete",
      });
    if (
      req.url === "/test-run" &&
      (options.enabled() || !options.acceptance?.enabled())
    )
      return reply(503, { error: "Bounded test disabled" });
    let stampCard: ManualStampCardRequest | undefined;
    if (req.url === "/stamp-card-send") {
      if (!options.stampCard)
        return reply(503, { error: "Manual stamp card delivery unavailable" });
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1024) return reply(413, { error: "Request too large" });
          chunks.push(Buffer.from(chunk));
        }
        stampCard = manualStampCardRequest.parse(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
      } catch {
        return reply(400, { error: "Invalid stamp card request" });
      }
    }
    if (running) return reply(409, { error: "Job already running" });
    running = true;
    // Terminate the process on a stuck run. Never unlock while its work continues.
    const deadline = setTimeout(() => {
      reply(504, { error: "Job deadline exceeded" });
      options.onDeadline();
    }, options.maxRunMs ?? 240_000);
    deadline.unref();
    try {
      const result = stampCard
        ? { ok: true, ...(await options.stampCard!(stampCard)) }
        : req.url === "/verify"
          ? await options.verify()
          : req.url === "/test-run"
            ? await options.acceptance!.run()
            : await options.run();
      if (!res.writableEnded)
        reply((result as { ok?: boolean }).ok === false ? 500 : 200, result);
    } catch (error) {
      if (!res.writableEnded)
        reply(stampCard && error instanceof HttpError ? error.status : 500, {
          error:
            stampCard && error instanceof HttpError
              ? error.message
              : "Job failed",
        });
    } finally {
      clearTimeout(deadline);
      running = false;
    }
  });
}
