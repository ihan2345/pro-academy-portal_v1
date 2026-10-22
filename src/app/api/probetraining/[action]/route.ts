import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { HttpError, requireOrigin } from "@/lib/server/security";
import { serviceDb } from "@/lib/server/service-db";
import {
  applyTrial,
  ensureTrialAuth,
  limitTrial,
  manageTrial,
  requireTrials,
  trialFamily,
  trialResult,
  trialTeamData,
  trialSummary,
  trialWelcomeData,
} from "@/lib/trials/server";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
async function handle(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  try {
    requireTrials();
    const { action } = await context.params;
    if (request.method === "GET") {
      if (action === "team") return json(await trialTeamData());
      if (action === "summary") return json(await trialSummary());
      if (action === "welcome") return json(await trialWelcomeData());
      throw new HttpError(404, "Nicht gefunden.");
    }
    requireOrigin(request);
    if (Number(request.headers.get("content-length") ?? 0) > 16000)
      throw new HttpError(413, "Anfrage zu groß.");
    const raw = await request.text();
    if (raw.length > 16000) throw new HttpError(413, "Anfrage zu groß.");
    const body = JSON.parse(raw);
    if (action === "apply")
      return json(await applyTrial(body, await limitTrial(request)));
    if (action === "team") return json(await manageTrial(body));
    if (action === "access") {
      const { token } = z.object({ token: z.string().max(110) }).parse(body);
      const family = await trialFamily(token, false);
      trialResult(
        await serviceDb().rpc("trial_parent_action", {
          family: family.id,
          input: { action: "verify" },
        }),
      );
      await ensureTrialAuth(family);
      (await cookies()).set("pa_trial", token, {
        httpOnly: true,
        secure: new URL(request.url).protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: 86400 * 30,
      });
      return json({ ok: true });
    }
    if (action === "feedback") {
      const input = z
        .object({
          action: z.literal("feedback"),
          request_id: z.uuid(),
          event_id: z.uuid(),
          rating: z.number().int().min(1).max(5),
          feedback: z.string().trim().max(2000).default(""),
        })
        .parse(body);
      const f = await trialFamily();
      trialResult(
        await serviceDb().rpc("trial_parent_action", { family: f.id, input }),
      );
      return json({ ok: true });
    }
    if (action === "unsubscribe") {
      const f = await trialFamily();
      trialResult(
        await serviceDb().rpc("trial_parent_action", {
          family: f.id,
          input: { action: "unsubscribe" },
        }),
      );
      return json({ ok: true });
    }
    throw new HttpError(404, "Nicht gefunden.");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return json(
        { error: e.issues[0]?.message ?? "Bitte Angaben prüfen." },
        400,
      );
    return json(
      {
        error:
          "Anfrage konnte nicht verarbeitet werden. Bitte versuche es erneut.",
      },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
