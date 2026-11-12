import { completeLogin } from "@/lib/server/complete-login";
import { NextRequest, NextResponse } from "next/server";
import { sessionDb } from "@/lib/server/supabase";
import { required } from "@/lib/server/config";
export async function GET(request: NextRequest) {
  // Next normalizes loopback request URLs to localhost; keep the redirect on
  // APP_URL so it receives the session cookies just set by this callback.
  const portalUrl = required("APP_URL");
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const db = await sessionDb();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) {
      const target = await completeLogin(db);
      return NextResponse.redirect(new URL(target, portalUrl));
    }
  }
  return NextResponse.redirect(new URL("/login?error=auth", portalUrl));
}
