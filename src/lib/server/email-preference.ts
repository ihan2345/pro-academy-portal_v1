import "server-only";
import { serviceDb } from "./service-db";

/** Read current preference and discard marker immediately before SMTP. */
export async function emailPreferenceAllows(job: { id: string }) {
  const { data, error } = await serviceDb().rpc("email_job_preference_allows", {
    job_id: job.id,
  });
  if (error) throw error;
  return data === true;
}
