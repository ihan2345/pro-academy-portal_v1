// Lokale Testdaten für die Elternkabine: ~120 erfundene Familien, Zweitkonten,
// Regionen, Beiträge, offene Fragen und Meldungen. NUR gegen lokales Supabase.
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... node scripts/elternkabine-local/seed.mjs
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY setzen.");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url))
  throw new Error("Abbruch: Dieses Skript läuft nur gegen ein lokales Supabase.");
const db = createClient(url, key, { auth: { persistSession: false } });
const out = "output/elternkabine-lokal";
mkdirSync(out, { recursive: true });
const accountsFile = `${out}/accounts.private.json`;
const accounts = existsSync(accountsFile)
  ? JSON.parse(readFileSync(accountsFile, "utf8"))
  : {};
const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const FIRST = ["Sarah", "Murat", "Lena", "Ayşe", "Jonas", "Elif", "Tobias", "Fatma", "Julia", "Emre", "Nina", "Kerem", "Anna", "Mehmet", "Laura", "Deniz", "Sophie", "Can", "Marie", "Yusuf", "Lea", "Hakan", "Clara", "Selin"];
const LAST = ["Keller", "Yılmaz", "Schmidt", "Demir", "Weber", "Kaya", "Fischer", "Arslan", "Wagner", "Öztürk", "Becker", "Çelik", "Hoffmann", "Aydın", "Schulz", "Koch"];
const KIDS = ["Noah", "Mia", "Ali", "Emma", "Elias", "Lina", "Ben", "Zeynep", "Paul", "Leon", "Mila", "Omar", "Finn", "Ela", "Luca"];

async function user(email, fullName, role = "parent") {
  let entry = accounts[email];
  if (!entry) {
    entry = { password: randomBytes(12).toString("base64url"), name: fullName, role };
    const created = await db.auth.admin.createUser({ email, password: entry.password, email_confirm: true });
    if (created.error && !/already/i.test(created.error.message)) throw created.error;
    entry.id = created.data?.user?.id;
    if (!entry.id) {
      const list = must(await db.auth.admin.listUsers({ perPage: 1000 }), "listUsers");
      entry.id = list.users.find((u) => u.email === email)?.id;
    }
    accounts[email] = entry;
  }
  must(await db.from("profiles").upsert({ id: entry.id, role, full_name: fullName }), "profile");
  return entry.id;
}

const year = new Date().getFullYear();
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();

