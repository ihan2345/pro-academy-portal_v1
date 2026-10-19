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
      if (
        Array.isArray(previous.items?.data) &&
        Array.isArray(object.items?.data)
      ) {
        const changed = previous.items.data.some((old: any) => {
          const current = object.items.data.find(
            (item: any) => item.id === old.id,
          );
          const oldPrice =
            typeof old.price === "string" ? old.price : old.price?.id;
          const newPrice =
            typeof current?.price === "string"
              ? current.price
              : current?.price?.id;
          return (
            !current ||
            (oldPrice && newPrice && oldPrice !== newPrice) ||
            (old.quantity !== undefined &&
              current.quantity !== undefined &&
              old.quantity !== current.quantity)
          );
        });
        if (changed || previous.items.data.length !== object.items.data.length)
          return "Abo-Paket geändert";
      }
      if (
        previous.plan?.id &&
        object.plan?.id &&
        previous.plan.id !== object.plan.id
      )
        return "Abo-Paket geändert";
      return "Abo aktualisiert";
    case "customer.updated":
      return "Kundendaten aktualisiert";
    default:
      return "Stripe-Ereignis: " + type;
  }
}
