import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { normalizeGiftCode } from "./domain";
function key() {
  const s = process.env.GIFT_ENCRYPTION_KEY;
  if (!s || s.length < 32)
    throw Error("Geschenk-Verschlüsselung ist nicht eingerichtet.");
  return createHash("sha256").update(s).digest();
}
export const giftHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const giftCodeHash = (code: string) => giftHash(normalizeGiftCode(code));
export const newGiftSecret = () => randomBytes(32).toString("base64url");
export const newGiftCode = () =>
  "PA-" +
  randomBytes(12).toString("hex").toUpperCase().match(/.{4}/g)!.join("-");
export function sealGift(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from("proacademy-gift-v1"));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
export function openGift(value: string) {
  const bytes = Buffer.from(value, "base64url"),
    cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from("proacademy-gift-v1"));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    cipher.update(bytes.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
