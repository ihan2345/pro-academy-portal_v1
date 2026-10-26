import { z } from "zod";

export const productIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Ungültige Datenbank-ID",
  );

export const audiences = {
  all: "Alle",
  visitor: "Besucher",
  new: "Neukunden",
  trial: "Probetraining-Kunden",
  former_trial: "Ehemalige Probetraining-Kunden",
  subscriber: "Abo-Kunden",
  firsttouch: "FirstTouch",
  gamechanger: "GameChanger",
  proplayer: "ProPlayer",
  nextlevel: "NextLevel",
  former: "Ehemalige Abonnenten",
  camp: "Camp-Kunden",
  internal: "Interne Nutzer",
  individual: "Individuell freigegeben",
} as const;
export const channelLabels = {
  homepage: "Öffentliche Homepage",
  parents: "Elternportal",
  trials: "Probetraining-Portal",
  catalog: "Zentrale Produktübersicht",
  admin: "Interne Administration",
} as const;
export const statusLabels = {
  draft: "Entwurf",
  active: "Aktiv",
  internal: "Intern",
  exclusive: "Exklusiv",
  sold_out: "Ausverkauft",
  archived: "Archiviert",
} as const;
export const kindLabels = {
  subscription: "Abonnement",
  camp: "Camp",
  other: "Sonstiges",
} as const;
export type Audience = keyof typeof audiences;
export type Channel = keyof typeof channelLabels;
const audienceSchema = z.enum(
  Object.keys(audiences) as [Audience, ...Audience[]],
);
const clauseSchema = z
  .object({
    scope: z.enum(["family", "player"]),
    mode: z.enum(["any", "all"]),
    include: z.array(audienceSchema).min(1).max(15),
    exclude: z.array(audienceSchema).max(15),
  })
  .strict();
export const ruleSchema = z
  .object({
    mode: z.enum(["any", "all"]),
    clauses: z.array(clauseSchema).min(1).max(12),
  })
  .strict();
export type Rule = z.infer<typeof ruleSchema>;
export const openRule = (): Rule => ({
  mode: "all",
  clauses: [{ scope: "player", mode: "any", include: ["all"], exclude: [] }],
});
export const priceSchema = z
  .object({
    id: z.string().regex(/^price_[A-Za-z0-9_]+$/),
    product_id: z.string().regex(/^prod_[A-Za-z0-9_]+$/),
    amount: z.number().int().positive(),
    currency: z.string().regex(/^[a-z]{3}$/),
    interval: z.enum(["month", "year"]).nullable(),
    interval_count: z.literal(1),
    livemode: z.boolean(),
    checked_at: z.iso.datetime(),
    product_name: z.string(),
    source: z.enum(["stripe", "fixture"]).default("stripe"),
  })
  .strict();
export type ProductPrice = z.infer<typeof priceSchema>;
export const productSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    internal_name: z.string().trim().max(160),
    description: z.string().max(12000),
    short_description: z.string().max(300),
    category: z.string().trim().max(80),
    kind: z.enum(["subscription", "camp", "other"]),
    status: z.enum([
      "draft",
      "active",
      "internal",
      "exclusive",
      "sold_out",
      "archived",
    ]),
    sort_order: z.number().int().min(-1000000).max(1000000),
    featured: z.boolean(),
    publish_at: z.iso.datetime().nullable(),
    expires_at: z.iso.datetime().nullable(),
    channels: z
      .array(z.enum(Object.keys(channelLabels) as [Channel, ...Channel[]]))
      .max(5),
    price: priceSchema.nullable(),
    plan_id: productIdSchema.nullable(),
    camp_offer_id: productIdSchema.nullable(),
    repeatable: z.boolean(),
    training_content: z
      .object({
        football_hours: z.number().min(0).max(10000).nullable(),
        athletics_hours: z.number().min(0).max(10000).nullable(),
        camp_hours: z.number().min(0).max(10000).nullable(),
      })
      .strict()
      .default({
        football_hours: null,
        athletics_hours: null,
        camp_hours: null,
      }),
    rules: z
      .object({
        visibility: ruleSchema,
        purchase: ruleSchema,
        usage: ruleSchema,
      })
      .strict(),
    asset_ids: z.array(productIdSchema).max(20),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.publish_at &&
      v.expires_at &&
      Date.parse(v.publish_at) >= Date.parse(v.expires_at)
    )
      c.addIssue({
        code: "custom",
        message: "Ablauf muss nach Veröffentlichung liegen.",
        path: ["expires_at"],
      });
    if (
      v.status === "exclusive" &&
      v.rules.visibility.clauses.some(
        (c) => c.include.includes("all") || c.include.includes("visitor"),
      )
    )
      c.addIssue({
        code: "custom",
        message:
          "Exklusive Angebote benötigen ausdrücklich eingeschränkte Sichtbarkeitsregeln ohne Alle/Besucher.",
        path: ["rules", "visibility"],
      });
    if (v.kind !== "subscription" && v.plan_id)
      c.addIssue({
        code: "custom",
        message: "Tarifbezug nur bei Abonnements.",
        path: ["plan_id"],
      });
    if (v.kind !== "camp" && v.camp_offer_id)
      c.addIssue({
        code: "custom",
        message: "Campbezug nur bei Camps.",
        path: ["camp_offer_id"],
      });
  });
