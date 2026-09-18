import "server-only";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { HttpError } from "@/lib/server/security";
import { sessionUser } from "@/lib/server/supabase";
import {
  campLocalEnabled,
  campHostAllowed,
  campAppOrigin,
  campPaymentMode,
} from "./runtime";
export { campLocalEnabled, localHost, campEnabled } from "./runtime";

export async function requireCampAccess() {
  if (!campHostAllowed((await headers()).get("host") ?? ""))
    throw new HttpError(404, "Camp-Bereich nicht verfügbar.");
  // Online test previews are restricted to the Academy team. Local guest tests remain possible.
  if (!campLocalEnabled() && campPaymentMode() === "test") {
    const session = await sessionUser();
    if (!session || !["admin", "staff"].includes(session.role ?? ""))
      throw new HttpError(404, "Camp-Bereich nicht verfügbar.");
  }
}
export async function requireCampLocal() {
  if (
    !campLocalEnabled() ||
    !campHostAllowed((await headers()).get("host") ?? "")
  )
    throw new HttpError(404, "Lokaler Zugang nicht verfügbar.");
}
export function requireCampOrigin(request: Request) {
  if (
    !campHostAllowed(request.headers.get("host") ?? "") ||
    request.headers.get("origin") !== campAppOrigin()
  )
    throw new HttpError(403, "Anfrage nicht erlaubt.");
}
export async function campPageGuard() {
  try {
    await requireCampAccess();
  } catch (e) {
    if (e instanceof HttpError) notFound();
    throw e;
  }
}
