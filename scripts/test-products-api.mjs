import { request } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const root = "output/product-management-local",
  env = Object.fromEntries(
    readFileSync(`${root}/app/.env.local`, "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
if (env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:57321")
  throw Error("Independent local stack required");
const db = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ),
  api = await request.newContext({ baseURL: "http://127.0.0.1:3110" }),
  ids = [];
const check = (r) => {
  if (r.error) throw r.error;
  return r.data;
};
await api.post("/lokaler-test/session", {
  headers: { origin: "http://127.0.0.1:3110" },
  form: { key: "admin" },
});
try {
  const open = {
    mode: "all",
    clauses: [{ scope: "player", mode: "any", include: ["all"], exclude: [] }],
  };
  const fixture = Array.from({ length: 1105 }, (_, i) => {
    const id = randomUUID();
    ids.push(id);
    const data = {
      name: `Paginationpruefung ${i}`,
      internal_name: "",
      description: "",
      short_description: "",
      category: "Paginationpruefung",
      kind: "other",
      status: "draft",
      sort_order: 5000,
      featured: false,
      publish_at: null,
      expires_at: null,
      channels: [],
      price: null,
      plan_id: null,
      camp_offer_id: null,
      repeatable: false,
      rules: { visibility: open, purchase: open, usage: open },
      asset_ids: [],
    };
    return {
      id,
      name: data.name,
      category: data.category,
      kind: data.kind,
      draft: data,
      status: "draft",
      sort_order: 5000,
    };
  });
  for (let i = 0; i < fixture.length; i += 200)
    check(await db.from("catalog_products").insert(fixture.slice(i, i + 200)));
  let cursor = null,
    pages = 0;
  const seen = new Set();
  do {
    const q = new URLSearchParams({ q: "Paginationpruefung" });
    if (cursor) q.set("cursor", cursor);
    const r = await api.get(`/api/admin/products?${q}`);
    if (!r.ok()) throw Error(await r.text());
    const v = await r.json();
    for (const p of v.rows) {
      if (seen.has(p.id)) throw Error("Duplicate cursor result");
      seen.add(p.id);
    }
    cursor = v.next;
    pages++;
  } while (cursor);
  if (seen.size !== 1105) throw Error(`Only ${seen.size} products reachable`);
  const image = check(
    await db.from("catalog_product_assets").select("id").limit(1),
  )[0];
  const anon = await request.newContext({ baseURL: "http://127.0.0.1:3110" });
  if (image) {
    const r = await anon.get(`/api/products/image/${image.id}`);
    if (r.status() !== 404) throw Error("Internal image exposed to visitor");
  }
  const blocked = await anon.post(
    "/api/products/00000000-0000-4000-8000-000000000001/checkout",
    { headers: { origin: "http://127.0.0.1:3110" }, data: {} },
  );
  if (![400, 503].includes(blocked.status()))
    throw Error("Malformed guest checkout was not rejected");
  const parent = await request.newContext({ baseURL: "http://127.0.0.1:3110" });
  await parent.post("/lokaler-test/session", {
    headers: { origin: "http://127.0.0.1:3110" },
    form: { key: "foreign" },
  });
  const body = await parent.get("/api/products?channel=admin");
  if (!body.ok() || (await body.json()).rows.length)
    throw Error("Parent can query admin-only product channel");
  const newOnlyId = randomUUID();
  ids.push(newOnlyId);
  const special = {
    ...fixture[0].draft,
    name: "Neukindpruefung",
    status: "active",
    channels: ["catalog"],
    rules: {
      visibility: {
        mode: "all",
        clauses: [
          { scope: "player", mode: "any", include: ["new"], exclude: [] },
        ],
      },
      purchase: open,
      usage: open,
    },
  };
  check(
    await db.from("catalog_products").insert({
      id: newOnlyId,
      name: special.name,
      category: special.category,
      kind: special.kind,
      status: "active",
      draft: special,
      published: special,
      published_revision: 1,
    }),
  );
  const mixed = await request.newContext({ baseURL: "http://127.0.0.1:3110" });
  await mixed.post("/lokaler-test/session", {
    headers: { origin: "http://127.0.0.1:3110" },
    form: { key: "mixed" },
  });
  const existing = await (
    await mixed.get("/api/products?q=Neukindpruefung")
  ).json();
  const additional = await (
    await mixed.get("/api/products?q=Neukindpruefung&new_child=true")
  ).json();
  if (
    existing.rows.length ||
    !additional.rows.some((p) => p.id === newOnlyId) ||
    additional.context.children.length !== existing.context.children.length
  )
    throw Error(
      "New-child visibility is evaluated against existing siblings or loses their identities",
    );
  await mixed.dispose();
  await anon.dispose();
  await parent.dispose();
  mkdirSync("output/products-review", { recursive: true });
  writeFileSync(
    "output/products-review/api-results.json",
    JSON.stringify({
      passed: true,
      products: seen.size,
      pages,
      checks: [
        "server search and complete keyset pagination",
        "private images",
        "malformed guest checkout rejected",
        "admin channel denied",
      ],
    }),
  );
  console.log(
    `Product API passed: ${seen.size} products across ${pages} pages, private assets and access guards.`,
  );
} finally {
  for (let i = 0; i < ids.length; i += 200)
    check(
      await db
        .from("catalog_products")
        .delete()
        .in("id", ids.slice(i, i + 200)),
    );
  await api.dispose();
}
