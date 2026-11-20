/**
 * Kurzer deutscher Ablehnungsgrund für einen fehlgeschlagenen Stripe-Zahlungsversuch.
 * Reihenfolge: Bankcode (decline_code) → Stripe-Fehlercode (failure_code)
 * → Stripe-Risikoprüfung (outcome) → Stripes eigener Text.
 */
const reasons: Record<string, string> = {
  // Karten (decline_code bzw. failure_code)
  insufficient_funds: "Nicht genügend Deckung",
  card_velocity_exceeded: "Kartenlimit überschritten",
  withdrawal_count_limit_exceeded: "Kartenlimit überschritten",
  expired_card: "Karte abgelaufen",
  lost_card: "Karte als verloren gemeldet",
  stolen_card: "Karte als gestohlen gemeldet",
  pickup_card: "Karte von der Bank gesperrt",
  restricted_card: "Karte von der Bank gesperrt",
  card_not_supported: "Karte für diese Zahlung nicht freigegeben",
  currency_not_supported: "Karte unterstützt die Währung nicht",
  do_not_honor: "Von der Bank abgelehnt (ohne Angabe von Gründen)",
  generic_decline: "Von der Bank abgelehnt (ohne Angabe von Gründen)",
  call_issuer: "Von der Bank abgelehnt, Kunde soll Bank kontaktieren",
  no_action_taken: "Von der Bank abgelehnt (ohne Angabe von Gründen)",
  not_permitted: "Zahlung von der Bank nicht erlaubt",
  service_not_allowed: "Zahlung von der Bank nicht erlaubt",
  transaction_not_allowed: "Zahlung von der Bank nicht erlaubt",
  revocation_of_authorization: "Kunde hat die Abbuchung widerrufen",
  revocation_of_all_authorizations: "Kunde hat alle Abbuchungen widerrufen",
  stop_payment_order: "Kunde hat die Zahlung bei der Bank gestoppt",
  fraudulent: "Von der Bank als Betrugsverdacht abgelehnt",
  merchant_blacklist: "Von der Bank als Betrugsverdacht abgelehnt",
  security_violation: "Von der Bank als Betrugsverdacht abgelehnt",
  incorrect_cvc: "Prüfnummer (CVC) falsch",
  invalid_cvc: "Prüfnummer (CVC) falsch",
  incorrect_number: "Kartennummer falsch",
  invalid_number: "Kartennummer falsch",
  invalid_expiry_month: "Ablaufdatum falsch",
  invalid_expiry_year: "Ablaufdatum falsch",
  incorrect_zip: "Postleitzahl falsch",
  invalid_account: "Konto ungültig",
  new_account_information_available:
    "Neue Kartendaten bei der Bank, Karte neu hinterlegen",
  authentication_required: "Bestätigung (3D Secure) durch Kunde nötig",
  approve_with_id: "Bank konnte die Zahlung nicht freigeben",
  issuer_not_available: "Bank nicht erreichbar",
  processing_error: "Technischer Fehler bei der Verarbeitung",
  reenter_transaction: "Technischer Fehler, erneut versuchen",
  try_again_later: "Bank vorübergehend nicht erreichbar",
  testmode_decline: "Testkarte abgelehnt",
  // SEPA-Lastschrift (failure_code)
  account_closed: "Bankkonto aufgelöst",
  account_frozen: "Bankkonto gesperrt",
  bank_account_restricted: "Bankkonto für Lastschriften gesperrt",
  debit_not_authorized: "Lastschrift nicht autorisiert (Widerspruch)",
  invalid_account_number: "IBAN ungültig",
  no_account: "Bankkonto existiert nicht",
  refer_to_customer: "Bank verweist an den Kunden",
  // Stripe Radar (outcome.reason)
  highest_risk_level: "Von Stripe wegen hohem Betrugsrisiko blockiert",
  elevated_risk_level: "Von Stripe wegen erhöhtem Risiko blockiert",
  rule: "Von einer Stripe-Regel blockiert",
  low_probability_of_authorization:
    "Von Stripe blockiert, Bank hätte wahrscheinlich abgelehnt",
};
const codes: Record<string, string> = {
  card_declined: "Von der Bank abgelehnt",
  amount_too_large: "Betrag zu hoch für diese Zahlungsart",
  amount_too_small: "Betrag zu niedrig für diese Zahlungsart",
  payment_method_not_available: "Zahlungsart nicht verfügbar",
};

export interface DeclineInput {
  decline_code?: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
  outcome_reason?: string | null;
  outcome_type?: string | null;
}

export function declineReason(input: DeclineInput): string | null {
  for (const key of [
    input.decline_code,
    input.failure_code,
    input.outcome_reason,
  ])
    if (key && reasons[key]) return reasons[key];
  if (input.outcome_type === "blocked")
    return "Von Stripe wegen Betrugsrisiko blockiert";
  if (input.failure_code && codes[input.failure_code])
    return codes[input.failure_code];
  const message = input.failure_message?.trim();
  if (message) return message;
  const code = input.decline_code ?? input.failure_code;
  return code ? `Abgelehnt (${code})` : null;
}

const brands: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  maestro: "Maestro",
  diners: "Diners",
  discover: "Discover",
  jcb: "JCB",
  unionpay: "UnionPay",
  cartes_bancaires: "Cartes Bancaires",
};
export const cardBrand = (brand: string) => brands[brand] ?? brand;
