import type { StripeBillingConflict } from "./stripe-conflicts";
import type { StripeActivity } from "./stripe-activities";
import { calendarDate } from "./calendar";

export type StripeNoticeState = "open" | "done" | "ignored";
export interface StripeNotice {
  id: string;
  kind: "billing" | "review" | "activity";
  at: string;
  customer: string;
  title: string;
  actionRequired: boolean;
  state: StripeNoticeState;
  resolvedAutomatically?: boolean;
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
  /** Anzahl Familien je Art im gewählten Zeitraum/Status (nur Aktivitäten). */
  typeCounts?: Record<StripeNoticeType, number>;
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

/** Schalter der Stripe-Aktivitäten: alle, neue Abos oder Kündigungen. */
export type StripeNoticeType = "all" | "new" | "cancel";
const NEW_TITLES = ["Neues Abo abgeschlossen"];
const CANCEL_TITLES = [
  "Abo zum Laufzeitende gekündigt",
  "Abo beendet",
  "Abo-Kündigung zurückgenommen",
];
export function stripeNoticeType(row: Pick<StripeNotice, "title">) {
  return NEW_TITLES.includes(row.title)
    ? ("new" as const)
    : CANCEL_TITLES.includes(row.title)
      ? ("cancel" as const)
      : null;
}
export interface StripeNoticeGroup {
  key: string;
  customer: string;
  /** Neueste zuerst. */
  rows: StripeNotice[];
  /** Was oben steht: offene Aktion, sonst Abo-Start/Kündigung, sonst das neueste. */
  lead: StripeNotice;
}
/**
 * Fasst Stripe-Ereignisse derselben Familie am selben Tag zusammen (wie die
 * Glocke). Eingabe und Ausgabe neueste zuerst.
 */
export function groupStripeNotices(rows: StripeNotice[]) {
  const groups = new Map<string, StripeNoticeGroup>();
  const rank = (r: StripeNotice) =>
    openStripeNotice(r) ? 2 : stripeNoticeType(r) ? 1 : 0;
  const sorted = [...rows].sort(
    (a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id),
  );
  for (const r of sorted) {
    const key = `${r.customer.trim().toLowerCase()}:${calendarDate(r.at)}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { key, customer: r.customer, rows: [r], lead: r });
    else {
      g.rows.push(r);
      if (rank(r) > rank(g.lead)) g.lead = r;
    }
  }
  return [...groups.values()];
}
export function matchesStripeNoticeType(
  group: StripeNoticeGroup,
  type: StripeNoticeType,
) {
  return type === "all" || group.rows.some((r) => stripeNoticeType(r) === type);
}
