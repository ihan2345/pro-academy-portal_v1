import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
const apply = process.argv.includes("--apply-internal");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^(["'])(.*)\1$/, "$2")];
    }),
);
if (env.NEXT_PUBLIC_SUPABASE_URL !== "https://vgxaatawsbzgsmqiaepj.supabase.co")
  throw Error("Wrong target project");
const out = "output/eltern-kind-online";
mkdirSync(out, { recursive: true });
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const review = read("output/eltern-kind-vorschau-20260912/review.json");
const decisions = read(
  "output/eltern-kind-vorschau-20260912/confirmed-decisions.json",
);
if (review.source_sha256 !== decisions.source_sha256)
  throw Error("Source mismatch");
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const check = (r) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });
const key = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
const uuid = (s) => {
  const h = createHash("sha256")
    .update(`numbers-import:${review.source_sha256}:${s}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const tables = [
  "parents",
  "players",
  "parent_players",
  "subscriptions",
  "subscription_players",
  "entitlement_periods",
  "notification_jobs",
  "parent_invitations",
  "plans",
  "profiles",
];
const before = {};
for (const table of tables)
  before[table] = check(await db.from(table).select("*"));
if (before.notification_jobs.some((j) => j.status === "processing"))
  throw Error("A mail job is processing; import stopped");
const admin = before.profiles.find((p) => p.role === "admin");
if (!admin) throw Error("Admin profile required");
const manifestFile = `${out}/import-manifest.private.json`;
const manifest = existsSync(manifestFile)
  ? read(manifestFile)
  : {
      source_sha256: review.source_sha256,
      rows: [],
      baseline_counts: Object.fromEntries(
        tables.map((t) => [t, before[t].length]),
      ),
    };
if (manifest.source_sha256 !== review.source_sha256)
  throw Error("Manifest source mismatch");
if (!existsSync(`${out}/before.private.json`))
  writeFileSync(`${out}/before.private.json`, JSON.stringify(before), {
    mode: 0o600,
  });
const fresh = new Map();
for await (const sub of stripe.subscriptions.list({
  status: "active",
  limit: 100,
}))
  fresh.set(sub.id, sub);
const retrievedAt = new Date().toISOString();
const payload = [];
for (const row of review.rows) {
  const family = review.families.find((f) => f.id === row.family);
  const decision = decisions.family_decisions.find(
    (d) => d.family_id === row.family && d.same_person_confirmed,
  );
  if (new Set(family.parent_names.map(key)).size !== 1 && !decision)
    throw Error(`Unconfirmed family ${row.family}`);
  const parentName = decision?.canonical_parent_name ?? family.parent_names[0];
  const sub = fresh.get(row.subscription_id),
    item = sub?.items.data.find((i) => i.id === row.item_id);
  const exception = decisions.subscription_decisions.find(
    (d) =>
      d.subscription_id === row.subscription_id && d.item_id === row.item_id,
  );
  if (
    !sub ||
    sub.customer !== row.customer_id ||
    item?.price.id !== row.price_id
  )
    throw Error(`Stripe mismatch in source row ${row.source_record}`);
  if (
    item.quantity !== 1 &&
    !(
      exception?.portal_package_quantity === 1 &&
      exception.source_stripe_quantity === item.quantity
    )
  )
    throw Error("Unconfirmed quantity");
  const plan = before.plans.find(
    (p) => p.stripe_price_id === item.price.id && p.active,
  );
  if (
    !plan ||
    plan.included_units !== row.football_per_package + row.athletics_per_package
  )
    throw Error("Plan mapping mismatch");
  const playerId = uuid(`player:${row.source_record}`);
  const known = manifest.rows.find(
    (r) => r.source_record === row.source_record,
  );
  const matchingParents = before.parents.filter(
    (p) =>
      key(p.contact_email) === key(row.email) ||
      p.stripe_customer_id === row.customer_id,
  );
  if (
    matchingParents.some(
      (p) =>
        p.auth_user_id ||
        key(p.full_name) !== key(parentName) ||
        !manifest.rows.some((r) => r.parent_id === p.id),
    )
  )
    throw Error(`Existing parent requires manual review: ${row.family}`);
  const matchingPlayers = before.players.filter(
    (p) =>
      key(p.first_name) === key(row.first_name) &&
      key(p.last_name) === key(row.last_name),
  );
  if (matchingPlayers.some((p) => p.id !== playerId))
    throw Error(`Existing child requires manual review: ${row.source_record}`);
  const storedSub = before.subscriptions.find(
    (s) => s.stripe_subscription_id === row.subscription_id,
  );
  if (
    storedSub &&
    storedSub.parent_id &&
    !manifest.rows.some((r) => r.parent_id === storedSub.parent_id)
  )
    throw Error("Subscription already assigned");
  const input = {
    stripe_subscription_id: sub.id,
    stripe_customer_id: row.customer_id,
    status: sub.status,
    subscription_created_at: new Date(sub.created * 1000).toISOString(),
    billing_cycle_anchor: new Date(
      sub.billing_cycle_anchor * 1000,
    ).toISOString(),
    retrieved_at: retrievedAt,
    import_source_sha256: review.source_sha256,
    source_stripe_quantity: item.quantity,
    portal_package_quantity: 1,
    items: sub.items.data.map((i) => ({
      id: i.id,
      price_id: i.price.id,
      starts_at: new Date(i.current_period_start * 1000).toISOString(),
      ends_at: new Date(i.current_period_end * 1000).toISOString(),
    })),
  };
  payload.push({ row, parentName, playerId, input, exception });
}
writeFileSync(
  `${out}/preflight.private.json`,
  JSON.stringify(
    {
      checked_at: retrievedAt,
      families: review.families.length,
      rows: payload.length,
      payload,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    checked_at: retrievedAt,
    active_stripe_matches: payload.length,
    families: review.families.length,
    mode: apply ? "internal-import" : "read-only-preflight",
  }),
);
if (!apply) process.exit(0);
// Publication approval covers internal data only: no auth users, usable links or delivery.
const cloudflareToken = readFileSync(
  "/Users/karayla/Library/Preferences/.wrangler/config/default.toml",
  "utf8",
).match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!cloudflareToken) throw Error("Cannot verify paused background jobs");
const settingsResponse = await fetch(
  "https://api.cloudflare.com/client/v4/accounts/7300475f02c8b8793bb7e6250d0d4690/workers/scripts/proacademy-jobs/settings",
  { headers: { Authorization: `Bearer ${cloudflareToken}` } },
);
const settings = await settingsResponse.json();
const flags = Object.fromEntries(
  (settings.result?.bindings ?? []).map((b) => [b.name, b.text]),
);
if (
  !settings.success ||
  flags.JOBS_ENABLED !== "false" ||
  flags.STRIPE_SYNC_ONLY === "true" ||
  flags.ACCEPTANCE_TEST_ENABLED !== "false"
)
  throw Error("Background jobs must remain paused during internal import");
check(await db.from("parent_stripe_customers").select("id").limit(1));
const holdSchema = await db
  .from("parents")
  .select("notifications_held")
  .limit(1);
check(holdSchema);
for (const { row, parentName, playerId, input, exception } of payload) {
  check(await db.rpc("apply_stripe", { input }));
  if (!before.players.some((p) => p.id === playerId))
    check(
      await db.from("players").upsert(
        {
          id: playerId,
          first_name: row.first_name,
          last_name: row.last_name,
          birth_year: null,
          team: "",
        },
        { onConflict: "id", ignoreDuplicates: true },
      ),
    );
  const parentId = check(
    await db.rpc("link_stripe_family", {
      input: {
        customer_id: row.customer_id,
        subscription_id: row.subscription_id,
        item_id: row.item_id,
        player_id: playerId,
        parent_name: parentName,
        email: row.email,
        actor_id: admin.id,
      },
    }),
  );
  const p = check(
    await db
      .from("parents")
      .select("auth_user_id,notifications_held")
      .eq("id", parentId)
      .single(),
  );
  if (p.auth_user_id !== null || !p.notifications_held)
    throw Error("Internal-only invariant violated");
  manifest.rows = manifest.rows.filter(
    (r) => r.source_record !== row.source_record,
  );
  manifest.rows.push({
    source_record: row.source_record,
    parent_id: parentId,
    player_id: playerId,
    subscription_id: row.subscription_id,
  });
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), {
    mode: 0o600,
  });
  check(await db.rpc("apply_stripe", { input }));
  if (exception?.follow_up_required)
    check(
      await db
        .from("subscriptions")
        .update({ needs_review: true })
        .eq("stripe_subscription_id", row.subscription_id),
    );
}
const parentIds = [...new Set(manifest.rows.map((r) => r.parent_id))];
const parents = check(
  await db
    .from("parents")
    .select("id,auth_user_id,notifications_held")
    .in("id", parentIds),
);
const invitations = check(
  await db.from("parent_invitations").select("id").in("parent_id", parentIds),
);
const jobs = check(
  await db
    .from("notification_jobs")
    .select("status,payload,idempotency_key")
    .in(
      "idempotency_key",
      parentIds.map((id) => `held-invitation:${id}`),
    ),
);
const playerIds = manifest.rows.map((r) => r.player_id);
const periods = check(
  await db
    .from("entitlement_periods")
    .select("player_id,included_units,athletics_units,stripe_price_id")
    .in("player_id", playerIds),
);
const customerLinks = check(
  await db
    .from("parent_stripe_customers")
    .select("parent_id,stripe_customer_id")
    .in("parent_id", parentIds),
);
const familyLinks = check(
  await db
    .from("parent_players")
    .select("parent_id,player_id")
    .in("parent_id", parentIds),
);
if (customerLinks.length !== 91 || familyLinks.length !== 91)
  throw Error("Family mappings incomplete");
for (const { row, playerId } of payload) {
  const current = periods.filter((p) => p.player_id === playerId);
  if (
    !current.length ||
    current.some(
      (p) =>
        p.stripe_price_id !== row.price_id ||
        p.included_units !==
          row.football_per_package + row.athletics_per_package,
    )
  )
    throw Error(`Allowance verification failed: ${row.source_record}`);
}
if (
  parents.length !== 84 ||
  manifest.rows.length !== 91 ||
  parents.some((p) => p.auth_user_id || !p.notifications_held) ||
  invitations.length ||
  jobs.length !== 84 ||
  jobs.some((j) => j.status !== "held" || j.payload.url || j.payload.token)
)
  throw Error("Final import validation failed");
manifest.complete = true;
manifest.completed_at = new Date().toISOString();
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(
  JSON.stringify({
    families: parents.length,
    children: manifest.rows.length,
    parent_auth_links: 0,
    invitation_links: 0,
    held_jobs: jobs.length,
    emails_sent: 0,
  }),
);
