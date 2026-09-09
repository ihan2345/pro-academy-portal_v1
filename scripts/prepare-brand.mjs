// Rebuild delivery formats from the unchanged original logo.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const source = await readFile(
  new URL("../public/brand/logo-neon.png", import.meta.url),
);
await writeFile(
  new URL("../src/lib/brand-logo-data.ts", import.meta.url),
  "// Original logo embedded for PDF generation in both Workers and the Node container.\n" +
    "// Source: public/brand/logo-neon.png\nexport const brandLogoPngBase64 = " +
    JSON.stringify(source.toString("base64")) +
    ";\n",
);

for (const [size, name, factor] of [
  [192, "icon-192.png", 0.82],
  [512, "icon-512.png", 0.82],
  [512, "icon-maskable-512.png", 0.6],
  [32, "favicon-32.png", 0.92],
]) {
  const logo = await sharp(source)
    .resize({ height: Math.round(size * factor) })
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: "#0b0f1a" },
  })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toFile(new URL("../public/brand/" + name, import.meta.url).pathname);
}

await writeFile(
  new URL("../public/brand/icon.svg", import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><rect width="192" height="192" rx="24" fill="#0b0f1a"/><image href="data:image/png;base64,${source.toString("base64")}" x="30" y="17" width="132" height="158" preserveAspectRatio="xMidYMid meet"/></svg>`,
);
console.log("Logo delivery formats prepared.");
