import { createHmac, timingSafeEqual } from "node:crypto";
export function trialToken(family: string, secret: string) {
  if (!secret || secret.length < 32)
    throw new Error("Probetraining-Zugang nicht konfiguriert.");
  return `${family}.${createHmac("sha256", secret).update(`trial-access-v1:${family}`).digest("hex")}`;
}
export function trialTokenFamily(token: string, secret: string) {
  if (!/^[a-f0-9-]{36}\.[a-f0-9]{64}$/i.test(token)) return null;
  const family = token.split(".")[0];
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(family)) return null;
  const expected = trialToken(family, secret);
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    ? family
    : null;
}
