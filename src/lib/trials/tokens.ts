import { createHmac, timingSafeEqual } from "node:crypto";
export interface TrialGrant {
  purpose: "login" | "rating";
  family: string;
  parent: string;
  expires: number;
  nonce?: string;
  request?: string;
  event?: string;
  rating?: number;
}
export function scopedTrialToken(grant: TrialGrant, secret: string) {
  if (secret.length < 32)
    throw new Error("Probetraining-Zugang nicht konfiguriert.");
  const body = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(`trial-v2:${body}`).digest("base64url")}`;
}
export function readTrialGrant(
  token: string,
  secret: string,
  purpose: TrialGrant["purpose"],
): TrialGrant | null {
  try {
    if (token.length > 1500 || secret.length < 32) return null;
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) return null;
    const expected = createHmac("sha256", secret)
      .update(`trial-v2:${body}`)
      .digest("base64url");
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      return null;
    const grant = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as TrialGrant;
    if (
      grant.purpose !== purpose ||
      !Number.isFinite(grant.expires) ||
      grant.expires <= Date.now()
    )
      return null;
    const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
    if (!uuid.test(grant.family) || !uuid.test(grant.parent)) return null;
    if (purpose === "login" && !uuid.test(grant.nonce ?? "")) return null;
    if (
      purpose === "rating" &&
      (!uuid.test(grant.request ?? "") ||
        !uuid.test(grant.event ?? "") ||
        !Number.isInteger(grant.rating) ||
        grant.rating! < 1 ||
        grant.rating! > 5)
    )
      return null;
    return grant;
  } catch {
    return null;
  }
}
