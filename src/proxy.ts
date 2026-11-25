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
  const method = request.method.toUpperCase();
  const path = request.nextUrl.pathname;
  // Nur-lesende POST-Anfragen; gleiche Liste wie VIEWER_READ_POSTS (viewer.ts).
  const write =
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    path !== "/api/admin/user-activity";
  const blockedPage =
    /^\/(?:pai|admin\/(?:pai|einstellungen|funktionen|einladungen|stripe))(?:\/|$)/.test(
      path,
    );
  if (user && (write || blockedPage) && !/^\/(?:api\/)?auth\//.test(path)) {
    // Lese-Rolle (Release 061): nichts ändern, Einstellungen und pAi nie.
    const { data: profile } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role === "viewer") {
      if (write)
        return NextResponse.json(
          {
            error:
              "Nur Lesezugriff: Mit diesem Konto lassen sich keine Änderungen speichern.",
          },
          { status: 403, headers: { "Cache-Control": "private, no-store" } },
        );
      return NextResponse.redirect(new URL("/admin", request.url));
    }
  }
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|brand/|mail/kalender-|sw.js|manifest.webmanifest|api/stripe/webhook|api/camp/webhook|api/cron|api/public/trainings/|api/public/players/|api/public/kalender/|einbettung/produktbuehne/|api/public/product-showcase/).*)",
  ],
};
