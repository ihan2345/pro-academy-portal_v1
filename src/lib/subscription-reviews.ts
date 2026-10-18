export interface SubscriptionReview {
  id: string;
  signature: string;
  context: {
    customerId: string;
    customerName: string | null;
    customerEmail: string | null;
    customerDetailsUnavailable: boolean;
    subscriptionId: string;
    status: string;
    createdAt: string;
    syncedAt: string | null;
    itemId: string;
    priceId: string;
    parents: { id: string; name: string }[];
  };
  requiresLegacyConfirmation: boolean;
  product: string;
  units: number | null;
  startsAt: string;
  endsAt: string;
  quantity: number;
  suggestions: { playerId: string; name: string; previousItemId: string }[];
  candidates: { id: string; name: string }[];
}
export interface SubscriptionReviewPage {
  rows: SubscriptionReview[];
  total: number;
}

export function reviewExplanation(r: SubscriptionReview): string {
  if (r.suggestions.length > 1)
    return "Mehrere bisherige Kinderzuordnungen kommen infrage. Bitte prüfe, welche Zuordnung dieses Paket ersetzt.";
  if (r.suggestions.length === 1)
    return "Das bisher zugeordnete Kind ist der Vorschlag. Bitte bestätige, ob das neue Paket weiterhin zu diesem Kind gehört.";
  if (!r.context.parents.length && !r.candidates.length)
    return "Dieser Stripe-Kunde ist noch keiner Familie im Portal zugeordnet. Deshalb gibt es noch keine Kinder zur Auswahl und keinen belastbaren Kind-Vorschlag.";
  if (!r.candidates.length)
    return "Zur verknüpften Familie ist kein aktives Kind hinterlegt. Archivierte Kinder können hier nicht ausgewählt werden.";
  if (r.candidates.length === 1)
    return "Es gibt keine bisherige Zuordnung für diese Abo-Position. Das einzige aktive Kind der verknüpften Familie wird als Vorschlag angezeigt; bitte prüfe die Auswahl.";
  return "Es gibt keine bisherige Zuordnung für diese Abo-Position. Mehrere Kinder gehören zur Familie; eine eindeutige Auswahl ist deshalb nicht möglich.";
}
