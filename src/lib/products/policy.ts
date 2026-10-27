import type {
  Audience,
  Channel,
  Product,
  ProductContext,
  ProductChild,
  Rule,
} from "./domain";
export function childAudiences(child?: ProductChild): Set<Audience> {
  const groups = new Set<Audience>(["all"]);
  if (!child) return groups;
  if (child.trial) groups.add("trial");
  if (child.former_trial) groups.add("former_trial");
  const current = child.memberships.filter((m) => m.current);
  if (current.length) groups.add("subscriber");
  for (const m of current) {
    const key = m.plan.toLowerCase().replace(/[^a-z]/g, "");
    if (["firsttouch", "gamechanger", "proplayer", "nextlevel"].includes(key))
      groups.add(key as Audience);
  }
  if (
    !current.length &&
    child.memberships.some((m) =>
      ["canceled", "unpaid", "incomplete_expired"].includes(m.status),
    )
  )
    groups.add("former");
  if (child.camp_ids.length) groups.add("camp");
  if (
    !child.trial &&
    !child.former_trial &&
    !child.memberships.length &&
    !child.camp_ids.length &&
    !child.purchases.length
  )
    groups.add("new");
  return groups;
}
function groups(
  ctx: ProductContext,
  child: ProductChild | undefined,
  id: string,
  purpose: "visibility" | "purchase" | "usage",
  family: boolean,
) {
  const g = childAudiences(child);
  if (family) {
    g.delete("new");
    for (const c of ctx.children)
      for (const a of childAudiences(c)) if (a !== "new") g.add(a);
    if (
      ctx.children.length &&
      ctx.children.every((c) => childAudiences(c).has("new"))
    )
      g.add("new");
  }
  if (!ctx.auth_id) g.add("visitor");
  if (ctx.role === "admin" || ctx.role === "staff") g.add("internal");
  if (ctx.role === "parent" && !ctx.children.length) g.add("new");
  if (
    ctx.grants.some(
      (x) =>
        x.product_id === id &&
        x.purpose === purpose &&
        (!x.player_id || x.player_id === child?.id),
    )
  )
    g.add("individual");
  return g;
}
export function matchesRule(
  rule: Rule,
  ctx: ProductContext,
  child: ProductChild | undefined,
  productId: string,
  purpose: "visibility" | "purchase" | "usage",
) {
  // Every player clause in an AND expression evaluates against the SAME child.
  if (
    rule.clauses.some((c) =>
      c.exclude.some((a) =>
        groups(ctx, child, productId, purpose, c.scope === "family").has(a),
      ),
    )
  )
    return false;
  const clauses = rule.clauses.map((c) => {
    const set = groups(ctx, child, productId, purpose, c.scope === "family");
    if (c.exclude.some((a) => set.has(a))) return false;
    return c.mode === "all"
      ? c.include.every((a) => set.has(a))
      : c.include.some((a) => set.has(a));
  });
  return rule.mode === "all" ? clauses.every(Boolean) : clauses.some(Boolean);
}
export type PurchaseMode =
  | "register"
  | "join"
  | "change"
  | "reactivate"
  | "camp"
  | "purchase"
  | "owned"
  | "unavailable"
  | "select_child";
