import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { productLiveMode } from "./runtime";
import { createHash, randomUUID } from "node:crypto";
import type { ProfileSession } from "../parent-profile";
import { serviceDb } from "../service-db";
import { assertRole, HttpError } from "../security";
import { checked, collect, loadProductContext } from "./context";
import { productById } from "./catalog";
import { decideProduct } from "@/lib/products/policy";
import type { Channel } from "@/lib/products/domain";
const bucket = "product-images";
export async function boundedBody(
  request: Pick<Request, "headers" | "body">,
  limit: number,
) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new HttpError(413, "Datei oder Anfrage ist zu groß.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Leere Anfrage.");
  const chunks: Uint8Array[] = [];
  let count = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    count += value.byteLength;
    if (count > limit) {
      await reader.cancel();
      throw new HttpError(413, "Datei oder Anfrage ist zu groß.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function uploadProductImage(
  session: ProfileSession,
  productId: string,
  request: Request,
) {
  assertRole(session.role, "admin");
  await productById(productId);
  const raw = await boundedBody(request, 8 * 1024 * 1024);
  const jpeg = raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff,
    png = raw
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    webp =
      raw.subarray(0, 4).toString() === "RIFF" &&
      raw.subarray(8, 12).toString() === "WEBP";
  if (!jpeg && !png && !webp)
    throw new HttpError(
      400,
      "Nur echte JPEG-, PNG- oder WebP-Dateien sind erlaubt.",
    );
  let output: { data: Buffer; info: { width: number; height: number } };
  if (productLiveMode()) {
    try {
      const { env } = getCloudflareContext();
      const images = (
        env as unknown as {
          PRODUCT_IMAGES: {
            info(stream: ReadableStream): Promise<{
              width?: number;
              height?: number;
              format?: string;
            }>;
            input(stream: ReadableStream): {
              transform(options: {
                width: number;
                height: number;
                fit: string;
              }): {
                output(options: {
                  format: string;
                  quality: number;
                  anim: boolean;
                }): Promise<{ response(): Response }>;
              };
            };
          };
        }
      ).PRODUCT_IMAGES;
      const stream = () => new Response(new Uint8Array(raw)).body!;
      const info = await images.info(stream());
      if (!info.width || !info.height || info.width * info.height > 24_000_000)
        throw new HttpError(400, "Das Bild überschreitet die Pixelgrenze.");
      const response = (
        await images
          .input(stream())
          .transform({
            width: Math.min(2000, info.width),
            height: Math.min(2000, info.height),
            fit: "scale-down",
          })
          .output({ format: "image/webp", quality: 82, anim: false })
      ).response();
      if (!response.ok) throw new Error("Image transformation failed");
      const data = await boundedBody(response, 8 * 1024 * 1024);
      const resized = await images.info(
        new Response(new Uint8Array(data)).body!,
      );
      if (
        !resized.width ||
        !resized.height ||
        resized.width > 2000 ||
        resized.height > 2000
      )
        throw new Error("Invalid transformed dimensions");
      output = { data, info: { width: resized.width, height: resized.height } };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(
        503,
        "Bildverarbeitung derzeit nicht verfügbar. Bitte später erneut versuchen.",
      );
    }
  } else {
    const processor = process.env.PRODUCT_IMAGE_PROCESSOR_URL,
      secret = process.env.PRODUCT_IMAGE_PROCESSOR_SECRET;
    if (processor !== "http://127.0.0.1:3111" || !secret || secret.length < 32)
      throw new HttpError(
        503,
        "Die lokale Bildverarbeitung ist noch nicht gestartet.",
      );
    try {
      const response = await fetch(`${processor}/image`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(raw),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
      if (!response.ok)
        throw new HttpError(
          response.status === 400 ? 400 : 503,
          response.status === 400
            ? "Das Bild ist beschädigt, animiert oder überschreitet die Pixelgrenze."
            : "Die lokale Bildverarbeitung ist nicht erreichbar.",
        );
      const data = await boundedBody(response, 8 * 1024 * 1024),
        width = Number(response.headers.get("x-image-width")),
        height = Number(response.headers.get("x-image-height"));
      if (
        response.headers.get("content-type") !== "image/webp" ||
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > 2000 ||
        height > 2000 ||
        data.subarray(0, 4).toString() !== "RIFF" ||
        data.subarray(8, 12).toString() !== "WEBP"
      )
        throw new Error();
      output = { data, info: { width, height } };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(
        503,
        "Die lokale Bildverarbeitung ist nicht erreichbar. Bitte den lokalen Produktstarter verwenden.",
      );
    }
  }
  const id = randomUUID(),
    path = `${productId}/${id}.webp`,
    db = serviceDb();
  const upload = await db.storage
    .from(bucket)
    .upload(path, output.data, { contentType: "image/webp", upsert: false });
  if (upload.error)
    throw new HttpError(503, "Bild konnte nicht gespeichert werden.");
  try {
    checked(
      await db
        .from("catalog_product_assets")
        .insert({
          id,
          product_id: productId,
          storage_path: path,
          content_type: "image/webp",
          bytes: output.data.length,
          width: output.info.width,
          height: output.info.height,
          sha256: createHash("sha256").update(output.data).digest("hex"),
          alt: decodeURIComponent(
            request.headers.get("x-image-alt") ?? "",
          ).slice(0, 300),
        })
        .select("id")
        .single(),
    );
  } catch (e) {
    await db.storage.from(bucket).remove([path]);
    throw e;
  }
  return {
    id,
    width: output.info.width,
    height: output.info.height,
    bytes: output.data.length,
    url: `/api/products/image/${id}`,
  };
}
export async function readProductImage(
  session: ProfileSession | null,
  id: string,
) {
  const db = serviceDb(),
    asset = checked(
      await db
        .from("catalog_product_assets")
        .select("*")
        .eq("id", id)
        .maybeSingle(),
    );
  if (!asset) throw new HttpError(404, "Bild nicht gefunden.");
  const p = await productById(asset.product_id);
  if (session?.role !== "admin") {
    const ctx = await loadProductContext(session);
    if (
      !p.published?.asset_ids.includes(id) ||
      !p.published.channels.some(
        (c) => decideProduct(p.published!, p.id, ctx, c as Channel).visible,
      )
    )
      throw new HttpError(404, "Bild nicht verfügbar.");
  }
  const result = await db.storage.from(bucket).download(asset.storage_path);
  if (result.error || !result.data)
    throw new HttpError(503, "Bild konnte nicht geladen werden.");
  return new Response(result.data, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function removeProductImage(
  session: ProfileSession,
  productId: string,
  id: string,
) {
  assertRole(session.role, "admin");
  const db = serviceDb(),
    p = await productById(productId);
  const versions = await collect(() =>
    db
      .from("catalog_product_versions")
      .select("id,payload")
      .eq("product_id", productId),
  );
  if (
    p.draft.asset_ids.includes(id) ||
    p.published?.asset_ids.includes(id) ||
    versions.some((v) => v.payload.asset_ids?.includes(id))
  )
    throw new HttpError(
      409,
      "Das Bild wird noch von einem Entwurf oder einer Produktversion verwendet. Zuerst die Referenz entfernen.",
    );
  const asset = checked(
    await db
      .from("catalog_product_assets")
      .select("*")
      .eq("id", id)
      .eq("product_id", productId)
      .maybeSingle(),
  );
  if (!asset) throw new HttpError(404, "Bild nicht gefunden.");
  const removed = await db.storage.from(bucket).remove([asset.storage_path]);
  if (removed.error)
    throw new HttpError(503, "Bild konnte nicht entfernt werden.");
  checked(
    await db.from("catalog_product_assets").delete().eq("id", id).select("id"),
  );
  return { ok: true };
}
export async function cleanupProductImages(session: ProfileSession) {
  assertRole(session.role, "admin");
  const assets = await collect(() =>
    serviceDb()
      .from("catalog_product_assets")
      .select("id,product_id")
      .lt("created_at", new Date(Date.now() - 86400000).toISOString()),
  );
  let removed = 0;
  for (const asset of assets) {
    try {
      await removeProductImage(session, asset.product_id, asset.id);
      removed++;
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 409) throw e;
    }
  }
  return { removed };
}
