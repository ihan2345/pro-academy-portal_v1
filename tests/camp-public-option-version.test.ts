import { expect, it } from "vitest";
import { emptyProduct } from "../src/lib/products/domain";
import { publicProduct } from "../src/lib/server/products/catalog";
it("delivers the 199 EUR no-shirt option with its Camp version independently of publication revision and Abo settings", () => {
  const published = {
    ...emptyProduct(),
    kind: "camp" as const,
    status: "active" as const,
    camp_id: "90000000-0000-4000-8000-000000000001",
    member_benefits_enabled: false,
    booking_option_version: 1,
    booking_option: {
      amount: 19900,
      title: "Ohne ProAcademy Trikot-Set",
      description: "Eigenes Trikot",
      alert: "Bestätigen",
    },
  };
  const result = publicProduct(
    {
      id: "90000000-0000-4000-8000-000000000002",
      published_revision: 2,
      published,
    } as any,
    {} as any,
  );
  expect(result).toMatchObject({
    revision: 2,
    booking_option_version: 1,
    booking_option: { amount: 19900 },
    member_benefits_enabled: false,
    camp_booking_url:
      "/camp/buchung/90000000-0000-4000-8000-000000000001?product=90000000-0000-4000-8000-000000000002",
  });
});
