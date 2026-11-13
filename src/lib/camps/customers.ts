export const campCustomerGroups = {
  subscriber: "Aktives Abo",
  new: "Neukunde",
  none: "Ohne Abo",
} as const;
export type CampCustomerGroup = keyof typeof campCustomerGroups;

/** New describes the family acquired by this booking, never a missing discount. */
export function campCustomerGroup(input: {
  activeSubscription: boolean;
  parentCreatedAt?: string | null;
  bookingStartedAt: string;
}): CampCustomerGroup {
  if (input.activeSubscription) return "subscriber";
  const parent = Date.parse(input.parentCreatedAt ?? "");
  const booking = Date.parse(input.bookingStartedAt);
  return Number.isFinite(parent) &&
    Number.isFinite(booking) &&
    parent >= booking
    ? "new"
    : "none";
}

export type CampCustomer = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  birth_year: string;
  gender: string;
  clothing_size: string;
  parent_name: string;
  email: string;
  phone: string;
  customer_group: CampCustomerGroup;
  booked_at: string;
  option_title: string;
  attendance: string;
  paid_amount?: number | null;
  currency: string;
};
export const customerColumns = {
  last_name: "Nachname",
  first_name: "Vorname",
  birth_date: "Geburtsdatum",
  birth_year: "Geburtsjahr",
  clothing_size: "Kleidergröße",
  gender: "Geschlecht",
  customer_group: "Kundengruppe",
  parent_name: "Eltern / Kontakt",
  email: "E-Mail",
  phone: "Telefon",
  booked_at: "Buchungsdatum",
  option_title: "Buchungsoption",
  attendance: "Teilnahmestatus",
  paid_amount: "Bezahlt",
} as const;
export type CustomerSort = keyof typeof customerColumns;
const compare = new Intl.Collator("de", { numeric: true, sensitivity: "base" });
const clothingOrder = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
function compareClothing(a: string, b: string) {
  const ai = clothingOrder.indexOf(a.toUpperCase());
  const bi = clothingOrder.indexOf(b.toUpperCase());
  if (ai >= 0 && bi >= 0) return ai - bi;
  if (/^\d+$/.test(a) && bi >= 0) return -1;
  if (/^\d+$/.test(b) && ai >= 0) return 1;
  return compare.compare(a, b);
}
export function selectCampCustomers(
  rows: CampCustomer[],
  groups: CampCustomerGroup[],
  sort: CustomerSort,
  direction: "asc" | "desc",
  search = "",
) {
  const term = search.trim().toLocaleLowerCase("de");
  return rows
    .filter((r) => groups.includes(r.customer_group))
    .filter(
      (r) =>
        !term ||
        [r.first_name, r.last_name, r.parent_name, r.email, r.phone].some((v) =>
          v.toLocaleLowerCase("de").includes(term),
        ),
    )
    .sort((a, b) => {
      const av = a[sort],
        bv = b[sort];
      // Missing values stay at the end in either direction.
      if (av == null || av === "")
        return bv == null || bv === "" ? compare.compare(a.id, b.id) : 1;
      if (bv == null || bv === "") return -1;
      const result =
        sort === "paid_amount"
          ? Number(av) - Number(bv)
          : sort === "clothing_size"
            ? compareClothing(String(av), String(bv))
            : compare.compare(
                sort === "customer_group"
                  ? campCustomerGroups[a.customer_group]
                  : String(av),
                sort === "customer_group"
                  ? campCustomerGroups[b.customer_group]
                  : String(bv),
              );
      return (
        (direction === "asc" ? result : -result) ||
        compare.compare(
          `${a.last_name} ${a.first_name} ${a.id}`,
          `${b.last_name} ${b.first_name} ${b.id}`,
        )
      );
    });
}

export function customerCell(row: CampCustomer, key: CustomerSort): string {
  if (key === "customer_group") return campCustomerGroups[row.customer_group];
  if (key === "paid_amount")
    return row.paid_amount == null
      ? ""
      : new Intl.NumberFormat("de-DE", {
          style: "currency",
          currency: row.currency,
        }).format(row.paid_amount / 100);
  if (key === "birth_date")
    return row.birth_date ? row.birth_date.split("-").reverse().join(".") : "";
  if (key === "booked_at")
    return row.booked_at
      ? new Intl.DateTimeFormat("de-DE", {
          timeZone: "Europe/Berlin",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(row.booked_at))
      : "";
  return String(row[key] ?? "");
}
function csvCell(value: string) {
  // Spreadsheet applications may execute formulas even inside quoted CSV cells.
  const safe =
    /^[\s\u0000-\u001f]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)
      ? `'${value}`
      : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function campCustomersCsv(
  rows: CampCustomer[],
  columns: CustomerSort[],
) {
  return (
    "\uFEFF" +
    [
      columns.map((c) => customerColumns[c]),
      ...rows.map((row) => columns.map((c) => customerCell(row, c))),
    ]
      .map((row) => row.map(csvCell).join(";"))
      .join("\r\n")
  );
}
