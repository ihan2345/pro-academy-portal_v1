import { z } from "zod";
export const giftPerson = z
  .object({
    first_name: z.string().trim().min(1).max(80),
    last_name: z.string().trim().min(1).max(80),
    email: z.email().max(254),
    phone: z.string().trim().max(40).default(""),
  })
  .strict();
export const giftBuyer = z
  .object({
    full_name: z.string().trim().min(2).max(160),
    email: z.email().max(254),
    phone: z.string().trim().max(40).default(""),
  })
  .strict();
export const giftCheckoutSchema = z
  .object({
    request_id: z.guid(),
    product_id: z.guid(),
    amount: z.number().int().min(50).max(10000000),
    buyer: giftBuyer,
    recipient: giftPerson,
  })
  .strict();
export function normalizeGiftCode(code: string) {
  return code.toUpperCase().replace(/[\s-]/g, "");
}
export const giftCodeSchema = z
  .string()
  .max(80)
  .transform(normalizeGiftCode)
  .pipe(
    z
      .string()
      .regex(/^PA[0-9A-F]{24}$/, "Bitte einen gültigen Geschenkcode eingeben."),
  );
export function giftMoney(cents: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}
export function parseGiftAmount(value: string) {
  const s = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [a, b = ""] = s.split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  return Number.isSafeInteger(n) ? n : null;
}
export type GiftRecipient = z.infer<typeof giftPerson>;
