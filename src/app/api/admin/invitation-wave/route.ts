import { randomBytes } from "node:crypto";
import { z } from "zod";
import { viewerRoute } from "@/lib/server/viewer";
import { featureManager } from "@/lib/server/platform-features";
import { HttpError, hashToken, requireOrigin } from "@/lib/server/security";
export const dynamic = "force-dynamic";

// Einladungswelle (Release 062): nur Super-Admins. GET zeigt die Empfänger,
// POST „test“ schickt eine Testeinladung an die eigene Adresse, POST „start“
// erstellt die Einladungen genau für die bestätigte Liste.
const ORIGIN = "https://portal.proacademy-ak.com";
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
type Family = { parent_id: string };
type Overview = { invite: Family[]; release_holds: Family[] };
const messages: Record<string, string> = {
  WAVE_CHANGED:
    "Die Empfängerliste hat sich inzwischen geändert. Bitte neu laden und erneut bestätigen.",
  WAVE_DELIVERY_DISABLED: "Der Hauptschalter für Elternmails ist aus.",
  WAVE_TEST_LIMIT: "Höchstens 5 Testeinladungen pro Stunde.",
  WAVE_TEST_RECIPIENT: "Für dein Konto ist keine bestätigte E-Mail hinterlegt.",
};
async function handle(request: Request) {
  try {
    if (request.method !== "GET") requireOrigin(request);
    const s = await featureManager();
    if (request.method === "POST") {
      if (process.env.APP_URL !== ORIGIN)
        throw new HttpError(503, "Einladungsadresse ist nicht freigegeben.");
      const body = z
        .discriminatedUnion("action", [
          z.object({ action: z.literal("test") }).strict(),
          z
            .object({
              action: z.literal("start"),
              expected_invitations: z.number().int().min(0).max(2000),
              expected_releases: z.number().int().min(0).max(2000),
              confirm: z.number().int(),
            })
            .strict(),
        ])
        .parse(await request.json());
      if (body.action === "test") {
        const { error } = await s.db.rpc("send_invitation_wave_test", {
          input: { url: `${ORIGIN}/login` },
        });
        if (error) throw fail(error.message);
        return json({ ok: true });
      }
      if (body.confirm !== body.expected_invitations)
        throw new HttpError(
          400,
          "Bestätigung stimmt nicht mit der Anzahl überein.",
        );
      const current = await overview(s.db);
      const invitations = current.invite.map((f) => {
        const token = randomBytes(32).toString("hex");
        return {
          parent_id: f.parent_id,
          token_hash: hashToken(token),
          url: `${ORIGIN}/einladung?token=${token}`,
        };
      });
      const { data, error } = await s.db.rpc("start_invitation_wave", {
        input: {
          invitations,
          release_holds: current.release_holds.map((f) => f.parent_id),
          expected_invitations: body.expected_invitations,
          expected_releases: body.expected_releases,
        },
      });
      if (error) throw fail(error.message);
      return json({ result: data, overview: await overview(s.db) });
    }
    return json({ overview: await overview(s.db) });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return json({ error: "Bitte Eingaben prüfen." }, 400);
    return json({ error: "Einladungswelle derzeit nicht verfügbar." }, 503);
  }
}
async function overview(db: Awaited<ReturnType<typeof featureManager>>["db"]) {
  const { data, error } = await db.rpc("invitation_wave_overview");
  if (error) throw fail(error.message);
  return data as Overview;
}
function fail(message = "") {
  const key = Object.keys(messages).find((k) => message.includes(k));
  if (key) return new HttpError(409, messages[key]);
  if (message.includes("Forbidden"))
    return new HttpError(403, "Keine Berechtigung.");
  return new HttpError(
    503,
    "Einladungswelle derzeit nicht verfügbar. Ist Release 062 ausgeführt?",
  );
}
export const GET = viewerRoute(handle);
export const POST = viewerRoute(handle);
