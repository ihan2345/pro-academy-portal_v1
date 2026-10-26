import {
  visitorContext,
  type ProductContext,
  type ProductChild,
  type Audience,
} from "./domain";
export const scenarios = {
  visitor: "Besucher",
  new: "Neukunde",
  trial: "Probetraining",
  firsttouch: "FirstTouch",
  gamechanger: "GameChanger",
  proplayer: "ProPlayer",
  nextlevel: "NextLevel",
  former: "Ehemaliger Kunde",
  camp: "Campkunde",
  mixed: "Gemischte Familie",
  internal: "Interner Nutzer",
  individual: "Individuelle Freigabe",
} as const;
export function simulateProductContext(
  scenario: keyof typeof scenarios,
  productId: string,
): ProductContext {
  const ctx = visitorContext();
  if (scenario === "visitor") return ctx;
  ctx.auth_id = "00000000-0000-4000-8000-000000000001";
  ctx.parent_id = "00000000-0000-4000-8000-000000000002";
  ctx.role = scenario === "internal" ? "staff" : "parent";
  const child: ProductChild = {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Kind A · Simulation",
    first_name: "Kind",
    last_name: "A",
    birth_date: "2016-01-01",
    trial: scenario === "trial",
    former_trial: false,
    memberships: [],
    camp_ids: scenario === "camp" ? ["simulation"] : [],
    purchases: [],
  };
  const names = {
    firsttouch: "FirstTouch",
    gamechanger: "GameChanger",
    proplayer: "Pro-Player",
    nextlevel: "NEXT LEVEL",
    mixed: "GameChanger",
    former: "GameChanger",
  };
  if (scenario in names)
    child.memberships.push({
      subscription_id: "simulation",
      stripe_subscription_id: "sub_simulation",
      item_id: "si_simulation",
      price_id: "price_simulation",
      status: scenario === "former" ? "canceled" : "active",
      review: false,
      current: scenario !== "former",
      plan: names[scenario as keyof typeof names],
      units: scenario === "firsttouch" ? 4 : 8,
      athletics: scenario === "nextlevel" ? 4 : 0,
      interval: "month",
      ends_at: null,
    });
  ctx.children = [child];
  if (scenario === "mixed")
    ctx.children.push({
      ...child,
      id: "00000000-0000-4000-8000-000000000004",
      name: "Kind B · Probetraining",
      trial: true,
      memberships: [],
    });
  if (scenario === "individual")
    ctx.grants = (["visibility", "purchase", "usage"] as const).map(
      (purpose) => ({ product_id: productId, purpose, player_id: child.id }),
    );
  return ctx;
}
