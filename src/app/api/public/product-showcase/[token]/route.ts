import { showcaseProducts } from "@/lib/server/products/showcase";
import { HttpError } from "@/lib/server/security";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    return Response.json(await showcaseProducts((await context.params).token), {
      headers,
    });
  } catch (e) {
    return Response.json(
      { error: "Einbettung derzeit nicht verfügbar." },
      { status: e instanceof HttpError ? e.status : 503, headers },
    );
  }
}
