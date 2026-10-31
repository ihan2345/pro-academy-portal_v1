import "server-only";
import { HttpError } from "@/lib/server/security";
import { productLiveMode } from "@/lib/server/products/runtime";
export function giftsEnabled() {
  return (
    process.env.GIFT_CARDS_ENABLED === "true" &&
    (!productLiveMode() || process.env.GIFT_CARDS_LIVE_ENABLED === "true")
  );
}
export function requireGifts() {
  if (!giftsEnabled())
    throw new HttpError(404, "Geschenkkarten sind noch nicht freigegeben.");
}
