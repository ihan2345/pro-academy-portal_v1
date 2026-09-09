import "server-only";

/** Keep local login and its PKCE callback on the same host; never widen CSRF origins. */
export function canonicalLocalLogin(host: string | null): string | null {
  if (process.env.NODE_ENV !== "development" || !host || !process.env.APP_URL)
    return null;
  const canonical = new URL(process.env.APP_URL);
  if (
    canonical.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(canonical.hostname)
  )
    return null;
  const alternate = new URL(canonical.origin);
  alternate.hostname =
    canonical.hostname === "localhost" ? "127.0.0.1" : "localhost";
  return host.toLowerCase() === alternate.host
    ? new URL("/login", canonical).href
    : null;
}
