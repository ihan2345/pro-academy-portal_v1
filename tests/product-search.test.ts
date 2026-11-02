import { beforeEach, expect, it, vi } from "vitest";
import {
  emptyProduct,
  visitorContext,
  type Product,
} from "../src/lib/products/domain";
import { productShopSearchText } from "../src/lib/products/search";
const state = vi.hoisted(() => ({
  rows: [] as any[],
  filters: [] as string[],
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from(table: string) {
      if (table !== "catalog_products")
        throw Error("Unexpected table: " + table);
      const filters: ((row: any) => boolean)[] = [];
      let size = Infinity;
      const val = (r: any, k: string) =>
        k.startsWith("published->>") ? r.published?.[k.slice(12)] : r[k];
      const query: any = {
        select: () => query,
        order: () => query,
        limit: (n: number) => {
          size = n;
          return query;
        },
        eq: (k: string, v: any) => {
          filters.push((r) => val(r, k) === v);
          return query;
        },
        not: (k: string, _op: string, v: any) => {
          filters.push((r) => val(r, k) !== v);
          return query;
        },
        ilike: (k: string, v: string) => {
          state.filters.push(k + ":" + v);
          filters.push((r) => val(r, k)?.includes(v.slice(1, -1)));
          return query;
        },
        textSearch: () => {
          throw Error("Public search must not use whole-word websearch");
        },
        or: (v: string) => {
          if (v.includes("published->>kind.neq.gift")) {
            const giftId = v.match(/(?:^|[,\(])id\.eq\.([\da-f-]+)/)?.[1];
            filters.push(
              (r) => r.published?.kind !== "gift" || r.id === giftId,
            );
          }
          const priority = v.match(/published_priority\.lt\.(-?\d+)/)?.[1];
          if (priority) {
            const created = v.match(/created_at\.lt\.([^,)]+)/)![1],
              id = v.match(/id\.lt\.([\da-f-]+)/)![1];
            filters.push(
              (r) =>
                r.published_priority < +priority ||
                (r.published_priority === +priority &&
                  (r.created_at < created ||
                    (r.created_at === created && r.id < id))),
            );
          }
          return query;
        },
        then: (resolve: any, reject: any) =>
          Promise.resolve({
            data: state.rows
              .filter((r) => filters.every((f) => f(r)))
              .sort(
                (a, b) =>
                  b.published_priority - a.published_priority ||
                  b.created_at.localeCompare(a.created_at) ||
                  b.id.localeCompare(a.id),
              )
              .slice(0, size),
            error: null,
          }).then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock("../src/lib/server/products/runtime", () => ({
  requireProducts: () => {},
  productLiveMode: () => false,
}));
vi.mock("../src/lib/gifts/runtime", () => ({ giftsEnabled: () => true }));
vi.mock("../src/lib/server/products/context", async (original) => ({
  ...(await original<typeof import("../src/lib/server/products/context")>()),
  loadProductContext: async () => visitorContext(),
}));
import { listProducts } from "../src/lib/server/products/catalog";
const id = (n: number) =>
  `d6000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function row(n: number, patch: Partial<Product> = {}) {
  const p = {
    ...emptyProduct(),
    name: "Training " + n,
    status: "active" as const,
    channels: ["catalog" as const],
    ...patch,
  };
  return {
    id: id(n),
    name: "INTERNAL ONLY",
    published: p,
    published_revision: 1,
    published_shop_search: productShopSearchText(p),
    published_priority: p.priority,
    created_at: "2026-11-02T08:00:00Z",
  };
}
beforeEach(() => {
  state.rows = [];
  state.filters = [];
});
it("applies every normalized search term before paging while retaining the visibility rules", async () => {
  state.rows = [
    ...Array.from({ length: 26 }, (_, i) =>
      row(i + 1, {
        status: "draft",
        priority: 10,
        name: "Fußballtraining GameChanger verborgen",
      }),
    ),
    ...Array.from({ length: 30 }, (_, i) =>
      row(i + 101, { name: "Fußballtraining GameChanger " + i }),
    ),
  ];
  const first = await listProducts(
    null,
    new URLSearchParams({ q: "Fussball Game", channel: "catalog" }),
  );
  expect(first.rows).toHaveLength(24);
  expect(first.next).toBeTruthy();
  const next = await listProducts(
    null,
    new URLSearchParams({
      q: "Fussball Game",
      channel: "catalog",
      cursor: first.next!,
    }),
  );
  expect(next.rows).toHaveLength(6);
  expect(next.next).toBeNull();
  expect(new Set([...first.rows, ...next.rows].map((r) => r.id)).size).toBe(30);
  expect(state.filters).toContain("published_shop_search:%fussball%");
  expect(state.filters).toContain("published_shop_search:%game%");
  await expect(
    listProducts(
      null,
      new URLSearchParams({ q: "anderer Begriff", cursor: first.next! }),
    ),
  ).rejects.toThrow("Filter geändert");
});
it("keeps all gift values and selects a matching representative when only one gift product matches", async () => {
  state.rows = [
    row(1, { name: "Sommerfreude", kind: "gift", gift_amounts: [1000] }),
    row(2, { name: "Winterfreude", kind: "gift", gift_amounts: [2500, 5000] }),
  ];
  const found = await listProducts(
    null,
    new URLSearchParams({ q: "Sommer", channel: "catalog" }),
  );
  expect(found.rows.map((r) => r.id)).toEqual([id(1)]);
  expect(found.rows[0].name).toBe("Geschenkkarte");
  expect(found.rows[0].gift_variants.map((v: any) => v.amount)).toEqual([
    1000, 2500, 5000,
  ]);
  const alias = await listProducts(
    null,
    new URLSearchParams({ q: "Gutschein", channel: "catalog" }),
  );
  expect(alias.rows).toHaveLength(1);
  const none = await listProducts(
    null,
    new URLSearchParams({ q: "KeinTreffer", channel: "catalog" }),
  );
  expect(none.rows).toHaveLength(0);
});
