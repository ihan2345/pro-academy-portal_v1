"use client";
import { StripeNoticeOverview } from "./stripe-notice-overview";
export function StripeActivityPreview({
  onReview,
  revision,
}: {
  onReview: (id: string) => void;
  revision: number;
}) {
  return (
    <StripeNoticeOverview
      section="activities"
      onReview={onReview}
      revision={revision}
    />
  );
}