async function main() {
  // Verwaltung (Super-Admin)
  const adminId = await user("ek-admin@example.invalid", "Ayhan Admin", "admin");
  await db.from("staff_profiles").upsert({ id: adminId, display_name: "Coach Ayhan", active: true });
  await db.from("platform_permissions").upsert({ user_id: adminId, permission: "manage_features" }, { onConflict: "user_id,permission" });
  must(await db.from("platform_features").update({ enabled: true }).eq("key", "elternkabine"), "feature");

  // Regionen
  const regions = [];
  for (const name of ["Region Nord", "Region Mitte", "Region Süd"]) {
    const found = must(await db.from("locations").select("id").eq("name", name).maybeSingle(), "loc");
    const row = found ?? must(await db.from("locations").insert({ name, address: `${name}, Teststraße 1`, is_region: true }).select("id").single(), "loc insert");
    await db.from("locations").update({ is_region: true }).eq("id", row.id);
    regions.push(row.id);
  }
  must(await db.rpc("community_sync_channels"), "sync");
  const camps = must(await db.from("camps").select("id").limit(2), "camps");

  const types = [
    ...Array(40).fill(["FirstTouch", 25]),
    ...Array(30).fill(["GameChanger", 25]),
    ...Array(20).fill(["Pro-Player", 25]),
    ...Array(10).fill(["FirstTouch", -5]), // Abo vor 5 Tagen beendet → Lesefrist
    ...Array(10).fill(["trial", 0]),
    ...Array(10).fill(["camp", 0]),
  ];
  const members = [];
  for (let i = 0; i < types.length; i++) {
    const [plan, ends] = types[i];
    const n = String(i + 1).padStart(3, "0");
    const first = pick(FIRST), last = pick(LAST), fullName = `${first} ${last}`;
    const email = `ek-familie-${n}@example.invalid`;
    const uid = await user(email, fullName);
    let parent = must(await db.from("parents").select("id").eq("auth_user_id", uid).maybeSingle(), "parent");
    if (!parent)
      parent = must(await db.from("parents").insert({ auth_user_id: uid, full_name: fullName, contact_email: email }).select("id").single(), "parent insert");
    const kids = must(await db.from("parent_players").select("player_id").eq("parent_id", parent.id), "kids");
    let kidId = kids[0]?.player_id;
    if (!kidId) {
      const kid = must(await db.from("players").insert({ first_name: pick(KIDS), last_name: last, birth_year: year - 4 - Math.floor(rnd() * 12) }).select("id").single(), "kid");
      kidId = kid.id;
      must(await db.from("parent_players").insert({ parent_id: parent.id, player_id: kidId }), "link");
      if (["FirstTouch", "GameChanger", "Pro-Player"].includes(plan)) {
        const sub = must(await db.from("subscriptions").insert({ parent_id: parent.id, stripe_customer_id: `cus_ek_${n}`, stripe_subscription_id: `sub_ek_${n}`, status: ends > 0 ? "active" : "canceled" }).select("id").single(), "sub");
        must(await db.from("entitlement_periods").insert({ player_id: kidId, subscription_id: sub.id, stripe_customer_id: `cus_ek_${n}`, stripe_item_id: `si_ek_${n}`, stripe_price_id: `price_ek_${plan}`, product_name: plan, starts_at: iso(ends - 30), ends_at: iso(ends), included_units: plan === "FirstTouch" ? 4 : 8 }), "period");
      } else if (plan === "trial") {
        await db.from("trial_families").insert({ id: crypto.randomUUID(), parent_id: parent.id, request_input: {}, parent_name: fullName, email, phone: "0", operational_consent: true, privacy_acknowledged: true });
      } else if (plan === "camp" && camps.length) {
        // Camp-Buchungen brauchen eine echte Camp-Konfiguration; nur wenn ein lokales Camp existiert.
        const offer = must(await db.from("camp_offers").select("id").eq("camp_id", camps[0].id).limit(1), "offer")[0];
        if (offer)
          await db.from("camp_bookings").insert({ id: crypto.randomUUID(), camp_id: camps[0].id, offer_id: offer.id, parent_id: parent.id, player_id: kidId, browser_token_hash: "ek", parent_data: {}, child_data: {}, status: "paid" });
      }
    }
    const joined = i % 5 !== 4; // 80 % sind beigetreten
    must(await db.from("community_families").upsert({ parent_id: parent.id, enabled: joined, consent_privacy_at: joined ? iso(-10) : null, consent_photos_at: i % 3 === 0 ? iso(-10) : null, consent_version: "2026-11-19", region_id: i % 2 ? regions[i % 3] : null }), "family");
    must(await db.from("community_members").upsert({ user_id: uid, name_style: ["first_initial", "full", "initials"][i % 3] }), "member");
    if (joined) members.push({ uid, plan, parentId: parent.id });

    // Jede vierte Familie hat einen zweiten Elternteil
    if (i % 4 === 0) {
      const coMail = `ek-zweit-${n}@example.invalid`;
      const coFirst = pick(FIRST);
      const coId = await user(coMail, `${coFirst} ${last}`);
      const open = must(await db.from("parent_co_accounts").select("id").eq("parent_id", parent.id).in("status", ["invited", "active"]).maybeSingle(), "co");
      if (!open)
        must(await db.from("parent_co_accounts").insert({ parent_id: parent.id, email: coMail, first_name: coFirst, auth_user_id: coId, status: "active", accepted_at: iso(-3), invite_sent_at: iso(-4), invite_count: 1 }), "co insert");
      accounts[coMail].co_parent_of = email;
    }
  }

  // Beiträge: Grundkanäle eröffnen (GameChanger und U13–U16 bleiben Entwürfe)
  const channels = must(await db.from("community_channels").select("id,title,kind,plan_name,published_at"), "channels");
  const { count: existing } = await db.from("community_posts").select("id", { count: "exact", head: true });
  if (!existing) {
    const texts = {
      question: ["Hat jemand Hallenschuhe in Größe 33 übrig?", "Wie lange dauert das Training im Winter?", "Gibt es eine Fundkiste in der Halle?", "Ab welchem Alter lohnt sich Pro-Player?", "Darf man beim Training zuschauen?"],
      tip: ["Bei Kälte unbedingt Handschuhe einpacken, die Kleinen frieren schnell.", "Ein Turnbeutel mit Namen spart viel Suchen.", "Nach dem Training eine Banane, wirkt Wunder."],
      ride: ["Fahre dienstags von Nord zum Training, 2 Plätze frei.", "Suche Mitfahrgelegenheit donnerstags, wir zahlen gern Spritgeld."],
      swap: ["Trikot Größe 128 zu verschenken.", "Tausche Schienbeinschoner S gegen M."],
      text: ["Danke an alle für das tolle Turnier am Wochenende!", "Unser Sohn ist total begeistert vom neuen Coach.", "Freut mich, dass es die Elternkabine jetzt gibt."],
    };
    for (const c of channels) {
      if (c.title === "GameChanger-Eltern" || c.title === "U13–U16") continue;
      must(await db.from("community_posts").insert({ channel_id: c.id, author_id: adminId, author_team: true, kind: "info", pinned: true, body: `Willkommen in „${c.title}“! Hier tauscht ihr euch aus, stellt Fragen und helft euch gegenseitig. Bitte bleibt freundlich und postet keine Fotos fremder Kinder.`, created_at: iso(-9) }), "welcome");
      await db.from("community_channels").update({ published_at: iso(-9) }).eq("id", c.id);
      const pool = members.filter((m) =>
        c.kind === "plan" ? m.plan === c.plan_name : c.kind === "trial" ? m.plan === "trial" : ["general", "region", "age"].includes(c.kind) ? !["trial", "camp"].includes(m.plan) : false,
      );
      if (!pool.length) continue;
      const count = c.kind === "general" ? 18 : c.kind === "plan" ? 8 : c.kind === "trial" ? 3 : 4;
      for (let k = 0; k < count; k++) {
        const m = pick(pool);
        const kind = c.kind === "trial" ? "question" : pick(["question", "tip", "ride", "swap", "text", "text"]);
        const at = iso(-8 + k * (7 / count));
        const post = must(await db.from("community_posts").insert({ channel_id: c.id, author_id: m.uid, author_parent_id: m.parentId, kind, body: pick(texts[kind]), created_at: at }).select("id").single(), "post");
        if (k % 3 === 0 && c.kind !== "trial") {
          const r = pick(pool);
          await db.from("community_posts").insert({ channel_id: c.id, author_id: r.uid, author_parent_id: r.parentId, reply_to: post.id, body: "Gute Frage, das würde mich auch interessieren!", created_at: iso(-7 + k * (7 / count)) });
        }
        for (const emoji of ["👍", "❤️", "⚽"].slice(0, k % 4))
          await db.from("community_reactions").insert({ post_id: post.id, user_id: pick(pool).uid, emoji });
      }
    }
    // Zwei Meldungen für die Glocke
    const general = channels.find((c) => c.kind === "general");
    const bad = must(await db.from("community_posts").insert({ channel_id: general.id, author_id: members[3].uid, author_parent_id: members[3].parentId, body: "Wer Privattraining sucht, meldet euch bei mir, günstiger als hier.", created_at: iso(-1) }).select("id").single(), "bad");
    for (const m of members.slice(10, 12))
      await db.from("community_reports").insert({ post_id: bad.id, reporter_id: m.uid, reason: "ads" });
  }
  writeFileSync(accountsFile, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  console.log(`Fertig: ${Object.keys(accounts).length} Konten, Zugänge in ${accountsFile}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
