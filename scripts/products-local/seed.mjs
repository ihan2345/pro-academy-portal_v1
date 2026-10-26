// Synthetic fixtures only, no external connections and no real Stripe IDs.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
const root = resolve("output/product-management-local");
const env = Object.fromEntries(
  readFileSync(`${root}/app/.env.local`, "utf8")
    .trim()
    .split("\n")
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
if (
  env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:57321" ||
  env.APP_MODE !== "test"
)
  throw Error("Independent localhost test database required");
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const accounts = JSON.parse(
  readFileSync(`${root}/accounts.private.json`, "utf8"),
);
const get = (k) => accounts.find((a) => a.key === k);
const ok = (r) => {
  if (r.error) throw r.error;
  return r.data;
};
const marker = ok(
  await db
    .from("system_settings")
    .select("id")
    .eq("key", "product_local_seed_v1"),
);
if (marker.length) {
  console.log("Synthetic product fixtures already exist; preserved.");
  process.exit(0);
}
const plans = ok(await db.from("plans").select("*"));
for (const p of plans)
  ok(
    await db
      .from("plans")
      .update({ stripe_price_id: `price_local_${p.id.replaceAll("-", "")}` })
      .eq("id", p.id),
  );
for (const p of plans)
  p.stripe_price_id = `price_local_${p.id.replaceAll("-", "")}`;
const current = plans.filter(
  (p) => p.active && !p.is_camp && p.generation !== "legacy",
);
ok(
  await db
    .from("platform_features")
    .update({ enabled: true })
    .in("key", ["trial_training", "product_shop"]),
);
const makeChild = async (key, first) => {
  const a = get(key);
  const kid = ok(
    await db
      .from("players")
      .insert({
        first_name: first,
        last_name: a.name.replace("Familie ", ""),
        birth_year: 2016,
        camp_birth_date: "2016-04-15",
        camp_gender: "keine Angabe",
        camp_clothing_size: "M",
      })
      .select("*")
      .single(),
  );
  ok(
    await db
      .from("parent_players")
      .insert({ parent_id: a.parent_id, player_id: kid.id }),
  );
  return kid;
};
async function membership(key, kid, plan, ended = false) {
  const a = get(key),
    sub = `sub_local_${key}_${kid.id.slice(0, 8)}`,
    item = `si_local_${kid.id.slice(0, 8)}`,
    customer = `cus_local_${key}`;
  ok(
    await db
      .from("parent_stripe_customers")
      .upsert(
        { parent_id: a.parent_id, stripe_customer_id: customer },
        { onConflict: "parent_id,stripe_customer_id" },
      ),
  );
  const input = {
    stripe_subscription_id: sub,
    stripe_customer_id: customer,
    status: ended ? "canceled" : "active",
    subscription_created_at: "2026-09-20T12:00:00Z",
    billing_cycle_anchor: new Date(Date.now() - 7 * 86400000).toISOString(),
    retrieved_at: new Date().toISOString(),
    items: [
      {
        id: item,
        price_id: plan.stripe_price_id,
        quantity: 1,
        starts_at: new Date(
          Date.now() - (ended ? 60 : 7) * 86400000,
        ).toISOString(),
        ends_at: new Date(
          Date.now() + (ended ? -30 : 23) * 86400000,
        ).toISOString(),
      },
    ],
  };
  const sid = ok(await db.rpc("apply_stripe_package_sync", { input }));
  ok(
    await db
      .from("subscriptions")
      .update({ parent_id: a.parent_id })
      .eq("id", sid),
  );
  ok(
    await db.from("subscription_players").insert({
      subscription_id: sid,
      stripe_item_id: item,
      player_id: kid.id,
    }),
  );
  ok(
    await db.rpc("apply_stripe_package_sync", {
      input: { ...input, retrieved_at: new Date().toISOString() },
    }),
  );
  ok(
    await db
      .from("subscriptions")
      .update({ needs_review: false })
      .eq("id", sid),
  );
}
const first = current.find((p) => p.name === "FirstTouch"),
  game = current.find((p) => p.name === "GameChanger");
await membership("subscriber", await makeChild("subscriber", "Alex"), first);
await membership("mixed", await makeChild("mixed", "Mika"), game);
await membership("former", await makeChild("former", "Noah"), game, true);
await makeChild("foreign", "Robin");
const campKid = await makeChild("camp", "Sam");
for (const [key, firstName] of [
  ["trial", "Lea"],
  ["mixed", "Luca"],
]) {
  const a = get(key),
    family = randomUUID();
  ok(
    await db.from("trial_families").insert({
      id: family,
      parent_id: a.parent_id,
      auth_user_id: a.user_id,
      request_input: { local_fixture: true },
      parent_name: a.name,
      email: a.email,
      phone: "+4900000000",
      operational_consent: true,
      privacy_acknowledged: true,
      marketing_consent: false,
      email_verified_at: new Date().toISOString(),
    }),
  );
  const kid = ok(
    await db
      .from("trial_players")
      .insert({
        family_id: family,
        first_name: firstName,
        last_name: a.name.replace("Familie ", ""),
        birth_date: "2016-04-15",
        original_data: { local_fixture: true },
      })
      .select("*")
      .single(),
  );
  ok(
    await db.from("trial_requests").insert({
      family_id: family,
      player_id: kid.id,
      first_name: kid.first_name,
      last_name: kid.last_name,
      birth_date: kid.birth_date,
    }),
  );
}
const camp = ok(
  await db
    .from("camps")
    .insert({
      title: "Herbst-Fußballcamp · Test",
      location: "Lokaler Testplatz",
      capacity: 20,
      min_age: 6,
      max_age: 14,
      status: "open",
      payment_mode: "test",
      days: [
        {
          starts_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          ends_at: new Date(
            Date.now() + 30 * 86400000 + 5 * 3600000,
          ).toISOString(),
        },
      ],
    })
    .select("*")
    .single(),
);
const campPlan = ok(
  await db
    .from("plans")
    .insert({
      name: "Lokales Campangebot",
      stripe_price_id: "price_local_camp",
      included_units: 0,
      athletics_units: 0,
      generation: "special",
      billing_interval: "month",
      active: false,
      is_public: false,
      is_camp: true,
      camp_id: camp.id,
    })
    .select("*")
    .single(),
);
const offer = ok(
  await db
    .from("camp_offers")
    .insert({
      camp_id: camp.id,
      plan_id: campPlan.id,
      kind: "main",
      stripe_price_id: "price_local_camp",
      stripe_product_id: "prod_local_camp",
      stripe_payment_link_id: "plink_local_fixture",
      payment_url: "https://buy.stripe.com/local_fixture_not_a_real_link",
      amount: 22900,
      currency: "eur",
      codes: {},
    })
    .select("*")
    .single(),
);
const open = () => ({
  mode: "all",
  clauses: [{ scope: "player", mode: "any", include: ["all"], exclude: [] }],
});
const catalog = [];
for (const plan of current) {
  const price = {
    id: plan.stripe_price_id,
    product_id: `prod_local_${plan.id.replaceAll("-", "")}`,
    amount:
      plan.included_units === 4
        ? 9900
        : plan.included_units === 8
          ? 15900
          : 19900,
    currency: "eur",
    interval: plan.billing_interval,
    interval_count: 1,
    livemode: false,
    checked_at: new Date().toISOString(),
    product_name: "Lokales Preisbeispiel – kein Stripe-Abruf",
    source: "fixture",
  };
  catalog.push({
    name:
      plan.name === "Pro-Player"
        ? "ProPlayer"
        : plan.name === "NEXT LEVEL"
          ? "NextLevel"
          : plan.name,
    kind: "subscription",
    category: "Academy Training",
    plan_id: plan.id,
    price,
    short_description:
      plan.included_units === 4
        ? "Dein Einstieg. Vier Einheiten voller Freude am Fußball."
        : plan.included_units === 8
          ? "Mehr Ballkontakte. Mehr Selbstvertrauen. Acht Einheiten im Monat."
          : "Dein nächstes Level. Intensive Entwicklung mit persönlichem Fokus.",
    featured: plan.name === "GameChanger",
  });
}
catalog.push({
  name: "Herbstcamp",
  kind: "camp",
  category: "Feriencamps",
  camp_offer_id: offer.id,
  short_description: "Fußball, neue Freunde und unvergessliche Ferientage.",
  price: {
    id: "price_local_camp",
    product_id: "prod_local_camp",
    amount: 22900,
    currency: "eur",
    interval: null,
    interval_count: 1,
    livemode: false,
    checked_at: new Date().toISOString(),
    product_name: "Lokales Preisbeispiel – kein Stripe-Abruf",
    source: "fixture",
  },
});
catalog.push({
  name: "Persönliche Spielanalyse",
  kind: "other",
  category: "Individuelle Entwicklung",
  short_description:
    "Ein frischer Blick auf dein Spiel und konkrete nächste Schritte.",
  price: {
    id: "price_local_analysis",
    product_id: "prod_local_analysis",
    amount: 4900,
    currency: "eur",
    interval: null,
    interval_count: 1,
    livemode: false,
    checked_at: new Date().toISOString(),
    product_name: "Lokales Preisbeispiel – kein Stripe-Abruf",
    source: "fixture",
  },
});
for (const [index, v] of catalog.entries()) {
  const data = {
    internal_name: `Lokales Testbeispiel ${index + 1}`,
    description:
      "Ausschließlich erfundenes lokales Testangebot. Preise sind Beispieldaten und wurden nicht von Stripe abgerufen. Kein echter Zahlungsabschluss.",
    status: "active",
    sort_order: index,
    publish_at: null,
    expires_at: null,
    channels: ["catalog", "parents", "trials", "homepage"],
    plan_id: null,
    camp_offer_id: null,
    repeatable: false,
    featured: false,
    asset_ids: [],
    rules: { visibility: open(), purchase: open(), usage: open() },
    ...v,
  };
  const p = ok(
    await db
      .from("catalog_products")
      .insert({
        name: data.name,
        internal_name: data.internal_name,
        kind: data.kind,
        status: "active",
        category: data.category,
        sort_order: index,
        draft: data,
        published: data,
        published_revision: 1,
      })
      .select("*")
      .single(),
  );
  ok(
    await db.from("catalog_product_versions").insert({
      product_id: p.id,
      revision: 1,
      payload: data,
      actor_id: get("admin").user_id,
    }),
  );
}
ok(
  await db
    .from("system_settings")
    .insert({ key: "product_local_seed_v1", value: true }),
);
console.log(
  `Created ${catalog.length} clearly labelled synthetic catalogue examples and independent test families. No Stripe calls.`,
);
