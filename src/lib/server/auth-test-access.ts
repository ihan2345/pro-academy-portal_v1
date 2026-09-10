import "server-only";

/** Login test accounts are separate from the single notification recipient. */
export function isAllowedTestLogin(email: string) {
  if (process.env.EMAIL_TEST_MODE === "false") return true;
  const allowed = [
    process.env.EMAIL_TEST_RECIPIENT ?? "",
    ...(process.env.AUTH_TEST_EMAILS ?? "").split(","),
  ]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
