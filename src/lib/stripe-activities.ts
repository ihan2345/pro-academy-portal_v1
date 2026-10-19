export interface StripeActivity {
  id: string;
  at: string;
  title: string;
  customer: string;
  subscriptionId: string | null;
  assignment: "assigned" | "partial" | "unassigned" | "not_applicable";
  children: string[];
  actionRequired: boolean;
  actionLabel: string | null;
  href: string | null;
}
export interface StripeActivityPage {
  rows: StripeActivity[];
  next: string | null;
}
export function stripeEventTitle(
  type: string,
  object: any,
  previous: any = {},
): string {
  switch (type) {
    case "checkout.session.completed":
      return "Buchung abgeschlossen";
    case "invoice.paid":
      return object.billing_reason === "subscription_cycle"
        ? "Abo-Verlängerung bezahlt"
        : "Rechnung bezahlt";
    case "invoice.payment_failed":
      return "Zahlung fehlgeschlagen";
    case "customer.subscription.created":
      return "Neues Abo abgeschlossen";
    case "customer.subscription.deleted":
      return "Abo beendet";
    case "customer.subscription.updated":
      if (
        previous.cancel_at_period_end !== undefined &&
        object.cancel_at_period_end
      )
        return "Abo zum Laufzeitende gekündigt";
      if (
        previous.cancel_at_period_end === true &&
        object.cancel_at_period_end === false
      )
        return "Abo-Kündigung zurückgenommen";
      if (previous.items || previous.plan) return "Abo-Paket geändert";
      return "Abo aktualisiert";
    case "customer.updated":
      return "Kundendaten aktualisiert";
    default:
      return "Stripe-Ereignis: " + type;
  }
}
