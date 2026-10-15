import { serviceDb } from "@/lib/server/service-db";
import { loadPlayerExport } from "@/lib/server/player-export";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const invalid = () =>
    Response.json(
      { error: "Freigabelink ungültig oder deaktiviert." },
      { status: 404, headers },
    );
  if (!/^[0-9a-f]{64}$/.test(token)) return invalid();
  try {
    async function valid() {
      const result = await serviceDb().rpc("player_api_token_valid", {
        share_token: token,
      });
      if (result.error) throw result.error;
      return result.data === true;
    }
    if (!(await valid())) return invalid();
    const spieler = await loadPlayerExport();
    // History loading can take time; honor revocation before returning any data.
    if (!(await valid())) return invalid();
    return Response.json(
      {
        version: 1,
        generated_at: new Date().toISOString(),
        timezone: "Europe/Berlin",
        spieler,
      },
      { headers },
    );
  } catch {
    // Never log bearer URLs, personal data or upstream errors.
    return Response.json(
      { error: "Spielerdaten sind vorübergehend nicht verfügbar." },
      { status: 503, headers },
    );
  }
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers });
}
