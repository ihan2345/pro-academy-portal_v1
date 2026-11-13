import "server-only";
import { serviceDb } from "./service-db";
import { HttpError } from "./security";
export async function parentCanActivate(email: string) {
  const r = await serviceDb().rpc("parent_self_activation_available", {
    input_email: email.trim().toLowerCase(),
  });
  if (r.error)
    throw new HttpError(
      503,
      "Die Anmeldung ist vorübergehend nicht verfügbar. Bitte versuche es später erneut.",
    );
  return r.data === true;
}
export async function guestEmailRequiresLogin(email: string) {
  const r = await serviceDb().rpc("parent_email_requires_login", {
    input_email: email.trim().toLowerCase(),
  });
  if (r.error || typeof r.data !== "boolean")
    throw new HttpError(
      503,
      "Die E-Mail konnte nicht geprüft werden. Bitte versuche es später erneut.",
    );
  return r.data;
}
export async function requireGuestEmailAvailable(email: string) {
  if (await guestEmailRequiresLogin(email))
    throw new HttpError(
      409,
      "Bitte melde dich vor der Buchung mit dieser E-Mail an oder aktiviere deinen Zugang. Du kannst dort einen E-Mail-Code anfordern.",
    );
}
