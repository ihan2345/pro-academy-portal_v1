import { NextRequest, NextResponse } from "next/server";
import { hashToken } from "@/lib/server/security";
import { required } from "@/lib/server/config";
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const response = NextResponse.redirect(
    new URL("/login", required("APP_URL")),
  );
  if (token && /^[a-f0-9]{64}$/.test(token))
    response.cookies.set("pa_invitation", hashToken(token), {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 3600,
    });
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
