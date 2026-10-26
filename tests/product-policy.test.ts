import { describe, expect, it } from "vitest";
import {
  emptyProduct,
  openRule,
  type Product,
  type Rule,
} from "../src/lib/products/domain";
import { decideProduct, matchesRule } from "../src/lib/products/policy";
import { simulateProductContext } from "../src/lib/products/simulation";
const id = "e0000000-0000-4000-8000-000000000001";
const product = (patch: Partial<Product> = {}): Product => ({
  ...emptyProduct(),
  name: "Training",
  status: "active",
  channels: ["catalog"],
  price: {
    id: "price_target",
    product_id: "prod_target",
    amount: 9900,
    currency: "eur",
    interval: "month",
    interval_count: 1,
    livemode: false,
    checked_at: new Date().toISOString(),
    product_name: "Test",
    source: "stripe",
  },
  ...patch,
});
function decide(
  scenario: Parameters<typeof simulateProductContext>[0],
  p = product(),
) {
  const ctx = simulateProductContext(scenario, id);
  return decideProduct(p, id, ctx, "catalog", ctx.children[0]?.id);
}
it.each([
  ["visitor", "Jetzt anmelden & kaufen"],
  ["new", "Jetzt anmelden & kaufen"],
  ["trial", "Mitglied werden"],
  ["firsttouch", "Tarif wechseln"],
  ["gamechanger", "Tarif wechseln"],
  ["proplayer", "Tarif wechseln"],
  ["nextlevel", "Tarif wechseln"],
  ["former", "Mitgliedschaft reaktivieren"],
] as const)("derives %s purchase action from real context", (scenario, label) =>
  expect(decide(scenario).label).toBe(label),
);
it("uses camp action for former and trial families without creating Abo rights", () => {
  expect(decide("trial", product({ kind: "camp" })).label).toBe("Camp buchen");
  expect(decide("former", product({ kind: "camp" })).label).toBe("Camp buchen");
});
it.each(["draft", "archived", "sold_out"] as const)(
  "blocks %s even with individual grants",
  (status) => {
    const d = decide("individual", product({ status }));
    expect(d.purchasable).toBe(false);
  },
);
it("distinguishes family aggregate facts from same-child AND rules", () => {
  const ctx = simulateProductContext("mixed", id),
    rule: Rule = {
      mode: "all",
      clauses: [
        {
          scope: "player",
          mode: "all",
          include: ["subscriber", "trial"],
          exclude: [],
        },
      ],
    };
  expect(
    ctx.children.some((c) => matchesRule(rule, ctx, c, id, "purchase")),
  ).toBe(false);
  const family: Rule = {
    mode: "all",
    clauses: [{ ...rule.clauses[0], scope: "family" }],
  };
  expect(matchesRule(family, ctx, ctx.children[1], id, "purchase")).toBe(true);
  const p = product();
  expect(decideProduct(p, id, ctx, "catalog", ctx.children[0].id).mode).toBe(
    "change",
  );
  expect(decideProduct(p, id, ctx, "catalog", ctx.children[1].id).mode).toBe(
    "join",
  );
});
it("does not borrow individual child grants for a sibling", () => {
  const ctx = simulateProductContext("mixed", id);
  ctx.grants = [
    { product_id: id, purpose: "purchase", player_id: ctx.children[0].id },
  ];
  const rule: Rule = {
    mode: "all",
    clauses: [
      { scope: "player", mode: "any", include: ["individual"], exclude: [] },
    ],
  };
  expect(matchesRule(rule, ctx, ctx.children[0], id, "purchase")).toBe(true);
  expect(matchesRule(rule, ctx, ctx.children[1], id, "purchase")).toBe(false);
});
it("exclusions override the includes of their clause and purchase is independent of visibility", () => {
  const rule: Rule = {
    mode: "all",
    clauses: [
      {
        scope: "player",
        mode: "any",
        include: ["all", "individual"],
        exclude: ["trial"],
      },
    ],
  };
  const p = product({
    rules: { visibility: openRule(), purchase: rule, usage: openRule() },
  });
  const d = decide("trial", p);
  expect(d.visible).toBe(true);
  expect(d.purchasable).toBe(false);
});
it("requires selected child, prevents foreign IDs and protects the admin channel", () => {
  const ctx = simulateProductContext("new", id);
  expect(decideProduct(product(), id, ctx, "catalog").mode).toBe(
    "select_child",
  );
  expect(
    decideProduct(product(), id, ctx, "catalog", "foreign").purchasable,
  ).toBe(false);
  expect(
    decideProduct(
      product({ channels: ["admin"] }),
      id,
      ctx,
      "admin",
      ctx.children[0].id,
    ).visible,
  ).toBe(false);
});
it("keeps acquired rights after archive while preventing repeated purchases", () => {
  const ctx = simulateProductContext("new", id);
  ctx.children[0].purchases = [id];
  expect(
    decideProduct(
      product({ kind: "other", status: "archived" }),
      id,
      ctx,
      "catalog",
      ctx.children[0].id,
    ).usable,
  ).toBe(true);
  expect(
    decideProduct(
      product({ kind: "other" }),
      id,
      ctx,
      "catalog",
      ctx.children[0].id,
    ).label,
  ).toBe("Bereits gebucht");
  expect(
    decideProduct(
      product({ kind: "other", repeatable: true }),
      id,
      ctx,
      "catalog",
      ctx.children[0].id,
    ).purchasable,
  ).toBe(true);
});
it("never converts missing data or pending billing into permission", () => {
  const ctx = simulateProductContext("firsttouch", id);
  ctx.complete = false;
  expect(
    decideProduct(product(), id, ctx, "catalog", ctx.children[0].id)
      .purchasable,
  ).toBe(false);
  ctx.complete = true;
  ctx.children[0].memberships[0].status = "past_due";
  expect(
    decideProduct(product(), id, ctx, "catalog", ctx.children[0].id)
      .purchasable,
  ).toBe(false);
});
it("enforces publication windows using exact instants", () => {
  expect(
    decide(
      "trial",
      product({ publish_at: new Date(Date.now() + 86400000).toISOString() }),
    ).purchasable,
  ).toBe(false);
  expect(
    decide(
      "trial",
      product({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    ).visible,
  ).toBe(false);
});
it("keeps time-hour descriptions separate from existing unit entitlements", () => {
  const p = product({
    training_content: {
      football_hours: 6,
      athletics_hours: 2,
      camp_hours: null,
    },
  });
  const ctx = simulateProductContext("firsttouch", id);
  expect(ctx.children[0].memberships[0].units).toBe(4);
  expect(decideProduct(p, id, ctx, "catalog", ctx.children[0].id).mode).toBe(
    "change",
  );
});
it("does not expose an exclusive offer configured with open visibility", () => {
  expect(decide("new", product({ status: "exclusive" })).visible).toBe(false);
});
it("keeps purchased Abo rights in the specialist model even when shop usage rules change", () => {
  const ctx = simulateProductContext("firsttouch", id),
    p = product();
  p.price!.id = ctx.children[0].memberships[0].price_id;
  p.rules.usage = {
    mode: "all",
    clauses: [
      {
        scope: "player",
        mode: "any",
        include: ["all"],
        exclude: ["subscriber"],
      },
    ],
  };
  expect(decideProduct(p, id, ctx, "catalog", ctx.children[0].id).usable).toBe(
    true,
  );
});
