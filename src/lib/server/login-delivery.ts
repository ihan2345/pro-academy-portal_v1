import "server-only";
import { HttpError } from "./security";

type OtpError = { status?: number; code?: string; message?: string } | null;
/**
 * Supabase reports an unknown address (no signup allowed) as an error. That
 * case keeps the neutral response so addresses cannot be probed. Every other
 * failure means the code was not sent and must be shown to the user.
 */
export function assertLoginCodeSent(error: OtpError) {
  if (!error) return;
  const code = error.code ?? "";
  if (
    ["otp_disabled", "signup_disabled", "user_not_found"].includes(code) ||
    /signups? not allowed/i.test(error.message ?? "")
  )
    return;
  if (
    error.status === 429 ||
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit"
  )
    throw new HttpError(
      429,
      "Es wurden gerade zu viele Codes angefordert. Bitte warte ein paar Minuten und versuche es dann erneut.",
    );
  // Diagnostics only: status and code, never the address.
  console.error("Login code delivery failed", {
    status: error.status ?? null,
    code: code || null,
  });
  throw new HttpError(
    503,
    "Der Code konnte gerade nicht versendet werden. Bitte versuche es in einigen Minuten erneut. Wenn es weiterhin nicht klappt, melde dich bitte bei uns.",
  );
}
