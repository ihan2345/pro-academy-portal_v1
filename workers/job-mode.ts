export interface JobFlags {
  [key: string]: unknown;
  JOBS_ENABLED?: string;
  STRIPE_SYNC_ONLY?: string;
}

export function jobMode(env: JobFlags): "disabled" | "stripe-only" | "all" {
  if (env.CAMP_SIDE_EFFECTS_BLOCKED === "true") return "disabled";
  // The restricted mode wins even if the broad switch is accidentally enabled.
  if (env.STRIPE_SYNC_ONLY === "true") return "stripe-only";
  return env.JOBS_ENABLED === "true" ? "all" : "disabled";
}
