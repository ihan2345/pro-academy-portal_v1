export interface StripeParentInputs {
  entries: {
    sessionId: string;
    subscriptionId: string | null;
    submittedAt: string;
    fields: { key: string; label: string; value: string | null }[];
  }[];
  partial: boolean;
}
