import "server-only";
import type { ProductContext } from "@/lib/products/domain";
import type { CampPricing } from "@/lib/products/camp-pricing";
import { personalCampAmount } from "@/lib/products/camp-pricing";
import { childBenefit } from "@/lib/camps/service";
import { serviceDb } from "../service-db";
import { checked } from "./context";

export async function campPricingForCatalog(
  offerIds: string[],
  ctx: ProductContext,
  player?: string,
  newChild = false,
) {
  const result = new Map<
    string,
    CampPricing & { price_id: string; amount: number }
  >();
  if (!offerIds.length) return result;
  const child =
    !newChild && ctx.role === "parent"
      ? ctx.children.find(
          (c) =>
            c.id ===
            (player || (ctx.children.length === 1 ? ctx.children[0].id : "")),
        )
      : undefined;
  const db = serviceDb();
  // One offer query for the page; resolve a child's benefit once for all camp cards.
  const [offers, plans, benefit] = await Promise.all([
    db
      .from("camp_offers")
      .select(
        "id,kind,stripe_price_id,amount,codes,camps!inner(early_bird_until)",
      )
      .in("id", [...new Set(offerIds)]),
    db
      .from("plans")
      .select("camp_benefit_percent")
      .or("is_camp.is.null,is_camp.eq.false")
      .in("camp_benefit_percent", [10, 15, 20]),
    child && !child.reserved
      ? childBenefit(child.id)
      : Promise.resolve({ percent: 0 }),
  ]);
  const available = checked(plans).length > 0;
  for (const offer of checked<any[]>(offers)) {
    const deadline = offer.camps.early_bird_until;
    const currentKind =
      deadline && Date.now() < Date.parse(deadline) ? "early" : "main";
    if (offer.kind !== currentKind) continue;
    const early =
      offer.kind === "early" && deadline && Date.now() < Date.parse(deadline);
    const percent =
      benefit.percent && offer.codes?.[String(benefit.percent)]
        ? benefit.percent
        : 0;
    result.set(offer.id, {
      price_id: offer.stripe_price_id,
      amount: offer.amount,
      early_until: early ? deadline : null,
      benefit_available:
        available &&
        Object.keys(offer.codes ?? {}).some((p) =>
          ["10", "15", "20"].includes(p),
        ),
      percent,
      personal_amount: percent
        ? personalCampAmount(offer.amount, percent)
        : null,
      child_name: child?.first_name ?? null,
    });
  }
  return result;
}
