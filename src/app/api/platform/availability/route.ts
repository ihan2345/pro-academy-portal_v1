import { sessionUser } from "@/lib/server/supabase";
import { paiEnabled } from "@/lib/server/pai/switch";
export const dynamic = "force-dynamic";
const json = (pai: boolean, status = 200) =>
  Response.json(
    { pai },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
/** Visibility only: never exposes settings, permissions, user data or pAi tools. */
export async function GET() {
  try {
    const s = await sessionUser();
    if (!s?.role) return json(false, 401);
    return json(await paiEnabled());
  } catch {
    return json(false, 503);
  }
}
