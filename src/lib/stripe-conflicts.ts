export interface StripeBillingConflict {
  id: string;
  customer: string;
  customerId: string;
  subscriptionId: string;
  status: string;
  reason: string;
  blocked: boolean;
  children: { id: string; name: string }[];
  invoices: {
    id: string;
    number: string | null;
    remaining: number;
    currency: string;
    href: string;
  }[];
  href: string;
}
export interface StripeBillingConflictPage {
  rows: StripeBillingConflict[];
  checkedAt: string;
}

export function stripeActivityActions(
  rows: {
    id: string;
    subscriptionId: string | null;
    actionRequired: boolean;
    actionLabel: string | null;
    href: string | null;
  }[],
) {
  return new Set(
    rows
      .filter((r) => r.actionRequired)
      .map((r) =>
        r.actionLabel === "Verarbeitung prüfen"
          ? r.id
          : `${r.actionLabel}:${r.subscriptionId ?? r.href ?? r.id}`,
      ),
  ).size;
}
