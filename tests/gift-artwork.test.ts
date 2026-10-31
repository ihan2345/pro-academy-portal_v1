import { it, expect } from "vitest";
import sharp from "sharp";
import {
  giftCardSvg,
  giftArtwork,
  giftExpiry,
  type GiftCardData,
} from "../src/lib/gifts/artwork";
import { giftMailArtwork } from "../src/lib/gifts/artwork-mail";
const data: GiftCardData = {
  amount: 7525,
  code: "PA-1234-ABCD-5678-EFAB-9012-CDEF",
  recipient_name: "Nora & Kaan <Beispiel>",
  sender_name: "Alex Beispiel",
  expires_at: "2027-10-30T12:00:00Z",
};
it("prints the exact monetary value and complete code on the front and the personal thank-you on the back", () => {
  const front = giftCardSvg(data, "front"),
    back = giftCardSvg(data, "back");
  expect(front).toContain("75,25");
  expect(front).toContain(data.code);
  expect(back).toContain("Nora &amp; Kaan &lt;Beispiel&gt;");
  expect(back).toContain("Von Alex Beispiel");
  expect(back).toContain("Danke, dass du Teil unserer");
  expect(back).toContain("30.10.2027");
  expect(front).not.toContain(data.recipient_name);
});
it("keeps long names and XML characters as literal content without truncating or turning them into markup", () => {
  const svg = giftCardSvg(
    { ...data, recipient_name: '</text><script>alert("gift")</script>' },
    "back",
  );
  expect(svg).not.toContain("<script>");
  expect(svg).toContain("&lt;script&gt;");
  const long = giftCardSvg(
    { ...data, recipient_name: "Ä".repeat(160) },
    "back",
  );
  expect(long).toContain("Ä".repeat(160));
  expect(long).toContain('lengthAdjust="spacingAndGlyphs"');
});
it("uses the same German expiry date regardless of browser/server timezone", () => {
  expect(giftExpiry("2027-10-30T23:30:00Z")).toBe("31.10.2027");
});
it("renders both personal PNG attachments with alpha and the source card proportions", async () => {
  const files = await giftMailArtwork(data);
  expect(files.map((f) => f.cid)).toEqual(["pa-gift-front", "pa-gift-back"]);
  for (const [index, side] of (["front", "back"] as const).entries()) {
    const meta = await sharp(files[index].content).metadata(),
      a = giftArtwork[side];
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width! / meta.height!).toBeCloseTo(a.width / a.height, 2);
    expect(files[index].content.length).toBeGreaterThan(10000);
  }
});
