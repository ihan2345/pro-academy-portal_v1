import "server-only";
import { serviceDb } from "../server/service-db";

// Deployment support remains installed when the Super-Admin pauses the feature.
export function trialFeatureInstalled() {
  return process.env.TRIAL_TRAINING_ENABLED === "true";
}

export async function trialFeatureEnabled(): Promise<boolean> {
  if (!trialFeatureInstalled()) return false;
  try {
    const { data, error } = await serviceDb().rpc("trial_enabled");
    return !error && data === true;
  } catch {
    return false;
  }
}
