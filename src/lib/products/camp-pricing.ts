import type { CampSeats } from "@/lib/camps/domain";
export type CampPricing = {
  early_until: string | null;
  benefit_available: boolean;
  percent: number;
  personal_amount: number | null;
  child_name: string | null;
  // Nur gesetzt, wenn das Camp zu mindestens 80 % ausgelastet ist.
  seats?: CampSeats | null;
};

export function personalCampAmount(amount: number, percent: number) {
  // Match Checkout's cent rounding: reduce the base (including early-bird) price.
  return amount - Math.round((amount * percent) / 100);
}
