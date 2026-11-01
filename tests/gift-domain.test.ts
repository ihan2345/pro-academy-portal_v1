import { expect, it, vi, afterEach } from "vitest";
import {
  parseGiftAmount,
  giftCodeSchema,
  giftCheckoutSchema,
} from "../src/lib/gifts/domain";
import {
  newGiftCode,
  sealGift,
  openGift,
  giftCodeHash,
} from "../src/lib/gifts/crypto";
import { giftsEnabled } from "../src/lib/gifts/runtime";
afterEach(() => vi.unstubAllEnvs());
it("parses euro values in cents without rounding an invalid third decimal", () => {
  expect(parseGiftAmount("75,25")).toBe(7525);
  expect(parseGiftAmount("0.05")).toBe(5);
  for (const v of ["1.009", "-5", "1e3", "", "2,50 €"])
    expect(parseGiftAmount(v)).toBeNull();
});
it("encrypts codes and rejects altered ciphertext; separators and case do not change the lookup", () => {
  vi.stubEnv("GIFT_ENCRYPTION_KEY", "a".repeat(64));
  const code = newGiftCode(),
    sealed = sealGift(code);
  expect(openGift(sealed)).toBe(code);
  expect(sealed).not.toContain(code);
  expect(giftCodeHash(code)).toBe(
    giftCodeHash(code.toLowerCase().replaceAll("-", " ")),
  );
  expect(giftCodeSchema.parse(code)).toHaveLength(26);
  const bytes = Buffer.from(sealed, "base64url");
  bytes[bytes.length - 1] ^= 1;
  expect(() => openGift(bytes.toString("base64url"))).toThrow();
});
it("keeps live gifts disabled unless both explicit switches are enabled", () => {
  vi.stubEnv("APP_MODE", "production");
  vi.stubEnv("GIFT_CARDS_ENABLED", "true");
  vi.stubEnv("GIFT_CARDS_LIVE_ENABLED", "");
  expect(giftsEnabled()).toBe(false);
  vi.stubEnv("GIFT_CARDS_LIVE_ENABLED", "true");
  expect(giftsEnabled()).toBe(true);
});
it("requires beneficiary identity and a valid email while keeping phone optional", () => {
  expect(
    giftCheckoutSchema.safeParse({
      request_id: crypto.randomUUID(),
      product_id: crypto.randomUUID(),
      amount: 5000,
      buyer: { full_name: "Alex Test", email: "a@example.invalid" },
      recipient: {
        first_name: "Nora",
        last_name: "Test",
        email: "n@example.invalid",
      },
    }).success,
  ).toBe(true);
  expect(giftCodeSchema.safeParse("PA-test").success).toBe(false);
});

it("groups multiple values from one gift product with older individual amounts and rejects duplicate or empty configurations", async () => {
  const { giftAmounts, giftCatalogVariants, productSchema, emptyProduct } =
    await import("../src/lib/products/domain");
  expect(giftAmounts({ gift_amount: 5000 })).toEqual([5000]);
  expect(
    giftCatalogVariants([
      { id: "new", name: "Neu", gift_amounts: [7500, 2500, 5000] },
      { id: "old", name: "Alt", gift_amount: 5000 },
      { id: "old100", name: "Alt", gift_amount: 10000 },
    ]),
  ).toEqual([
    { id: "new", name: "Neu", amount: 2500 },
    { id: "new", name: "Neu", amount: 5000 },
    { id: "new", name: "Neu", amount: 7500 },
    { id: "old100", name: "Alt", amount: 10000 },
  ]);
  const data = { ...emptyProduct(), kind: "gift" };
  expect(
    productSchema.safeParse({ ...data, gift_amounts: [2500, 5000] }).success,
  ).toBe(true);
  expect(
    productSchema.safeParse({ ...data, gift_amounts: [5000, 5000] }).success,
  ).toBe(false);
  expect(productSchema.safeParse(data).success).toBe(false);
});
