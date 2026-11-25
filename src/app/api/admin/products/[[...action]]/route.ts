import { viewerRoute } from "@/lib/server/viewer";
import { NextRequest } from "next/server";
import { productApi } from "@/lib/server/products/api";
export const runtime = "nodejs";
async function handler(
  request: NextRequest,
  context: { params: Promise<{ action?: string[] }> },
) {
  return productApi(request, (await context.params).action ?? [], true);
}
export const GET = viewerRoute(handler);
export const POST = viewerRoute(handler);
export const PATCH = viewerRoute(handler);
export const DELETE = viewerRoute(handler);
