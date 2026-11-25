import { viewerRoute } from "@/lib/server/viewer";
import { showcaseSettings } from "@/lib/server/products/showcase-settings-api";
export const dynamic = "force-dynamic";
export const GET = viewerRoute((request: Request) => showcaseSettings(request));
export const POST = viewerRoute((request: Request) =>
  showcaseSettings(request),
);
