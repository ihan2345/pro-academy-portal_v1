// Explicitly local-only: never accepts a remote URL or production credential file.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";

const root = resolve("output/eltern-kind-lokal");
const containers = JSON.parse(
  execFileSync(
    "docker",
    [
      "inspect",
      "supabase_db_pabyak-family-local",
      "supabase_kong_pabyak-family-local",
    ],
    { encoding: "utf8" },
  ),
);
for (const container of containers)
  for (const bindings of Object.values(
    container.HostConfig.PortBindings ?? {},
  )) {
    if (bindings.some((b) => b.HostIp !== "127.0.0.1"))
      throw Error(
        "Bind local services to loopback before importing personal data",
      );
  }
const source = resolve("output/eltern-kind-vorschau-20260912");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const review = read(`${source}/review.json`);
const snapshot = read(`${source}/snapshot.json`);
const decisions = read(`${source}/confirmed-decisions.json`);
if (review.source_sha256 !== decisions.source_sha256)
  throw Error("Source mismatch");
const status = JSON.parse(
  execFileSync(
    "npx",
    ["--yes", "supabase", "status", "--workdir", root, "-o", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ),
);
if (status.API_URL !== "http://127.0.0.1:55321")
  throw Error("Only isolated localhost API allowed");
const db = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const check = (result) => {
  if (result.error) throw Error(result.error.message);
  return result.data;
};
const uuid = (name) => {
  const h = createHash("sha256").update(`local-family:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const credentialsFile = `${root}/accounts.private.json`;
const state = existsSync(credentialsFile)
  ? read(credentialsFile)
  : {
      password: randomBytes(32).toString("base64url"),
      accounts: [],
      complete: false,
    };
mkdirSync(root, { recursive: true });
const save = () =>
  writeFileSync(credentialsFile, JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
save();
if (state.complete) {
  console.log("Local import already complete; preserving local edits.");
  process.exit(0);
}
const users = check(
  await db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
).users;
async function account(key, email, name, role, children = []) {
  let user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    user = check(
      await db.auth.admin.createUser({
        email,
        password: state.password,
        email_confirm: true,
      }),
    ).user;
    users.push(user);
  }
  check(
    await db.from("profiles").upsert({ id: user.id, full_name: name, role }),
  );
  const a = { key, email, name, role, user_id: user.id, children };
  state.accounts = state.accounts.filter((x) => x.key !== key);
  state.accounts.push(a);
  save();
  return a;
}
const admin = await account(
  "admin",
  "verwaltung@eltern-kind.local",
  "Lokale Verwaltung",
  "admin",
);
const familyAccounts = new Map();
for (const family of review.families) {
  const decision = decisions.family_decisions.find(
    (d) => d.family_id === family.id && d.same_person_confirmed,
  );
  const names = new Set(
    family.parent_names.map((n) => n.trim().toLowerCase().replace(/\s+/g, " ")),
  );
  if (names.size !== 1 && !decision)
    throw Error(`Unconfirmed family ${family.id}`);
  familyAccounts.set(
    family.id,
    await account(
      family.id,
      family.email,
      decision?.canonical_parent_name ?? family.parent_names[0],
      "parent",
      family.children,
    ),
  );
}
for (const row of review.rows) {
  const stripe = snapshot.stripe.find((s) => s.id === row.subscription_id);
  const item = stripe?.items.find((i) => i.id === row.item_id);
  const exception = decisions.subscription_decisions.find(
    (d) =>
      d.subscription_id === row.subscription_id && d.item_id === row.item_id,
  );
  if (
    !stripe ||
    stripe.status !== "active" ||
    stripe.customer !== row.customer_id ||
    item?.price_id !== row.price_id
  )
    throw Error(`Snapshot mismatch ${row.source_record}`);
  if (
    item.quantity !== 1 &&
    !(
      exception?.portal_package_quantity === 1 &&
      exception.source_stripe_quantity === item.quantity
    )
  )
    throw Error("Unconfirmed quantity");
  const input = {
    stripe_subscription_id: stripe.id,
    stripe_customer_id: stripe.customer,
    status: stripe.status,
    subscription_created_at: new Date(stripe.created * 1000).toISOString(),
    billing_cycle_anchor: new Date(
      stripe.billing_cycle_anchor * 1000,
    ).toISOString(),
    retrieved_at: snapshot.retrieved_at,
    local_source_quantity: item.quantity,
    local_package_quantity: 1,
    items: stripe.items.map((i) => ({
      id: i.id,
      price_id: i.price_id,
      starts_at: new Date(i.current_period_start * 1000).toISOString(),
      ends_at: new Date(i.current_period_end * 1000).toISOString(),
    })),
  };
  check(await db.rpc("apply_stripe", { input }));
  const playerId = uuid(`player:${row.source_record}`);
  check(
    await db
      .from("players")
      .upsert({
        id: playerId,
        first_name: row.first_name,
        last_name: row.last_name,
        birth_year: null,
        team: "",
      }),
  );
  const family = familyAccounts.get(row.family);
  const parentId = check(
    await db.rpc("link_stripe_family", {
      input: {
        customer_id: row.customer_id,
        subscription_id: row.subscription_id,
        item_id: row.item_id,
        player_id: playerId,
        parent_name: family.name,
        email: family.email,
        actor_id: admin.user_id,
      },
    }),
  );
  check(
    await db
      .from("parents")
      .update({ auth_user_id: family.user_id })
      .eq("id", parentId),
  );
  check(await db.rpc("apply_stripe", { input }));
  if (exception?.follow_up_required)
    check(
      await db
        .from("subscriptions")
        .update({ needs_review: true })
        .eq("stripe_subscription_id", stripe.id),
    );
}
// Real planning forms also need a local trainer and location, clearly labelled test infrastructure.
const trainer = await account(
  "trainer",
  "trainer@eltern-kind.local",
  "Lokaler Testtrainer",
  "staff",
);
check(
  await db
    .from("staff_profiles")
    .upsert({ id: trainer.user_id, display_name: trainer.name, active: true }),
);
check(
  await db
    .from("locations")
    .upsert({
      id: uuid("location"),
      name: "Lokaler Testplatz",
      address: "Nur lokale Testplanung",
      active: true,
    }),
);
const counts = {};
for (const table of [
  "parents",
  "players",
  "subscriptions",
  "subscription_players",
  "parent_stripe_customers",
  "notification_jobs",
  "parent_invitations",
]) {
  const result = await db
    .from(table)
    .select("id", { count: "exact", head: true });
  check(result);
  counts[table] = result.count;
}
if (
  counts.parents !== 84 ||
  counts.players !== 91 ||
  counts.subscriptions !== 91 ||
  counts.subscription_players !== 91 ||
  counts.parent_stripe_customers !== 91 ||
  counts.notification_jobs !== 84 ||
  counts.parent_invitations !== 0
)
  throw Error(`Import counts failed ${JSON.stringify(counts)}`);
const jobs = check(await db.from("notification_jobs").select("status,payload"));
if (jobs.some((j) => j.status !== "held" || j.payload.token || j.payload.url))
  throw Error("Invitations must be held without tokens");
const periods = check(await db.from("entitlement_periods").select("*"));
for (const row of review.rows) {
  const matches = periods.filter(
    (p) => p.player_id === uuid(`player:${row.source_record}`),
  );
  if (
    !matches.length ||
    matches.some(
      (p) =>
        p.included_units !==
        row.football_per_package + row.athletics_per_package,
    )
  )
    throw Error(`Allowance mismatch ${row.source_record}`);
}
state.complete = true;
state.snapshot_at = snapshot.retrieved_at;
state.counts = counts;
save();
writeFileSync(
  `${root}/verification.json`,
  JSON.stringify(
    {
      snapshot_at: snapshot.retrieved_at,
      counts,
      periods: periods.length,
      all_invitations_held: true,
      external_calls: 0,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    counts,
    periods: periods.length,
    all_invitations_held: true,
  }),
);
