/** Real Supabase Auth/REST/Storage contract flow. No messages sent; disposable test project only. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { processReports } from "../src/lib/server/reports";
import { processMail, captureProvider } from "../workers/jobs";
try {
  process.loadEnvFile(".env.local");
} catch {}
if (
  process.env.SUPABASE_ENVIRONMENT !== "test" ||
  process.env.EXTERNAL_TESTS_CONFIRM !== "DISPOSABLE_SUPABASE_TEST_PROJECT" ||
  process.env.APP_MODE !== "test"
)
  throw new Error(
    "Nur ein leeres, entbehrliches Supabase-Testprojekt verwenden. SUPABASE_ENVIRONMENT=test, EXTERNAL_TESTS_CONFIRM=DISPOSABLE_SUPABASE_TEST_PROJECT und APP_MODE=test erforderlich.",
  );
for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
])
  if (!process.env[name]) throw new Error(`${name} fehlt`);
process.env.MAIL_PROVIDER = "capture";
process.env.EMAIL_TEST_MODE = "true";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
  anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  }),
  tag = randomUUID().slice(0, 8);
function check<T extends { data: unknown; error: { message: string } | null }>(
  result: T,
): NonNullable<T["data"]> {
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T["data"]>;
}
async function authUser(label: string) {
  const email = `pa-${label}-${tag}@example.invalid`,
    created = check(
      await admin.auth.admin.createUser({ email, email_confirm: true }),
    );
  assert(created.user);
  const link = check(
    await admin.auth.admin.generateLink({ type: "magiclink", email }),
  );
  assert(link.properties);
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const verified = check(
    await client.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "magiclink",
    }),
  );
  assert(verified.user);
  return { id: created.user.id, email, client };
}
async function run() {
  const operator = await authUser("admin"),
    staff = await authUser("staff"),
    one = await authUser("parent-one"),
    two = await authUser("parent-two");
  check(
    await admin.from("profiles").insert([
      { id: operator.id, role: "admin", full_name: "External Test Admin" },
      { id: staff.id, role: "staff", full_name: "External Test Staff" },
    ]),
  );
  check(
    await admin
      .from("staff_profiles")
      .insert({ id: staff.id, display_name: "External Test Coach" }),
  );
  const parents = [randomUUID(), randomUUID()],
    players = [randomUUID(), randomUUID()],
    periods = [randomUUID(), randomUUID()],
    subscription = randomUUID(),
    location = randomUUID();
  check(
    await admin.from("parents").insert([
      {
        id: parents[0],
        full_name: "Test Parent One",
        contact_email: one.email,
        stripe_customer_id: `cus_fixture_${tag}_1`,
      },
      {
        id: parents[1],
        full_name: "Test Parent Two",
        contact_email: two.email,
        stripe_customer_id: `cus_fixture_${tag}_2`,
      },
    ]),
  );
  for (const [i, user] of [one, two].entries()) {
    const token = randomUUID(),
      hash = createHash("sha256").update(token).digest("hex");
    check(
      await admin.rpc("create_parent_invitation", {
        input: {
          parent_id: parents[i],
          actor_id: operator.id,
          token_hash: hash,
          url: `${process.env.APP_URL}/einladung?token=${token}`,
        },
      }),
    );
    check(
      await user.client.rpc("accept_invitation", { invitation_hash: hash }),
    );
    assert(
      (await user.client.rpc("accept_invitation", { invitation_hash: hash }))
        .error,
      "Token must be single use",
    );
  }
  check(
    await admin.from("players").insert(
      players.map((id, i) => ({
        id,
        first_name: `External Test ${i + 1}`,
        last_name: tag,
        birth_year: 2015,
        team: "TEST",
      })),
    ),
  );
  check(
    await admin
      .from("parent_players")
      .insert(
        players.map((id, i) => ({ parent_id: parents[i], player_id: id })),
      ),
  );
  check(
    await admin.from("locations").insert({
      id: location,
      name: "External Test Pitch",
      address: "Testdaten – kein echter Standort",
    }),
  );
  check(
    await admin.from("subscriptions").insert({
      id: subscription,
      stripe_customer_id: `cus_fixture_${tag}_1`,
      stripe_subscription_id: `sub_fixture_${tag}`,
      status: "active",
    }),
  );
  check(
    await admin.from("entitlement_periods").insert(
      periods.map((id, i) => ({
        id,
        player_id: players[i],
        subscription_id: subscription,
        stripe_customer_id: `cus_fixture_${tag}_${i + 1}`,
        stripe_item_id: `si_fixture_${tag}_${i}`,
        stripe_price_id: `price_fixture_${tag}`,
        product_name: "GameChanger",
        included_units: 8,
        starts_at: "2025-07-11T22:00:00Z",
        ends_at: "2025-08-11T22:00:00Z",
        status: "active",
      })),
    ),
  );
  assert.equal(
    check(await one.client.from("players").select("id").eq("id", players[1]))
      .length,
    0,
    "Foreign child leaked",
  );
  const event = check(
    await staff.client.rpc("save_training", {
      input: {
        title: `External Test ${tag}`,
        starts_at: "2025-07-15T14:30:00Z",
        ends_at: "2025-07-15T16:00:00Z",
        location_id: location,
        trainer_id: staff.id,
        event_type: "Gruppentraining",
        player_ids: players,
        notify_parents: true,
        note: "Nur Staff darf diese Notiz lesen",
      },
    }),
  );
  const own = check(
    await one.client
      .from("event_participants")
      .select("*")
      .eq("event_id", event),
  );
  assert.equal(own.length, 1);
  assert.equal(
    check(
      await one.client.from("event_private_notes").select("*").eq("id", event),
    ).length,
    0,
  );
  assert(
    (
      await one.client.rpc("cancel_training", {
        event,
        cancellation_reason: "Unberechtigter Versuch",
      })
    ).error,
    "Parent was able to cancel",
  );
  assert(
    (
      await staff.client.rpc("change_role", {
        target: one.id,
        new_role: "admin",
      })
    ).error,
    "Staff changed role",
  );
  check(
    await staff.client.rpc("set_attendance", {
      participant: own[0].id,
      new_status: "excused",
      correction_reason: "Externer Test: entschuldigt",
      send_correction: false,
    }),
  );
  check(await admin.rpc("auto_attendance"));
  check(await admin.rpc("auto_attendance"));
  const all = check(
    await admin.from("event_participants").select("*").eq("event_id", event),
  );
  assert.equal(all.filter((p) => p.status === "attended_auto").length, 1);
  assert.equal(all.filter((p) => p.status === "excused").length, 1);
  await processReports();
  await processMail(captureProvider);
  assert(captureProvider.sent.length > 0, "No capture messages generated");
  const snapshots = check(
    await one.client
      .from("report_snapshots")
      .select("*")
      .eq("period_id", periods[0]),
  );
  assert.equal(snapshots.length, 1);
  const files = check(
    await one.client
      .from("report_files")
      .select("*")
      .eq("snapshot_id", snapshots[0].id),
  );
  assert.equal(files.length, 1);
  assert(
    (await two.client.storage.from("reports").download(files[0].storage_path))
      .error,
    "Foreign PDF leaked",
  );
  const pdf = check(
    await one.client.storage.from("reports").download(files[0].storage_path),
  );
  assert.equal(
    Buffer.from(await pdf.arrayBuffer())
      .subarray(0, 4)
      .toString(),
    "%PDF",
  );
  check(
    await staff.client.rpc("set_attendance", {
      participant: all.find((p) => p.status === "attended_auto")!.id,
      new_status: "absent",
      correction_reason: "Externer Test: nachträgliche Korrektur",
      send_correction: true,
    }),
  );
  await processMail(captureProvider);
  console.log(
    JSON.stringify(
      {
        ok: true,
        test_tag: tag,
        checks: [
          "Actual Supabase Magic-Link token verification without SMTP",
          "Single-use invitation",
          "Two-parent RLS isolation",
          "Staff planning and exception",
          "Automatic attendance idempotency",
          "Private PDF generation and foreign download denial",
          "Capture mail and later correction",
        ],
        note: "Synthetic historical Stripe references; real Stripe billing and SMTP require separate acceptance. Test fixtures deliberately retained for audit inspection.",
      },
      null,
      2,
    ),
  );
}
run().catch((e) => {
  console.error("External contract test failed:", e.message);
  process.exitCode = 1;
});
