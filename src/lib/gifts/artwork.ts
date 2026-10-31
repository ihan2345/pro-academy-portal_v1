import { giftMoney } from "./domain";
export type GiftCardData = {
  amount: number;
  code: string;
  recipient_name: string;
  sender_name: string;
  expires_at: string;
};
export type GiftCardSide = "front" | "back";
// Original artwork is only framed to remove transparent outer margins; no stretching.
export const giftArtwork = {
  front: {
    path: "/gifts/card-front.png",
    width: 1005,
    height: 603,
    imageWidth: 1190,
    imageHeight: 744,
    offsetX: 93,
    offsetY: 84,
  },
  back: {
    path: "/gifts/card-back.png",
    width: 1075,
    height: 630,
    imageWidth: 1189,
    imageHeight: 744,
    offsetX: 58,
    offsetY: 50,
  },
} as const;
const xml = (value: string) =>
  value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function giftExpiry(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}
function label(
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  maxWidth: number,
  options = "",
) {
  const estimated = [...value].length * size * 0.59;
  const fit =
    estimated > maxWidth
      ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"`
      : "";
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}"${fit} ${options}>${xml(value)}</text>`;
}
/** One layout shared by the browser and mail/export renderer. All personal text is escaped. */
export function giftCardSvg(
  data: GiftCardData,
  side: GiftCardSide,
  background: string = giftArtwork[side].path,
) {
  const a = giftArtwork[side],
    expiry = giftExpiry(data.expires_at);
  const content =
    side === "front"
      ? `
 <rect x="43" y="408" width="421" height="158" rx="19" fill="#070a08" fill-opacity=".92" stroke="#d6edb0" stroke-opacity=".25"/>
 ${label("GESCHENKWERT", 63, 434, 10, "#caff63", 370, 'letter-spacing="2"')}
 ${label(giftMoney(data.amount), 60, 489, 49, "#ffffff", 380, 'font-weight="700"')}
 ${label("DEIN PERSÖNLICHER GESCHENKCODE", 63, 512, 8.5, "#bbc1b8", 375, 'letter-spacing="1"')}
 ${label(data.code, 63, 538, 17, "#f7ffed", 380, 'font-family="monospace" font-weight="600"')}
 ${label(`Einlösbar bis ${expiry}`, 63, 555, 9, "#b7bdb3", 375)}
 `
      : `
 ${label("MIT FREUDE VERSCHENKT", 51, 93, 10, "#caff63", 950, 'letter-spacing="2"')}
 ${label(`Für ${data.recipient_name}`, 51, 132, 31, "#ffffff", 955, 'font-weight="600"')}
 ${label(`Von ${data.sender_name}`, 52, 163, 17, "#d0d3cc", 950)}
 <rect x="283" y="376" width="477" height="183" rx="17" fill="#080b09" fill-opacity=".94" stroke="#d6edb0" stroke-opacity=".2"/>
 ${label("DEIN NÄCHSTES ERLEBNIS", 306, 402, 9, "#caff63", 428, 'letter-spacing="1.5"')}
 ${label("Danke, dass du Teil unserer", 306, 437, 23, "#ffffff", 428, 'font-weight="600"')}
 ${label("ProAcademy-Familie bist.", 306, 466, 23, "#ffffff", 428, 'font-weight="600"')}
 ${label("Code im Elternkonto einlösen und loslegen.", 306, 495, 12, "#c4c9c0", 428)}
 ${label("portal.proacademy-ak.com/produkte", 306, 516, 12, "#e6efdc", 428)}
 ${label(`Einlösbar bis ${expiry} · Restguthaben bleibt erhalten.`, 306, 541, 10, "#aeb7a8", 428)}
 `;
  const description =
    side === "front"
      ? `ProAcademy Geschenkkarte, ${giftMoney(data.amount)}. Code: ${data.code}. Einlösbar bis ${expiry}.`
      : `ProAcademy Geschenkkarte, Rückseite. Für ${data.recipient_name}, von ${data.sender_name}. Danke, dass du Teil unserer ProAcademy-Familie bist.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${a.width}" height="${a.height}" viewBox="0 0 ${a.width} ${a.height}" role="img" aria-label="${xml(description)}" font-family="Arial, Liberation Sans, sans-serif"><image href="${xml(background)}" x="-${a.offsetX}" y="-${a.offsetY}" width="${a.imageWidth}" height="${a.imageHeight}"/>${content}</svg>`;
}
