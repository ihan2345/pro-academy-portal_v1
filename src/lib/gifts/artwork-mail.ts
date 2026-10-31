import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Email } from "@/lib/mail";
import {
  giftArtwork,
  giftCardSvg,
  type GiftCardData,
  type GiftCardSide,
} from "./artwork";
const sources = new Map<GiftCardSide, Promise<string>>();
async function source(side: GiftCardSide) {
  let pending = sources.get(side);
  if (!pending) {
    pending = readFile(
      join(process.cwd(), "public", giftArtwork[side].path),
    ).then((b) => `data:image/png;base64,${b.toString("base64")}`);
    sources.set(side, pending);
    pending.catch(() => sources.delete(side));
  }
  return pending;
}
/** Runs in the Node mail worker, never in the edge/browser bundle. */
export async function giftMailArtwork(
  data: GiftCardData,
): Promise<NonNullable<Email["attachments"]>> {
  const { default: sharp } = await import("sharp");
  return Promise.all(
    (["front", "back"] as const).map(async (side) => ({
      filename: `ProAcademy-Geschenkkarte-${side === "front" ? "Vorderseite" : "Rueckseite"}.png`,
      content: await sharp(
        Buffer.from(giftCardSvg(data, side, await source(side))),
        { density: 120 },
      )
        .png()
        .toBuffer(),
      contentType: "image/png",
      cid: `pa-gift-${side}`,
    })),
  );
}
export const giftMailImages = `<div style="margin:24px 0"><p style="font-size:13px;color:#6c7469">Deine persönliche ProAcademy Geschenkkarte</p><img src="cid:pa-gift-front" alt="Geschenkkarte: Wert und persönlicher Code" width="504" style="display:block;width:100%;max-width:504px;height:auto;border:0;margin:12px 0"><img src="cid:pa-gift-back" alt="Rückseite mit persönlichem Gruß" width="504" style="display:block;width:100%;max-width:504px;height:auto;border:0;margin:12px 0"></div>`;
