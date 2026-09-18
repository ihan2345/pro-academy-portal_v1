export function localHost(host: string) {
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
}
export function campLocalEnabled() {
  return (
    process.env.CAMP_LOCAL_ENABLED === "true" &&
    process.env.CAMP_SIDE_EFFECTS_BLOCKED === "true" &&
    process.env.NODE_ENV === "development"
  );
}
export function campPublicOrigin() {
  if (
    process.env.CAMP_DEPLOYMENT_ENABLED !== "true" ||
    process.env.NODE_ENV !== "production"
  )
    return null;
  try {
    const url = new URL(process.env.CAMP_PUBLIC_ORIGIN ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      localHost(url.host)
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
export function campEnabled() {
  return campLocalEnabled() || !!campPublicOrigin();
}
export function campPaymentMode(): "test" | "live" {
  // The local launcher can never opt into real payments, even with inherited live settings.
  return !campLocalEnabled() &&
    campPublicOrigin() &&
    process.env.CAMP_STRIPE_MODE === "live"
    ? "live"
    : "test";
}
export function campAppOrigin() {
  if (campLocalEnabled()) {
    const url = new URL(process.env.APP_URL ?? "http://127.0.0.1:3108");
    if (
      url.protocol === "http:" &&
      localHost(url.host) &&
      !url.username &&
      !url.password
    )
      return url.origin;
    throw new Error("Lokale Camp-Adresse ist ungültig.");
  }
  const origin = campPublicOrigin();
  if (!origin) throw new Error("Camp-Veröffentlichung ist nicht freigegeben.");
  return origin;
}
export function campHostAllowed(host: string) {
  if (!campEnabled()) return false;
  try {
    return host === new URL(campAppOrigin()).host;
  } catch {
    return false;
  }
}
export function campLoginHref() {
  return campLocalEnabled() ? "/camp/lokal" : "/login";
}
