import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readTrialGrant } from "@/lib/trials/tokens";
import { required } from "@/lib/server/config";
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
  trialRatingGrant,
  trialSavedFeedback,
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
    await requireTrials();
    const { action } = await context.params;
    if (request.method === "GET") {
      if (action === "team") return json(await trialTeamData());
      if (action === "summary") return json(await trialSummary());
      if (action === "welcome") return json(await trialWelcomeData());
      if (action === "rating") {
        const token = request.nextUrl.searchParams.get("token") ?? "";
        const g = await trialRatingGrant(token);
        return json(await trialSavedFeedback(g.family, g.request!, g.event!));
      }
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
    if (action === "resend") {
      const { email } = z
        .object({ email: z.email().trim().toLowerCase() })
        .parse(body);
      await limitTrial(request);
      trialResult(
        await serviceDb().rpc("queue_trial_access", { email_address: email }),
      );
      return json({ ok: true });
    }
    if (action === "team") return json(await manageTrial(body));
    if (action === "access") {
      const { token } = z.object({ token: z.string().max(1500) }).parse(body);
      const family = await trialFamily(token, false);
      const grant = readTrialGrant(
        token,
        required("SUPABASE_SERVICE_ROLE_KEY"),
        "login",
      )!;
      const consumed = await serviceDb().rpc("consume_trial_access", {
        nonce: grant.nonce,
        family: grant.family,
        parent: grant.parent,
      });
      if (consumed.error)
        throw new HttpError(
          401,
          "Der Link ist abgelaufen oder wurde bereits verwendet. Bitte fordere einen neuen Link an.",
        );
      await ensureTrialAuth(family);
      return json({ ok: true });
    }
    if (["feedback", "rating", "comment"].includes(action)) {
      const token = z.string().max(1500).optional().parse(body.token);
      const grant = token ? await trialRatingGrant(token) : null;
      const input = z
        .object({
          action: z.enum(["feedback", "comment"]),
          request_id: z.uuid(),
          event_id: z.uuid(),
          rating: z.number().int().min(1).max(5).optional(),
          feedback: z.string().trim().max(2000).default(""),
        })
        .parse(
          grant
            ? {
                action: action === "comment" ? "comment" : "feedback",
                request_id: grant.request,
                event_id: grant.event,
                rating: grant.rating,
                feedback: body.feedback,
              }
            : body,
        );
      if (input.action === "feedback" && !input.rating)
        throw new HttpError(400, "Bitte Bewertung wählen.");
      const family = grant?.family ?? (await trialFamily()).id;
      trialResult(
        await serviceDb().rpc("trial_parent_action", { family, input }),
      );
      return json(
        await trialSavedFeedback(family, input.request_id, input.event_id),
      );
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
