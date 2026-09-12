import "server-only";
export function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Konfiguration fehlt: ${name}`);
  return v;
}
export function stripeTestGuard(key: string) {
  if (
    process.env.APP_MODE !== "production" &&
    !key.startsWith("sk_test_") &&
    !key.startsWith("rk_test_")
  )
    throw new Error("Nur Stripe-Testschlüssel sind zugelassen");
}
