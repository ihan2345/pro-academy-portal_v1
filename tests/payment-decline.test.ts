import { expect, it } from "vitest";
import { declineReason } from "@/lib/payment-decline";

it("translates bank decline codes into short German reasons", () => {
  expect(
    declineReason({
      failure_code: "card_declined",
      outcome_reason: "insufficient_funds",
    }),
  ).toBe("Nicht genügend Deckung");
  expect(declineReason({ failure_code: "expired_card" })).toBe(
    "Karte abgelaufen",
  );
  expect(declineReason({ failure_code: "debit_not_authorized" })).toBe(
    "Lastschrift nicht autorisiert (Widerspruch)",
  );
});

it("falls back to Stripe's own text, then the raw code", () => {
  expect(
    declineReason({
      failure_code: "something_new",
      failure_message: "Bank says no.",
    }),
  ).toBe("Bank says no.");
  expect(declineReason({ failure_code: "something_new" })).toBe(
    "Abgelehnt (something_new)",
  );
  expect(declineReason({ failure_code: "card_declined" })).toBe(
    "Von der Bank abgelehnt",
  );
  expect(declineReason({ outcome_type: "blocked" })).toContain("blockiert");
  expect(declineReason({})).toBeNull();
});
