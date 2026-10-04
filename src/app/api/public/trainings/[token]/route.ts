import { serviceDb } from "@/lib/server/service-db";

export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!/^[0-9a-f]{64}$/.test(token))
    return Response.json(
      { error: "Freigabelink ungültig." },
      { status: 404, headers },
    );
  try {
    const { data, error } = await serviceDb().rpc("read_shared_trainings", {
      share_token: token,
    });
    if (error) throw error;
    if (data === null)
      return Response.json(
        { error: "Freigabelink ungültig." },
        { status: 404, headers },
      );
    return Response.json(data, { headers });
  } catch {
    // Do not log the request URL or bearer token.
    return Response.json(
      { error: "Trainingsdaten sind vorübergehend nicht verfügbar." },
      { status: 503, headers },
    );
  }
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers });
}
