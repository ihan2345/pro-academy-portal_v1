import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { campLocalEnabled } from "./runtime";
import { HttpError } from "@/lib/server/security";
export async function limitCampRequest(request: Request, action: string) {
  if (campLocalEnabled()) return;
  const { env } = getCloudflareContext();
  const limiter = (
    env as unknown as {
      CAMP_REQUEST_LIMIT?: {
        limit(input: { key: string }): Promise<{ success: boolean }>;
      };
    }
  ).CAMP_REQUEST_LIMIT;
  if (!limiter)
    throw new HttpError(503, "Buchung ist vorübergehend nicht verfügbar.");
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) throw new HttpError(400, "Anfrage konnte nicht geprüft werden.");
  if (!(await limiter.limit({ key: `${action}:${ip}` })).success)
    throw new HttpError(429, "Bitte warte eine Minute und versuche es erneut.");
}
