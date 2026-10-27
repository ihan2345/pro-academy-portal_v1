import { NextRequest, NextResponse } from "next/server";
import { sessionDb } from "@/lib/server/supabase";
import { required } from "@/lib/server/config";
import { claimGuestPurchases } from "@/lib/server/products/guest-checkout";
import { productsEnabled } from "@/lib/server/products/runtime";
export async function GET(request: NextRequest) {
  const origin = required("APP_URL");
  const token = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  if (
    !productsEnabled() ||
    !token ||
    !/^[a-fA-F0-9]{32,128}$/.test(token) ||
    !["invite", "magiclink", "signup"].includes(type ?? "")
  )
    return NextResponse.redirect(new URL("/login?error=auth", origin));
  const db = await sessionDb();
  const { error } = await db.auth.verifyOtp({
    token_hash: token,
    type: type as "invite" | "magiclink" | "signup",
  });
  if (error) return NextResponse.redirect(new URL("/login?error=auth", origin));
  try {
    await claimGuestPurchases(db);
  } catch {
    /* A confirmed login succeeds even when identity needs manual review. */
  }
  const response = NextResponse.redirect(
    new URL("/produkte?account=confirmed", origin),
  );
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
