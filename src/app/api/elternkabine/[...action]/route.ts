import { NextRequest, NextResponse } from "next/server";
import { HttpError, requireOrigin } from "@/lib/server/security";
import * as ek from "@/lib/server/elternkabine";

export const runtime = "nodejs";
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

async function handler(
  request: NextRequest,
  context: { params: Promise<{ action: string[] }> },
) {
  const path = (await context.params).action.join("/");
  try {
    if (request.method === "GET") {
      if (path === "overview") return json(await ek.overview());
      if (path.startsWith("channel/"))
        return json(await ek.channelPosts(path.slice(8)));
      if (path === "co/remove-check") return json(await ek.coRemoveCheck());
      if (path === "alerts") return json(await ek.adminAlerts());
      if (path === "admin") return json(await ek.adminOverview());
      throw new HttpError(404, "Nicht gefunden.");
    }
    requireOrigin(request);
    const body = await request.json().catch(() => ({}));
    const actions: Record<string, (b: unknown) => Promise<unknown>> = {
      post: ek.createPost,
      edit: ek.editPost,
      delete: ek.deletePost,
      react: ek.react,
      report: ek.report,
      mute: ek.setMuted,
      me: ek.saveMe,
      family: ek.saveFamily,
      "co/preview": ek.coInvitePreview,
      "co/invite": ek.coInvite,
      "co/remove": ek.coRemove,
      "alerts/action": ek.alertAction,
      "admin/unlock": ek.adminUnlock,
      "admin/moderate": ek.moderate,
      "admin/settings": ek.adminSettings,
    };
    const run = actions[path];
    if (!run) throw new HttpError(404, "Nicht gefunden.");
    return json(await run(body));
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    if (error && typeof error === "object" && "issues" in error)
      return json({ error: "Bitte prüfe deine Eingaben." }, 400);
    console.error("elternkabine", error);
    return json(
      { error: "Das hat nicht geklappt. Bitte versuche es erneut." },
      500,
    );
  }
}
export const GET = handler;
export const POST = handler;
