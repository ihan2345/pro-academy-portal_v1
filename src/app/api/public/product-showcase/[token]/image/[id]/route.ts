import { requireShowcase } from "@/lib/server/products/showcase";
import { readProductImage } from "@/lib/server/products/images";
import { productIdSchema } from "@/lib/products/domain";
import { HttpError } from "@/lib/server/security";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; id: string }> },
) {
  try {
    const { token, id } = await context.params;
    await requireShowcase(token);
    if (!productIdSchema.safeParse(id).success)
      throw new HttpError(404, "Bild nicht verfügbar.");
    return await readProductImage(null, id);
  } catch (e) {
    return new Response(null, {
      status: e instanceof HttpError ? e.status : 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
