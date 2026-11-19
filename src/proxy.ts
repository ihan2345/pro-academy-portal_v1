import { paiEnabled } from "@/lib/server/pai/switch";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
export async function proxy(request: NextRequest) {
  if (
    /^(?:\/pai|\/admin\/pai|\/api\/pai)(?:\/|$)/.test(
      request.nextUrl.pathname,
    ) &&
    !(await paiEnabled())
  ) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  if (
    process.env.CAMP_LOCAL_ENABLED === "true" &&
    process.env.NODE_ENV === "development" &&
    request.nextUrl.pathname.startsWith("/camp")
  ) {
    const canonical = new URL(process.env.APP_URL ?? "http://127.0.0.1:3108");
    const host = request.headers.get("host") ?? "";
    if (
      ["localhost", "127.0.0.1"].includes(request.nextUrl.hostname) &&
      host !== canonical.host
    )
      return NextResponse.redirect(
        new URL(request.nextUrl.pathname + request.nextUrl.search, canonical),
      );
  }
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;
  const db = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const {
    data: { user },
  } = await db.auth.getUser();
  // Zweitkonto (zweiter Elternteil): darf alles ansehen, aber nichts ändern,
  // buchen oder kaufen – außer Geschenkgutscheine kaufen und eigene
  // Elternkabine-Beiträge. Gilt zentral für alle schreibenden API-Aufrufe.
  if (
    user &&
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.nextUrl.pathname.startsWith("/api/") &&
    !CO_PARENT_ALLOWED.test(request.nextUrl.pathname)
  ) {
    // Fail-closed: kann die Rolle nicht geprüft werden, wird nicht geschrieben.
    // Ausnahme: Release 051 ist noch nicht eingespielt (Funktion fehlt),
    // dann gibt es auch keine Zweitkonten.
    const co = await db.rpc("is_co_parent");
    const notInstalled =
      co.error?.code === "PGRST202" || co.error?.code === "42883";
    if (co.error && !notInstalled)
      return NextResponse.json(
        { error: "Das hat nicht geklappt. Bitte versuche es erneut." },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    if (co.data === true)
      return NextResponse.json(
        {
          error:
            "Mit dem Zweitkonto kannst du alles ansehen, aber nichts ändern oder buchen. Bitte nutze dafür das Hauptkonto.",
        },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
  }
  return response;
}
const CO_PARENT_ALLOWED =
  /^\/api\/(?:auth\/|activity$|notice-decisions$|elternkabine\/|profile\/relation$|pai\/|products\/gifts\/(?:checkout|mine|status-link)$)/;
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|brand/|mail/kalender-|sw.js|manifest.webmanifest|api/stripe/webhook|api/camp/webhook|api/cron|api/public/trainings/|api/public/players/|api/public/kalender/|einbettung/produktbuehne/|api/public/product-showcase/).*)",
  ],
};
