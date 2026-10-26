// Private localhost image codec. Kept outside the Cloudflare application bundle.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import sharp from "sharp";
const secret = process.env.PRODUCT_IMAGE_PROCESSOR_SECRET ?? "";
if (
  process.env.APP_MODE !== "test" ||
  process.env.APP_URL !== "http://127.0.0.1:3110" ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:57321" ||
  secret.length < 32
)
  throw Error("Independent local image configuration required");
let active = 0;
const server = createServer(async (req, res) => {
  const token = Buffer.from(
      req.headers.authorization?.replace(/^Bearer /, "") ?? "",
    ),
    expected = Buffer.from(secret);
  if (token.length !== expected.length || !timingSafeEqual(token, expected)) {
    res.writeHead(403).end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  if (req.method !== "POST" || req.url !== "/image") {
    res.writeHead(404).end();
    return;
  }
  if (active >= 2) {
    res.writeHead(503).end();
    return;
  }
  active++;
  try {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      const data = Buffer.from(c);
      size += data.length;
      if (size > 8 * 1024 * 1024) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(data);
    }
    const image = sharp(Buffer.concat(chunks), {
        limitInputPixels: 24000000,
        failOn: "warning",
      }),
      metadata = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(metadata.format ?? "") ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages ?? 1) > 1
    )
      throw Error("Unsupported image");
    const output = await image
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    res
      .writeHead(200, {
        "Content-Type": "image/webp",
        "Content-Length": output.data.length,
        "X-Image-Width": output.info.width,
        "X-Image-Height": output.info.height,
        "Cache-Control": "no-store",
      })
      .end(output.data);
  } catch {
    if (!res.headersSent)
      res.writeHead(400, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          error:
            "Das Bild ist beschädigt, animiert oder überschreitet die Pixelgrenze.",
        }),
      );
  } finally {
    active--;
  }
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.listen(3111, "127.0.0.1", () =>
  console.log("Local product image codec: 127.0.0.1:3111"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
