import "server-only";
import { createHmac } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { sessionDb } from "./supabase";
import { HttpError } from "./security";
import { required } from "./config";
import { isAllowedTestLogin } from "./auth-test-access";
import { completeLogin } from "./complete-login";

export async function limitLoginCode(request: Request, email: string) {
  if (
    process.env.NODE_ENV === "development" &&
    ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)
  )
    return;
  const { env } = getCloudflareContext();
  const limiter = (
    env as unknown as {
      CAMP_REQUEST_LIMIT?: {
        limit(input: { key: string }): Promise<{ success: boolean }>;
      };
    }
  ).CAMP_REQUEST_LIMIT;
  const ip = request.headers.get("cf-connecting-ip");
  if (!limiter || !ip)
    throw new HttpError(503, "Bitte versuche es später erneut.");
  // Separate per-account and per-IP buckets; no personal data in limiter keys.
  for (const value of [`email:${email}`, `ip:${ip}`]) {
    const key = createHmac("sha256", required("SUPABASE_SERVICE_ROLE_KEY"))
      .update(`login-code:${value}`)
      .digest("hex");
    if (!(await limiter.limit({ key })).success)
      throw new HttpError(
        429,
        "Bitte warte eine Minute und versuche es erneut.",
      );
  }
}

export async function verifyLoginCode(request: Request, body: unknown) {
  const { email, code } = z
    .object({
      email: z.email().trim().toLowerCase(),
      code: z
        .string()
        .regex(/^[0-9]{6}$/, "Bitte gib den sechsstelligen Code ein."),
    })
    .parse(body);
  if (!isAllowedTestLogin(email))
    throw new HttpError(
      400,
      "Im Testbetrieb sind nur die freigegebenen Test-E-Mail-Adressen zugelassen.",
    );
  await limitLoginCode(request, email);
  const db = await sessionDb();
  const { data, error } = await db.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });
  if (error || !data.session)
    throw new HttpError(
      400,
      "Der Code ist ungültig, abgelaufen oder bereits verwendet. Bitte prüfe ihn oder fordere einen neuen Code an.",
    );
  return { ok: true, redirect: await completeLogin(db) };
}