export type Decision = {
  visible: boolean;
  purchasable: boolean;
  usable: boolean;
  mode: PurchaseMode;
  label: string;
  reasons: string[];
  audiences: Audience[];
  player_id: string | null;
};
export function decideProduct(
  product: Product,
  id: string,
  ctx: ProductContext,
  channel: Channel,
  playerId?: string,
  now = Date.now(),
): Decision {
  const child = ctx.children.find((c) => c.id === playerId);
  const reason: string[] = [];
  const active =
    ["active", "internal", "exclusive", "sold_out"].includes(product.status) &&
    (!product.publish_at || Date.parse(product.publish_at) <= now) &&
    (!product.expires_at || Date.parse(product.expires_at) > now);
  const exclusive =
    product.status !== "exclusive" ||
    product.rules.visibility.clauses.every(
      (c) => !c.include.includes("all") && !c.include.includes("visitor"),
    );
  const channelAllowed =
    exclusive &&
    (channel !== "admin" || ctx.role === "admin" || ctx.role === "staff") &&
    product.channels.includes(channel) &&
    (product.status !== "internal" ||
      ctx.role === "admin" ||
      ctx.role === "staff");
  const candidates = child
    ? [child]
    : ctx.children.length
      ? ctx.children
      : [undefined];
  const visible =
    ctx.complete &&
    active &&
    channelAllowed &&
    candidates.some((c) =>
      matchesRule(product.rules.visibility, ctx, c, id, "visibility"),
    );
  const owned =
    !!child &&
    (product.kind === "subscription"
      ? child.memberships.some(
          (m) => m.current && m.price_id === product.price?.id,
        )
      : child.purchases.includes(id));
  // Existing purchased rights survive catalogue archival. Usage rules are additional
  // restrictions only for generic products; Abo/Camp authority stays in their models.
  const usable =
    ctx.complete &&
    owned &&
    (product.kind !== "other" ||
      matchesRule(product.rules.usage, ctx, child, id, "usage"));
  const result = (
    mode: PurchaseMode,
    label: string,
    purchasable = false,
  ): Decision => ({
    visible,
    purchasable,
    usable,
    mode,
    label,
    reasons: reason,
    audiences: [...groups(ctx, child, id, "purchase", false)],
    player_id: child?.id ?? null,
  });
  if (!ctx.complete) {
    reason.push("Kundenstatus konnte nicht vollständig geprüft werden.");
    return result("unavailable", "Nicht verfügbar");
  }
  if (!active || !channelAllowed) {
    reason.push(
      "Dieses Angebot ist hier nicht freigegeben oder nicht mehr aktiv.",
    );
    return result("unavailable", "Nicht verfügbar");
  }
  if (product.status === "sold_out") {
    reason.push("Dieses Angebot ist ausverkauft.");
    return result("unavailable", "Ausverkauft");
  }
  if (playerId && !child) {
    reason.push("Das Kind gehört nicht zu deinem Konto.");
    return result("unavailable", "Nicht verfügbar");
  }
  if (!visible) {
    reason.push("Dieses Angebot ist für diesen Kontext nicht sichtbar.");
    return result("unavailable", "Nicht verfügbar");
  }
  if (!ctx.auth_id) {
    if (!product.price) return result("unavailable", "Preis nicht verfügbar");
    // Public guest orders are evaluated as new children, never as members or grantees.
    const guestChild = child ?? {
      id: "guest",
      first_name: "",
      last_name: "",
      name: "",
      birth_date: null,
      trial: false,
      former_trial: false,
      memberships: [],
      camp_ids: [],
      purchases: [],
      reserved: true,
    };
    if (!matchesRule(product.rules.purchase, ctx, guestChild, id, "purchase")) {
      reason.push(
        "Für dieses Angebot bitte mit deinem berechtigten Elternkonto anmelden.",
      );
      return result("unavailable", "Anmeldung erforderlich");
    }
    return result(
      "register",
      product.kind === "camp" ? "Camp buchen" : "Jetzt kaufen",
      true,
    );
  }
  if (ctx.role !== "parent") {
    reason.push("Käufe benötigen ein zugeordnetes Elternkonto.");
    return result("unavailable", "Nicht verfügbar");
  }
  if (!child) {
    reason.push("Wähle das Kind, für das du das Angebot nutzen möchtest.");
    return result("select_child", "Kind auswählen");
  }
  if (!matchesRule(product.rules.purchase, ctx, child, id, "purchase")) {
    reason.push("Für dieses Kind besteht keine Kaufberechtigung.");
    return result("unavailable", "Nicht verfügbar");
  }
  if (owned && !product.repeatable) return result("owned", "Bereits gebucht");
  if (!product.price) {
    reason.push("Der Stripe-Preis ist noch nicht geprüft.");
    return result("unavailable", "Nicht verfügbar");
  }
  if (product.kind === "camp") return result("camp", "Camp buchen", true);
  if (product.kind === "other") return result("purchase", "Jetzt kaufen", true);
  const pending = child.memberships.some(
    (m) =>
      m.review ||
      ["incomplete", "past_due", "unpaid", "paused"].includes(m.status),
  );
  if (pending) {
    reason.push(
      "Eine bestehende Mitgliedschaft oder Zahlung muss zuerst geklärt werden.",
    );
    return result("unavailable", "Nicht verfügbar");
  }
  if (
    child.memberships.some(
      (m) => m.current && (m.cancel_at_period_end || m.cancel_at),
    )
  ) {
    reason.push(
      "Für dieses Abo ist eine Kündigung vorgemerkt. Bitte zuerst in Stripe prüfen oder die Verwaltung kontaktieren.",
    );
    return result("unavailable", "Kündigung vorgemerkt");
  }
  if (child.memberships.some((m) => m.current))
    return result("change", "Tarif wechseln", true);
  if (
    child.memberships.some((m) => ["active", "trialing"].includes(m.status))
  ) {
    reason.push("Die bestehende Abo-Zuordnung muss zuerst geprüft werden.");
    return result("unavailable", "Nicht verfügbar");
  }
  if (child.trial) return result("join", "Mitglied werden", true);
  if (childAudiences(child).has("former"))
    return result("reactivate", "Mitgliedschaft reaktivieren", true);
  return result("purchase", "Jetzt anmelden & kaufen", true);
}
