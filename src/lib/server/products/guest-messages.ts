import "server-only";
import type { MailProvider } from "@/lib/mail";
import { htmlEmail, safeRecipient } from "@/lib/mail";
import { serviceDb } from "../service-db";
import { checked } from "./context";
/** Separate transactional purchase/access messages. Never releases legacy reminder or invitation queues. */
export async function processGuestMessages(provider: MailProvider) {
  if (process.env.PRODUCT_GUEST_MAIL_ENABLED !== "true") return 0;
  const db = serviceDb();
  const jobs = checked<any[]>(await db.rpc("claim_product_guest_messages"));
  let sent = 0;
  for (const job of jobs) {
    try {
      const i = checked(
        await db
          .from("product_purchase_intents")
          .select(
            "id,guest_data,proof,status,product,expected_amount,currency,subscription_id",
          )
          .eq("id", job.intent_id)
          .single(),
      );
      if (
        !i.guest_data ||
        !i.proof ||
        !["fulfilled", "review", "refunded"].includes(i.status)
      )
        throw Error("Paid guest order missing");
      if (i.status === "refunded") {
        checked(
          await db
            .from("product_guest_messages")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("intent_id", i.id)
            .eq("lease_token", job.lease_token)
            .select("intent_id"),
        );
        continue;
      }
      const recipient = safeRecipient(i.guest_data.email);
      // Capture tests must never generate credentials for real customer accounts.
      const isolatedAuth =
        process.env.APP_MODE === "test" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(
          new URL(
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.invalid",
          ).hostname,
        );
      const authEmail =
        isolatedAuth || process.env.EMAIL_TEST_MODE === "false"
          ? i.guest_data.email
          : recipient;
      let link = await db.auth.admin.generateLink({
        type: "invite",
        email: authEmail,
      });
      if (link.error)
        link = await db.auth.admin.generateLink({
          type: "magiclink",
          email: authEmail,
        });
      if (link.error || !link.data.properties?.hashed_token)
        throw Error("Access link unavailable");
      const url = new URL("/auth/product", process.env.APP_URL!);
      url.searchParams.set("token_hash", link.data.properties.hashed_token);
      url.searchParams.set("type", link.data.properties.verification_type);
      const price = new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: i.currency,
      }).format(i.expected_amount / 100);
      const text = [
        i.status === "review"
          ? `Deine Bestellung von „${i.product.name}“ ist zur Prüfung erfasst. Bei Stripe vereinbarter Betrag: ${price}. Bestellnummer: ${i.id}.`
          : `Dein Kauf von „${i.product.name}“ wurde mit ${price} abgeschlossen. Bestellnummer: ${i.id}.`,
        i.status === "review"
          ? "Deine Buchung ist eingegangen. Die Zuordnung wird geprüft. Bitte nicht erneut kaufen."
          : "Die Buchung wurde im Portal übernommen.",
        "Bestätige deine E-Mail über den Link, um deinen persönlichen Portalzugang zu aktivieren. Dein Kauf bleibt auch ohne Aktivierung bestehen.",
        ...(i.subscription_id
          ? [
              "Dein Abonnement läuft unabhängig von der Aktivierung des Portalzugangs. Wiederkehrende Zahlungen richten sich nach deinem gewählten Tarif und dem bei Stripe angezeigten Rabatt.",
            ]
          : []),
        "Falls der Link abgelaufen ist, kannst du im Shop über die Bestellbestätigung oder über die Anmeldung einen neuen Zugangslink anfordern.",
      ].join("\n");
      await provider.send({
        to: recipient,
        subject: `Deine Buchung: ${i.product.name} – Portalzugang bestätigen`,
        text: `${text}\n${url.href}`,
        html: htmlEmail(
          i.status === "review"
            ? "Bestellung eingegangen – Zugang aktivieren"
            : "Buchung bestätigt – Zugang aktivieren",
          text,
          url.href,
        ),
        messageId: `<product-guest-${i.id}-${job.attempts}@proacademy-ak.com>`,
      });
      checked(
        await db
          .from("product_guest_messages")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("intent_id", i.id)
          .eq("lease_token", job.lease_token)
          .select("intent_id"),
      );
      sent++;
    } catch {
      checked(
        await db
          .from("product_guest_messages")
          .update({
            status: "failed",
            last_error:
              "Buchungs- und Zugangsbestätigung konnte nicht versendet werden.",
            available_at: new Date(
              Date.now() + 60000 * Math.min(60, 2 ** job.attempts),
            ).toISOString(),
          })
          .eq("intent_id", job.intent_id)
          .eq("lease_token", job.lease_token)
          .select("intent_id"),
      );
    }
  }
  return sent;
}
