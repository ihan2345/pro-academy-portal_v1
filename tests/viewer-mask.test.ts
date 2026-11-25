import { it, expect, vi, beforeAll } from "vitest";

const tables: Record<string, Record<string, unknown>[]> = {
  players: [
    { id: "p1", first_name: "Max", last_name: "Krüger", birth_year: 2015 },
    { id: "p2", first_name: "Lea", last_name: "Sommer", birth_year: 2017 },
  ],
  trial_players: [],
  parents: [{ id: "e1", full_name: "Sabine Krüger" }],
  staff_profiles: [{ display_name: "Coach Ayhan" }],
  profiles: [{ full_name: "Kaan Admin", role: "admin" }],
};
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: (t: string) => {
      const result = Promise.resolve({ data: tables[t] ?? [], error: null });
      const chain: any = {
        select: () => chain,
        neq: () => chain,
        then: result.then.bind(result),
      };
      return chain;
    },
  }),
}));
import {
  maskForViewer,
  readOnlyDb,
  pseudonym,
  initials,
  tag,
} from "../src/lib/server/viewer";

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x".repeat(40);
});

it("kürzt Namen auf Initialen, Jahrgang und gleichbleibende Kennung", async () => {
  expect(initials("Anna-Lena von Müller")).toBe("A. M.");
  const viewer = { clearNames: false };
  const out = await maskForViewer(viewer, {
    email: "berater@test.invalid",
    user_name: "Berater",
    players: [
      {
        id: "p1",
        first_name: "Max",
        last_name: "Krüger",
        birth_year: 2015,
        birth_date: "2015-03-12",
      },
    ],
    parent: {
      id: "e1",
      full_name: "Sabine Krüger",
      contact_email: "sabine@example.com",
      phone: "0171 1234567",
      address: "Musterweg 1",
      stripe_customer_id: "cus_ABCDEF123456",
    },
    activity:
      "Max Krüger wurde von Coach Ayhan eingetragen (Sabine Krüger, sabine@example.com)",
    note: "Allergie gegen Nüsse",
    trainer_name: "Coach Ayhan",
    location: { name: "Sportpark Nord", address: "Am Platz 3" },
    child_data: { name: "Unbekannt Neu", birth_date: "2016-01-02" },
  });
  const maxTag = `#${tag("p1")}`;
  expect(out.email).toBe("berater@test.invalid");
  expect(out.players[0]).toEqual({
    id: "p1",
    first_name: "M.",
    last_name: `K. · ${maxTag}`,
    birth_year: 2015,
    birth_date: "2015",
  });
  expect(out.parent.full_name).toBe(pseudonym("Sabine Krüger", "e1"));
  expect(out.parent.contact_email).toBe("");
  expect(out.parent.phone).toBe("");
  expect(out.parent.address).toBe("");
  expect(out.parent.stripe_customer_id).toMatch(/^cus_[0-9A-F]{6}$/);
  expect(out.activity).toBe(
    `M. K. · 2015 · ${maxTag} wurde von Coach Ayhan eingetragen (${pseudonym("Sabine Krüger", "e1")}, •••@•••)`,
  );
  expect(out.note).toBe("");
  expect(out.trainer_name).toBe("Coach Ayhan");
  expect(out.location).toEqual({
    name: "Sportpark Nord",
    address: "Am Platz 3",
  });
  expect(out.child_data.name).toMatch(/^U\. N\. · #[0-9A-F]{3}$/);
  expect(out.child_data.birth_date).toBe("2016");
  expect(JSON.stringify(out)).not.toMatch(/Krüger|Sabine|Nüsse/);
});

it("zeigt mit Klarnamen-Schalter alles unverändert", async () => {
  const data = {
    players: [{ id: "p1", first_name: "Max", last_name: "Krüger" }],
  };
  expect(await maskForViewer({ clearNames: true }, data)).toBe(data);
  expect(await maskForViewer(undefined, data)).toBe(data);
});

it("schreibgeschützter Zugang lehnt Schreiben und unbekannte RPCs ab", async () => {
  const calls: string[] = [];
  const builder = {
    select: () => (calls.push("select"), builder),
    insert: () => (calls.push("insert"), builder),
  };
  const raw: any = {
    from: () => builder,
    rpc: (name: string) => (
      calls.push(`rpc:${name}`),
      Promise.resolve({ data: 1, error: null })
    ),
  };
  const db: any = readOnlyDb(raw, {} as never);
  db.from("players").select("*");
  const insert = await db.from("players").insert({}).select().single();
  expect(insert.error.code).toBe("42501");
  expect((await db.rpc("save_training", {})).error.code).toBe("42501");
  expect((await db.rpc("camp_occupied_seats", {})).data).toBe(1);
  expect(calls).toEqual(["select", "rpc:camp_occupied_seats"]);
});
