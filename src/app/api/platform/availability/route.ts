import { viewerRoute } from "@/lib/server/viewer";
import { sessionUser } from "@/lib/server/supabase";
import { paiVisibility } from "@/lib/server/pai/switch";
export const dynamic = "force-dynamic";
const json = (visibility: { pai: boolean; mascot: boolean }, status = 200) =>
  Response.json(visibility, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
/** Visibility only: never exposes settings, permissions, user data or PAiLTON tools. */
export const GET = viewerRoute(async () => {
  try {
    const s = await sessionUser();
    if (!s?.role) return json({ pai: false, mascot: false }, 401);
    if (s.customerStatus === "trial" || s.viewer)
      return json({ pai: false, mascot: false });
    return json(await paiVisibility());
  } catch {
    return json({ pai: false, mascot: false }, 503);
  }
});