export type Product = z.infer<typeof productSchema>;
export type ProductRecord = {
  id: string;
  revision: number;
  name: string;
  kind: Product["kind"];
  status: Product["status"];
  draft: Product;
  published: Product | null;
  published_revision: number | null;
  updated_at: string;
};
export const emptyProduct = (): Product => ({
  name: "Neues Produkt",
  internal_name: "",
  description: "",
  short_description: "",
  category: "",
  kind: "subscription",
  status: "draft",
  sort_order: 0,
  featured: false,
  publish_at: null,
  expires_at: null,
  channels: [],
  price: null,
  plan_id: null,
  camp_offer_id: null,
  repeatable: false,
  training_content: {
    football_hours: null,
    athletics_hours: null,
    camp_hours: null,
  },
  rules: { visibility: openRule(), purchase: openRule(), usage: openRule() },
  asset_ids: [],
});
export type Membership = {
  subscription_id: string;
  stripe_subscription_id: string;
  item_id: string;
  price_id: string;
  status: string;
  review: boolean;
  current: boolean;
  plan: string;
  units: number;
  athletics: number;
  interval: string;
  ends_at: string | null;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
};
export type ProductChild = {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  trial: boolean;
  former_trial: boolean;
  memberships: Membership[];
  camp_ids: string[];
  purchases: string[];
  reserved?: boolean;
};
export type ProductContext = {
  auth_id: string | null;
  role: "parent" | "staff" | "admin" | null;
  parent_id: string | null;
  complete: boolean;
  children: ProductChild[];
  grants: {
    product_id: string;
    purpose: "visibility" | "purchase" | "usage";
    player_id: string | null;
  }[];
};
export const visitorContext = (): ProductContext => ({
  auth_id: null,
  role: null,
  parent_id: null,
  complete: true,
  children: [],
  grants: [],
});
export function priceLabel(price: ProductPrice | null) {
  return price
    ? `${new Intl.NumberFormat("de-DE", { style: "currency", currency: price.currency }).format(price.amount / 100)}${price.interval === "month" ? " / Monat" : price.interval === "year" ? " / Jahr" : " einmalig"}`
    : "Preis noch nicht geprüft";
}

export function trainingContentLabel(
  product: Pick<Product, "kind"> & {
    training_content?: Product["training_content"];
  },
) {
  const t = product.training_content;
  if (!t) return "";
  const number = (n: number) =>
    new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(n);
  if (product.kind === "camp")
    return t.camp_hours == null
      ? ""
      : `${number(t.camp_hours)} Zeitstunden Training insgesamt`;
  if (product.kind !== "subscription") return "";
  const items = [
    t.football_hours == null ? "" : `${number(t.football_hours)} Std. Fußball`,
    t.athletics_hours == null
      ? ""
      : `${number(t.athletics_hours)} Std. Athletik`,
  ].filter(Boolean);
  return items.length ? `${items.join(" + ")} pro Monat` : "";
}
