import Stripe from "stripe";
import { campProcessingEnabled } from "@/lib/camps/processing-config";
import { campHostAllowed } from "@/lib/camps/runtime";
import { campReadStripe, enqueueCampEvent } from "@/lib/camps/processing";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (
    !campProcessingEnabled() ||
    !campHostAllowed(request.headers.get("host") ?? "")
  )
    return new Response(null, { status: 404 });
  const secret = process.env.CAMP_STRIPE_WEBHOOK_SECRET;
  if (!secret || !secret.startsWith("whsec_"))
    return new Response(null, { status: 503 });
  // Preserve exact bytes for Stripe signature verification; reject oversized bodies.
  if (Number(request.headers.get("content-length") ?? 0) > 262144)
    return new Response(null, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 262144) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    chunks.push(value);
  }
  let event;
  try {
    event = await campReadStripe().webhooks.constructEventAsync(
      Buffer.concat(chunks),
      request.headers.get("stripe-signature") ?? "",
      secret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return new Response(null, { status: 400 });
  }
  try {
    return Response.json(await enqueueCampEvent(event), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    // Never acknowledge a relevant event before its durable inbox write succeeded.
    return new Response(null, { status: 503 });
  }
}
