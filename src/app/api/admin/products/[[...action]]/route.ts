import { NextRequest } from "next/server";
import { productApi } from "@/lib/server/products/api";
export const runtime = "nodejs";
async function handler(
  request: NextRequest,
  context: { params: Promise<{ action?: string[] }> },
) {
  return productApi(request, (await context.params).action ?? [], true);
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
