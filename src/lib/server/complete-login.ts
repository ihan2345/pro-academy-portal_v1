import "server-only";
import { cookies } from "next/headers";
import { claimGuestPurchases } from "./products/guest-checkout";
import { productsEnabled } from "./products/runtime";
import type { sessionDb } from "./supabase";

// Both login methods must complete exactly the same invitation and return flow.
export async function completeLogin(db: Awaited<ReturnType<typeof sessionDb>>) {
  const store = await cookies(),
    invitation = store.get("pa_invitation")?.value;
  if (invitation) {
    const result = await db.rpc("accept_invitation", {
      invitation_hash: invitation,
    });
    if (result.error) return "/login?error=invitation";
    store.delete("pa_invitation");
  }
  if (productsEnabled()) {
    try {
      await claimGuestPurchases(db);
    } catch {
      /* Login remains available if a paid guest order needs review. */
    }
  }
  const player = store.get("pa_player_redirect")?.value;
  if (player) store.delete("pa_player_redirect");
  const productReturn =
    productsEnabled() && store.get("pa_product_return")?.value === "1";
  if (productReturn) store.delete("pa_product_return");
  return productReturn
    ? "/produkte"
    : player &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          player,
        )
      ? `/admin/spieler/${player}`
      : "/";
}
