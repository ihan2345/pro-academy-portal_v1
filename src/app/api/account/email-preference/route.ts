import { sessionUser } from "@/lib/server/supabase";
import { requireOrigin } from "@/lib/server/security";
import { z } from "zod";

async function handle(request: Request) {
  try {
    if (request.method === "POST") requireOrigin(request);
    const s = await sessionUser();
    if (s?.role !== "parent")
      return Response.json(
        { error: "Bitte als Elternteil anmelden." },
        { status: 403 },
      );
    const result =
      request.method === "POST"
        ? await s.db.rpc("set_my_email_preference", {
            wanted: z
              .object({ enabled: z.boolean() })
              .parse(await request.json()).enabled,
          })
        : await s.db.rpc("my_email_preference");
    if (result.error) throw result.error;
    return Response.json(
      { enabled: result.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        error:
          "E-Mail-Einstellung konnte nicht geladen oder gespeichert werden. Bitte erneut versuchen.",
      },
      { status: 400 },
    );
  }
}
export const GET = handle;
export const POST = handle;
