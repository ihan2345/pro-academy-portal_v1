import "server-only";

/** Global kill switch. Missing/invalid values are disabled; no role can bypass it. */
export function paiEnabled() {
  return process.env.PAI_ENABLED === "true";
}
