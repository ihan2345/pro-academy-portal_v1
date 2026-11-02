import { showcaseSettings } from "@/lib/server/products/showcase-settings-api";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return showcaseSettings(request);
}
export function POST(request: Request) {
  return showcaseSettings(request);
}
