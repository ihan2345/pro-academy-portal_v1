import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { productsEnabled } from "@/lib/server/products/runtime";
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
      const store = await cookies(),
        invitation = store.get("pa_invitation")?.value;
      if (invitation) {
        const result = await db.rpc("accept_invitation", {
          invitation_hash: invitation,
        });
        if (result.error)
          return NextResponse.redirect(
            new URL("/login?error=invitation", portalUrl),
          );
        store.delete("pa_invitation");
      }
      const player = store.get("pa_player_redirect")?.value;
      if (player) store.delete("pa_player_redirect");
      const productReturn =
        productsEnabled() && store.get("pa_product_return")?.value === "1";
      if (productReturn) store.delete("pa_product_return");
      const target = productReturn
        ? "/produkte"
        : player &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              player,
            )
          ? `/admin/spieler/${player}`
          : "/";
      return NextResponse.redirect(new URL(target, portalUrl));
    }
  }
  return NextResponse.redirect(new URL("/login?error=auth", portalUrl));
}
