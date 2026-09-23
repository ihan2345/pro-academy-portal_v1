export type CustomerSort =
  "name-asc" | "name-desc" | "added-desc" | "added-asc";
export interface RegistryCustomer {
  id: string;
  name: string | null;
  email: string | null;
  first_seen_at: string;
  assigned: boolean;
}
export function filterCustomers<T extends RegistryCustomer>(
  customers: T[],
  query: string,
  sort: CustomerSort,
  recent: boolean,
  now = Date.now(),
): T[] {
  const term = query.trim().toLocaleLowerCase("de");
  return customers
    .filter(
      (c) =>
        `${c.name ?? ""} ${c.email ?? ""} ${c.id}`
          .toLocaleLowerCase("de")
          .includes(term) &&
        (!recent || Date.parse(c.first_seen_at) >= now - 14 * 86400000),
    )
    .sort((a, b) => {
      const value = sort.startsWith("name")
        ? (a.name ?? a.email ?? a.id).localeCompare(
            b.name ?? b.email ?? b.id,
            "de",
            { sensitivity: "base" },
          )
        : a.first_seen_at.localeCompare(b.first_seen_at);
      return (
        (sort.endsWith("desc") ? -value : value) || a.id.localeCompare(b.id)
      );
    });
}
