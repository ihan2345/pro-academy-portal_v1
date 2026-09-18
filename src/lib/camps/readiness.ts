import "server-only";
import { campProcessingEnabled } from "./processing-config";
import { readServerReview } from "./processing";
import { campSession, getCamp } from "./service";
import { serviceDb } from "@/lib/server/service-db";
import { campPublicOrigin, campPaymentMode } from "./runtime";
import { verifyOffer } from "./stripe";
import { currentOffer, maximumSeats, money } from "./domain";
export async function campReadiness(id: string) {
  await campSession(true);
  const { camp, offers, occupied } = await getCamp(id);
  const db = serviceDb();
  const checks: {
    name: string;
    status: "ok" | "open" | "deferred";
    detail: string;
  }[] = [];
  const add = (name: string, good: boolean, detail: string) =>
    checks.push({ name, status: good ? "ok" : "open", detail });
  const installation = await db
    .from("camp_installation")
    .select("version,live_payments_enabled")
    .single();
  add(
    "Datenbank",
    !installation.error && installation.data?.version === "v2",
    installation.error
      ? "Release-Ergänzung fehlt."
      : "Test- und Live-Daten werden getrennt; Live-Freigabe bleibt ein eigener Schritt.",
  );
  add(
    "Termine und Plätze",
    camp.days.every((d) => Date.parse(d.starts_at) > Date.now()) &&
      occupied < maximumSeats(camp),
    `${occupied} von ${maximumSeats(camp)} Plätzen belegt; ${camp.capacity} regulär plus ${maximumSeats(camp) - camp.capacity} Puffer.`,
  );
  add(
    "Anmeldung",
    camp.status === "open",
    camp.status === "open"
      ? "Anmeldung geöffnet."
      : "Anmeldung noch nicht geöffnet.",
  );
  const selected = currentOffer(offers, camp.early_bird_until);
  add(
    "Aktueller Preis",
    !!selected,
    selected
      ? `${selected.kind === "early" ? "Frühbucher" : "Normalpreis"}: ${money(selected.amount)}.`
      : "Kein gültiger Preis hinterlegt.",
  );
  if (camp.early_bird_until)
    add(
      "Frühbucherfrist",
      Date.parse(camp.early_bird_until) > Date.now(),
      new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(camp.early_bird_until)) + " Uhr (deutsche Ortszeit).",
    );
  add(
    "Normalangebot",
    offers.some((o) => o.kind === "main"),
    offers.some((o) => o.kind === "main")
      ? "Preis nach Ende der Frühbucherfrist vorhanden."
      : "Normalpreis fehlt.",
  );
  for (const o of offers) {
    try {
      const verified = await verifyOffer(
        o.stripe_price_id,
        o.stripe_payment_link_id,
        o.codes,
      );
      add(
        o.kind === "early"
          ? "Frühbucher-Zahlungsangebot"
          : "Normales Zahlungsangebot",
        verified.amount === o.amount && verified.currency === o.currency,
        "Preis, Menge und Rabattcodes bei Stripe geprüft.",
      );
    } catch (e) {
      add(
        o.kind === "early"
          ? "Frühbucher-Zahlungsangebot"
          : "Normales Zahlungsangebot",
        false,
        e instanceof Error
          ? e.message
          : "Zahlungsangebot konnte nicht geprüft werden.",
      );
    }
  }
  const rates = await db
    .from("plans")
    .select("name,generation,billing_interval,camp_benefit_percent")
    .or("is_camp.is.null,is_camp.eq.false")
    .order("generation");
  add(
    "Abo-Vorteile",
    !rates.error,
    rates.error
      ? "Tarife konnten nicht geprüft werden."
      : "Die eingetragenen Vorteile gelten nur für aktive, dem Kind zugeordnete Abos.",
  );
  add(
    "Öffentlicher Betrieb",
    !!campPublicOrigin(),
    campPublicOrigin() ??
      "Veröffentlichung und endgültige HTTPS-Adresse sind noch nicht freigegeben.",
  );
  add(
    "Live-Zahlungen",
    campPaymentMode() === "live" &&
      !!installation.data?.live_payments_enabled &&
      process.env.CAMP_LIVE_PAYMENTS_ENABLED === "true",
    campPaymentMode() === "test"
      ? "Derzeit Testangebote. Live-Angebote werden erst nach Freigabe eingerichtet und geprüft."
      : "Separate technische und Datenbankfreigabe erforderlich.",
  );
  if (campProcessingEnabled()) {
    const review = await readServerReview(id);
    add(
      "Stripe-Abgleich",
      !!review.checked_at && !review.error,
      review.error ??
        (review.checked_at
          ? "Live-Zahlungen werden automatisch abgeglichen. Fehlende Kinderdaten bleiben zur Admin-Prüfung."
          : "Erster vollständiger Abgleich steht aus."),
    );
  } else
    add("Stripe-Abgleich", false, "Automatischer Abgleich ist ausgeschaltet.");
  add(
    "Einladungen",
    process.env.MANUAL_INVITATIONS_ENABLED === "true",
    "Manuelle Einladung nur an freigegebene Empfänger. Automatische Einladungen bleiben ausgeschaltet.",
  );
  return {
    checked_at: new Date().toISOString(),
    checks,
    rates: rates.data ?? [],
    release_ready: checks.every((c) => c.status === "ok"),
  };
}
