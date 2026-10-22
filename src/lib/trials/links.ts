import { serviceDb } from "../server/service-db";
import { required } from "../server/config";
import { scopedTrialToken } from "./tokens";

export async function trialLoginLink(family: {
  id: string;
  parent_id: string;
}) {
  const { data, error } = await serviceDb().rpc("issue_trial_access", {
    family: family.id,
  });
  if (error || typeof data !== "string")
    throw new Error("Elternzugang konnte nicht vorbereitet werden.");
  const token = scopedTrialToken(
    {
      purpose: "login",
      family: family.id,
      parent: family.parent_id,
      nonce: data,
      expires: Date.now() + 24 * 3600000,
    },
    required("SUPABASE_SERVICE_ROLE_KEY"),
  );
  return `${required("APP_URL")}/probetraining/willkommen?token=${encodeURIComponent(token)}`;
}
