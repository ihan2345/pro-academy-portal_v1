import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Same-account workers.dev requests require a service binding in Cloudflare. */
export function fetchMailRunner(url: string, init: RequestInit) {
  let context;
  try {
    context = getCloudflareContext();
  } catch {
    // Local Node development has no Cloudflare request context.
    return fetch(url, init);
  }
  const runner = (
    context.env as unknown as {
      MAIL_RUNNER?: { fetch(request: Request): Promise<Response> };
    }
  ).MAIL_RUNNER;
  if (!runner) throw new Error("MAIL_RUNNER service binding missing");
  return runner.fetch(new Request(url, init));
}
