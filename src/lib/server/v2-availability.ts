import "server-only";

export const V2_UNAVAILABLE =
  "Die neuen Funktionen von Version 2.0 sind für diese Datenbank noch nicht freigeschaltet. Die bestehenden Portalfunktionen bleiben verfügbar.";

export const BACKFILLS_LOCKED =
  "Nachträge sind noch nicht freigeschaltet. Die Freischaltung erfolgt nach der Veröffentlichung von Version 2.0. Es wurde nichts gespeichert und keine E-Mail vorgemerkt.";

export function isBackfillExecutionDenied(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; message?: string };
  return (
    value.code === "42501" &&
    value.message === "permission denied for function save_training_backfill"
  );
}

function missingObject(error: unknown, name: string, codes: string[]) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; message?: string };
  return (
    codes.includes(value.code ?? "") &&
    new RegExp(`\\b${name}\\b`).test(value.message ?? "")
  );
}

export function isMissingBackfills(error: unknown) {
  return missingObject(error, "training_backfills", ["PGRST205", "42P01"]);
}

export function isV2Unavailable(error: unknown) {
  return (
    isMissingBackfills(error) ||
    missingObject(error, "stripe_customer_registry", ["PGRST205", "42P01"]) ||
    ["save_training_backfill", "observe_stripe_customers"].some((name) =>
      missingObject(error, name, ["PGRST202", "42883"]),
    )
  );
}

/** Only the absent optional table is an empty feature; never mask access or network failures. */
export async function optionalBackfills<T>(
  request: PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: null; available: boolean }> {
  try {
    const result = await request;
    if (result.error) throw result.error;
    return { data: result.data ?? [], error: null, available: true };
  } catch (error) {
    if (!isMissingBackfills(error)) throw error;
    return { data: [], error: null, available: false };
  }
}
