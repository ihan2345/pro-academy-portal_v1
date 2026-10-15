import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
export async function proxy(request: NextRequest) {
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
  await db.auth.getUser();
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|brand/|sw.js|manifest.webmanifest|api/stripe/webhook|api/camp/webhook|api/cron|api/public/trainings/|api/public/players/).*)",
  ],
};
