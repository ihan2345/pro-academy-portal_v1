import "server-only";
import Stripe from "stripe";
import { required } from "./config";
import { stripeClient } from "./stripe";

/** Explicit local preview access; the regular Stripe test guard stays in force. */
export function profileStripeClient() {
  if (process.env.LOCAL_PROFILE_STRIPE_READ !== "true") return stripeClient();
  const app = new URL(required("APP_URL"));
  if (
    process.env.NODE_ENV !== "development" ||
    app.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(app.hostname)
  )
    throw new Error(
      "Stripe-Profilvorschau ist nur lokal im Entwicklungsmodus erlaubt.",
    );
  return new Stripe(required("STRIPE_SECRET_KEY"), {
    httpClient: Stripe.createFetchHttpClient(profileReadFetch),
    maxNetworkRetries: 0,
    timeout: 6000,
  });
}

export const profileReadFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  if (
    method.toUpperCase() !== "GET" ||
    url.origin !== "https://api.stripe.com" ||
    !/^\/v1\/(checkout\/sessions|account|customers\/cus_[A-Za-z0-9]+|charges|invoices|invoices\/in_[A-Za-z0-9]+\/lines|subscriptions\/sub_[A-Za-z0-9]+|invoice_payments|refunds)$/.test(
      url.pathname,
    )
  )
    throw new Error(
      "Die lokale Stripe-Profilvorschau erlaubt ausschließlich Finanz-Lesezugriffe.",
    );
  return fetch(input, { ...init, redirect: "error" });
};
