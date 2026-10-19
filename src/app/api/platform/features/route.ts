import { z } from "zod";
import { featureManager } from "@/lib/server/platform-features";
import { HttpError, requireOrigin } from "@/lib/server/security";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function handle(request: Request) {
  try {
    if (request.method !== "GET") requireOrigin(request);
    const s = await featureManager();
    if (request.method === "POST") {
      const body = z
        .object({
          key: z.string().min(1).max(64),
          enabled: z.boolean(),
          expected: z.boolean(),
        })
        .strict()
        .parse(await request.json());
      const { error } = await s.db.rpc("set_platform_feature", {
        feature_key: body.key,
        wanted: body.enabled,
        expected: body.expected,
      });
      if (error)
        throw new HttpError(
          error.code === "42501" ? 403 : 409,
          "Änderung nicht gespeichert. Bitte neu laden und Berechtigung prüfen.",
        );
    }
    const { data, error } = await s.db
      .from("platform_features")
      .select("key,enabled,updated_at")
      .order("key");
    if (error) throw new HttpError(503, "Funktionen derzeit nicht verfügbar.");
    return json({ features: data });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return json({ error: "Bitte Eingaben prüfen." }, 400);
    return json({ error: "Funktionen derzeit nicht verfügbar." }, 503);
  }
}
export const GET = handle;
export const POST = handle;
