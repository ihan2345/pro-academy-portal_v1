import { randomBytes } from "node:crypto";
import { z } from "zod";
import { featureManager } from "@/lib/server/platform-features";
import { HttpError, requireOrigin } from "@/lib/server/security";
import { showcaseCode } from "@/lib/server/products/showcase";
const headers = { "Cache-Control": "private, no-store" };
export async function showcaseSettings(request: Request, codeOnly = false) {
  try {
    if (request.method !== "GET") requireOrigin(request);
    const session = await featureManager();
    let token: string | null;
    if (request.method === "POST") {
      const { expected } = z
        .object({
          expected: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable(),
        })
        .strict()
        .parse(await request.json());
      const result = await session.db.rpc("rotate_product_showcase_share", {
        candidate: randomBytes(32).toString("hex"),
        expected,
      });
      if (result.error)
        throw new HttpError(
          result.error.code === "42501" ? 403 : 409,
          "Einbettung nicht geändert. Bitte neu laden.",
        );
      token = result.data.token;
    } else {
      const result = await session.db
        .from("product_showcase_share")
        .select("token")
        .eq("singleton", true)
        .single();
      if (result.error)
        throw new HttpError(503, "Einbettung konnte nicht geladen werden.");
      token = result.data.token;
    }
    const code = showcaseCode(token);
    if (codeOnly)
      return new Response(code ?? "Noch keine Einbettung erstellt.", {
        headers: {
          ...headers,
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    return Response.json({ token, code }, { headers });
  } catch (e) {
    const status =
      e instanceof HttpError
        ? e.status
        : e instanceof z.ZodError || e instanceof SyntaxError
          ? 400
          : 503;
    return Response.json(
      {
        error:
          e instanceof HttpError
            ? e.message
            : "Einbettung derzeit nicht verfügbar.",
      },
      { status, headers },
    );
  }
}
