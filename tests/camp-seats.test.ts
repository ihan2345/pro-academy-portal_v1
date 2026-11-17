import { describe, expect, it } from "vitest";
import {
  CAMP_SCARCITY_SHARE,
  campSeats,
  campSeatsScarce,
} from "@/lib/camps/domain";

describe("Campplätze ab 80 % Auslastung", () => {
  it("zeigt freie Plätze erst ab 80 %", () => {
    expect(CAMP_SCARCITY_SHARE).toBe(0.8);
    expect(campSeatsScarce(39, 50)).toBe(false);
    expect(campSeatsScarce(40, 50)).toBe(true);
    expect(campSeatsScarce(0, 50)).toBe(false);
  });
  it("rechnet freie Plätze ohne negative Werte", () => {
    expect(campSeats(46, 50)).toEqual({ left: 4, maximum: 50, share: 0.92 });
    expect(campSeats(55, 50)).toEqual({ left: 0, maximum: 50, share: 1 });
  });
});
