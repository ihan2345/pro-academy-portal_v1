import { expect, it } from "vitest";
import { emptyProduct, productSchema } from "../src/lib/products/domain";

it("loads older product data without discarding legacy sorting or requiring new presentation fields", () => {
  const { priority, effect_color, sale_enabled, sale_audiences, ...legacy } =
    emptyProduct();
  const product = productSchema.parse({ ...legacy, sort_order: 999 });
  expect(product).toMatchObject({
    sort_order: 999,
    priority: 0,
    effect_color: "#8B53FE",
    sale_enabled: false,
    sale_audiences: [],
  });
});

it("preserves an explicit colour and multiple sale audiences through serialization", () => {
  const product = {
    ...emptyProduct(),
    priority: 10,
    effect_color: "#F57C00",
    sale_enabled: true,
    sale_audiences: ["subscriber", "camp"],
  };
  expect(productSchema.parse(JSON.parse(JSON.stringify(product)))).toEqual(
    product,
  );
});

it.each([
  { priority: -1 },
  { priority: 11 },
  { priority: 2.5 },
  { effect_color: "orange" },
  { effect_color: "#abc" },
  { sale_enabled: true, sale_audiences: [] },
  { sale_enabled: true, sale_audiences: ["unknown"] },
])("rejects invalid presentation input %j", (patch) => {
  expect(productSchema.safeParse({ ...emptyProduct(), ...patch }).success).toBe(
    false,
  );
});
