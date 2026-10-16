export interface SubscriptionReview {
  id: string;
  signature: string;
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
