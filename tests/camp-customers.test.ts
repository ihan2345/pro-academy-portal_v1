import { expect, it } from "vitest";
import {
  campCustomerGroup,
  campCustomersCsv,
  selectCampCustomers,
  type CampCustomer,
} from "../src/lib/camps/customers";
import { campRows } from "../src/lib/camps/customer-groups";

const start = "2026-11-13T12:00:00Z";
it("classifies active subscribers independently of a disabled or zero discount", () => {
  expect(
    campCustomerGroup({
      activeSubscription: true,
      parentCreatedAt: "2020-01-01",
      bookingStartedAt: start,
    }),
  ).toBe("subscriber");
});
it("only identifies families acquired by this booking as new", () => {
  expect(
    campCustomerGroup({
      activeSubscription: false,
      parentCreatedAt: "2026-11-13T12:05:00Z",
      bookingStartedAt: start,
    }),
  ).toBe("new");
  expect(
    campCustomerGroup({
      activeSubscription: false,
      parentCreatedAt: start,
      bookingStartedAt: start,
    }),
  ).toBe("new");
});
it("treats former subscribers, returning camp families, and new siblings in existing accounts as without subscription", () => {
  expect(
    campCustomerGroup({
      activeSubscription: false,
      parentCreatedAt: "2025-01-01",
      bookingStartedAt: start,
    }),
  ).toBe("none");
  expect(
    campCustomerGroup({ activeSubscription: false, bookingStartedAt: start }),
  ).toBe("none");
  // The account created by an earlier camp is already present for the next booking.
  expect(
    campCustomerGroup({
      activeSubscription: false,
      parentCreatedAt: "2026-11-13T12:05:00Z",
      bookingStartedAt: "2026-11-14T12:00:00Z",
    }),
  ).toBe("none");
});
function row(id: string, data: Partial<CampCustomer> = {}): CampCustomer {
  return {
    id,
    first_name: "Test",
    last_name: id,
    birth_date: "2015-01-01",
    birth_year: "2015",
    gender: "keine Angabe",
    clothing_size: "152",
    parent_name: "Eltern",
    email: "test@example.invalid",
    phone: "+491234",
    customer_group: "none",
    booked_at: start,
    option_title: "",
    attendance: "Gebucht",
    currency: "eur",
    ...data,
  };
}
it("combines group filters and search without changing the original list", () => {
  const rows = [
    row("c", { customer_group: "subscriber" }),
    row("b", { customer_group: "new" }),
    row("a"),
  ];
  expect(
    selectCampCustomers(rows, ["subscriber", "new"], "last_name", "asc").map(
      (r) => r.id,
    ),
  ).toEqual(["b", "c"]);
  expect(selectCampCustomers(rows, [], "last_name", "asc")).toEqual([]);
  expect(
    selectCampCustomers(rows, ["none"], "last_name", "asc", "ELTERN").map(
      (r) => r.id,
    ),
  ).toEqual(["a"]);
  expect(rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
});
it("sorts sizes naturally, then adult clothing in size order", () => {
  const rows = ["XL", "152", "S", "M", "128"].map((clothing_size) =>
    row(clothing_size, { clothing_size }),
  );
  expect(
    selectCampCustomers(rows, ["none"], "clothing_size", "asc").map(
      (r) => r.clothing_size,
    ),
  ).toEqual(["128", "152", "S", "M", "XL"]);
});
it("sorts birth years and booking dates in both directions with missing values last", () => {
  const rows = [
    row("a", { birth_year: "2017", booked_at: "2026-11-12T12:00:00Z" }),
    row("b", { birth_year: "2010", booked_at: "2026-11-14T12:00:00Z" }),
    row("c", { birth_year: "" }),
  ];
  expect(
    selectCampCustomers(rows, ["none"], "birth_year", "desc").map((r) => r.id),
  ).toEqual(["a", "b", "c"]);
  expect(
    selectCampCustomers(rows, ["none"], "booked_at", "asc").map((r) => r.id),
  ).toEqual(["a", "c", "b"]);
});
it("exports the selected order, all requested fields, quoted multiline text, and safe spreadsheet values", () => {
  const rows = [
    row("a", {
      first_name: '=HYPERLINK("https://example.invalid")',
      option_title: 'Ohne; Set\n"Test"',
    }),
    row("b"),
  ];
  const selected = selectCampCustomers(rows, ["none"], "last_name", "desc");
  const csv = campCustomersCsv(selected, [
    "last_name",
    "first_name",
    "phone",
    "option_title",
    "customer_group",
  ]);
  expect(csv.startsWith('\uFEFF"Nachname";')).toBe(true);
  expect(csv.indexOf('"b";')).toBeLessThan(csv.indexOf('"a";'));
  expect(csv).toContain("'=HYPERLINK");
  expect(csv).toContain('"\'+491234"');
  expect(csv).toContain('"Ohne; Set\n""Test"""');
  expect(csv).toContain('"Ohne Abo"');
});
it("reads more than one REST page and fails rather than returning partial exports", async () => {
  const rows = Array.from({ length: 1001 }, (_, id) => ({ id }));
  expect(
    await campRows(async (from, to) => ({
      data: rows.slice(from, to + 1),
      error: null,
    })),
  ).toHaveLength(1001);
  await expect(
    campRows(async (from, to) =>
      from
        ? { data: null, error: new Error("failed") }
        : { data: rows.slice(from, to + 1), error: null },
    ),
  ).rejects.toMatchObject({ status: 503 });
});
