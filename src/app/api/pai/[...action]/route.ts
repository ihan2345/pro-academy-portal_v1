import { paiEnabled } from "@/lib/server/pai/switch";
import { z } from "zod";
import { HttpError, requireOrigin } from "@/lib/server/security";
import {
  paiSession,
  enabled,
  context,
  history,
  deleteHistory,
  checked,
} from "@/lib/server/pai/service";
import { chat } from "@/lib/server/pai/chat";
import { adminSummary } from "@/lib/server/pai/admin";
import { configSchema, overrideSchema } from "@/lib/pai/domain";
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function handle(
  request: Request,
  { params }: { params: Promise<{ action: string[] }> },
) {
  if (!(await paiEnabled())) return json({ error: "Nicht gefunden." }, 404);
  try {
    if (request.method !== "GET") requireOrigin(request);
    const s = await paiSession(),
      action = (await params).action.join("/"),
      url = new URL(request.url);
    if (action === "preference") {
      if (s.role !== "parent")
        throw new HttpError(403, "Bitte als Elternteil anmelden.");
      if (request.method === "GET") return json({ enabled: await enabled(s) });
      if (request.method === "POST") {
        const { enabled: value } = z
          .object({ enabled: z.boolean() })
          .strict()
          .parse(await request.json());
        return json({
          enabled: checked(await s.db.rpc("pai_preference", { wanted: value })),
        });
      }
    }
    if (action === "status" && request.method === "GET") {
      if (!(await enabled(s))) return json({ enabled: false });
      return json((await context(s)).status);
    }
    if (action === "history") {
      if (request.method === "GET") return json({ messages: await history(s) });
      if (request.method === "DELETE") {
        await deleteHistory(s);
        return json({ ok: true });
      }
    }
    if (action === "chat" && request.method === "POST") {
      const body = await request.text();
      if (new TextEncoder().encode(body).length > 18000)
        throw new HttpError(413, "Nachricht zu lang.");
      return json(await chat(s, JSON.parse(body)));
    }
    if (action.startsWith("admin")) {
      if (s.role !== "admin") throw new HttpError(403, "Nur für Admins.");
      if (action === "admin" && request.method === "GET")
        return json(
          await adminSummary(
            s,
            url.searchParams.get("search") ?? "",
            z.coerce
              .number()
              .int()
              .min(0)
              .max(10000)
              .parse(url.searchParams.get("offset") ?? 0),
          ),
        );
      if (action === "admin/user" && request.method === "GET")
        return json(
          (await context(s, z.uuid().parse(url.searchParams.get("id")))).status,
        );
      if (action === "admin/config" && request.method === "POST") {
        const body = z
          .object({ config: configSchema, version: z.number().int() })
          .strict()
          .parse(await request.json());
        const result = await s.db.rpc("pai_save_config", {
          settings: body.config,
          expected: body.version,
        });
        if (result.error)
          throw new HttpError(
            409,
            "Konfiguration nicht gespeichert. Bitte neu laden und erneut prüfen.",
          );
        return json({ ok: true });
      }
      if (action === "admin/override" && request.method === "POST") {
        const b = overrideSchema.parse(await request.json());
        const result = await s.db.rpc("pai_save_override", {
          target: b.userId,
          wanted: b.limit,
          kind: b.kind,
          note: b.reason,
          expiry: b.expiresAt,
          is_active: b.active,
        });
        if (result.error)
          throw new HttpError(
            400,
            "Ausnahme nicht gespeichert. Bitte Werte und Ablaufdatum prüfen.",
          );
        return json({ ok: true });
      }
    }
    return json({ error: "Nicht gefunden." }, 404);
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json({ error: "Bitte Eingaben prüfen." }, 400);
    return json(
      { error: "pAi ist derzeit nicht verfügbar. Bitte Einrichtung prüfen." },
      503,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
