import { viewerRoute } from "@/lib/server/viewer";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { sessionUser } from "@/lib/server/supabase";
import { assertRole, requireOrigin, HttpError } from "@/lib/server/security";
import { required } from "@/lib/server/config";
const headers = { "Cache-Control": "private, no-store" };
async function handle(request: Request, write: boolean) {
  try {
    if (write) requireOrigin(request);
    const session = await sessionUser();
    assertRole(session?.role, "admin");
    // Der Link öffnet alle Spielerdaten ohne Anmeldung: nie für Lese-Konten.
    if (session?.viewer)
      throw new HttpError(403, "Für den Lesezugriff nicht verfügbar.");
    let row: { enabled: boolean; token: string | null } | null;
    if (write) {
      const { action } = z
        .object({ action: z.enum(["create", "rotate", "disable"]) })
        .strict()
        .parse(await request.json());
      const result = await session!.db.rpc("manage_player_api_share", {
        candidate: randomBytes(32).toString("hex"),
        action,
      });
      if (result.error) throw result.error;
      row = result.data;
    } else {
      const result = await session!.db
        .from("player_api_share")
        .select("enabled,token")
        .eq("singleton", true)
        .maybeSingle();
      if (result.error) throw result.error;
      row = result.data;
    }
    return Response.json(
      {
        enabled: row?.enabled ?? false,
        url:
          row?.enabled && row.token
            ? new URL(`/api/public/players/${row.token}`, required("APP_URL"))
                .href
            : null,
      },
      { headers },
    );
  } catch (error) {
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 503;
    return Response.json(
      {
        error:
          status === 503
            ? "Spieler-API konnte nicht geladen werden. Bitte die Datenbankmigration prüfen."
            : status === 400
              ? "Ungültige Anfrage."
              : (error as Error).message,
      },
      { status, headers },
    );
  }
}
export const GET = viewerRoute((request: Request) => handle(request, false));
export const POST = viewerRoute((request: Request) => handle(request, true));
