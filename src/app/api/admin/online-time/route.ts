import { featureManager } from "@/lib/server/platform-features";
import { HttpError } from "@/lib/server/security";
export const dynamic = "force-dynamic";

// Online-Zeit je Konto (Release 065): nur Super-Admins, nur lesen.
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

export async function GET() {
  try {
    const s = await featureManager();
    const { data, error } = await s.db.rpc("online_time_overview");
    if (error) {
      if (/online_time_overview|online_seconds/.test(error.message))
        return json({ ready: false, rows: [] });
      if (error.code === "42501")
        throw new HttpError(403, "Keine Berechtigung.");
      throw new HttpError(503, "Online-Zeit ist gerade nicht verfügbar.");
    }
    return json({ ready: true, ...data });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: "Online-Zeit ist gerade nicht verfügbar." }, 503);
  }
}
