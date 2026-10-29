import type { StripeBillingConflict } from "./stripe-conflicts";
import type { StripeActivity } from "./stripe-activities";

export type StripeNoticeState = "open" | "done" | "ignored";
export interface StripeNotice {
  id: string;
  kind: "billing" | "review" | "activity";
  at: string;
  customer: string;
  title: string;
  actionRequired: boolean;
  state: StripeNoticeState;
  token: string;
  billing?: StripeBillingConflict;
  activity?: StripeActivity;
  reviewId?: string;
}
export interface StripeNoticePage {
  rows: StripeNotice[];
  total: number;
  openCount: number;
  checkedAt: string;
  warning?: string;
}
export const STRIPE_NOTICE_PAGE_SIZE = 10;
export const STRIPE_NOTICE_MONTH = 30 * 86400000;
export function recentStripeNotice(at: string, now: number) {
  const date = Date.parse(at);
  return date >= now - STRIPE_NOTICE_MONTH && date <= now;
}
export function stripeNoticeCount(rows: StripeNotice[], now: number) {
  return rows.filter(
    (r) => openStripeNotice(r) && recentStripeNotice(r.at, now),
  ).length;
}
export function openStripeNotice(row: StripeNotice) {
  return row.actionRequired && row.state === "open";
}
