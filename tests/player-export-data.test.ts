import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), history: vi.fn() }));
vi.mock("../src/lib/server/service-db", () => ({ serviceDb: () => ({}) }));
vi.mock("../src/lib/server/read-all", () => ({ readAll: mocks.read }));
vi.mock("../src/lib/server/profile-subscription-history", () => ({
  profileActivePeriods: mocks.history,
}));
import { loadPlayerExport } from "../src/lib/server/player-export";
beforeEach(() => {
  vi.resetAllMocks();
  process.env.APP_URL = "https://portal.example.com";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T12:00Z"));
});
import { afterEach } from "vitest";
afterEach(() => vi.useRealTimers());
it("exports archived and orphaned children, optional fields, multiple parents and simultaneous current plans", async () => {
  const tables: Record<string, any[]> = {
    players: [
      {
        id: "a",
        first_name: "Archiv",
        last_name: "Kind",
        archived_at: "2025-01-01",
        birth_year: 2015,
        gender: "divers",
        club: "FC",
        position: "Tor",
        strong_foot: "links",
        height_cm: 140,
        development_goals: "Passen",
        private_note: "PRIVATE",
      },
      { id: "b", first_name: "Ohne", last_name: "Abo" },
    ],
    parents: [
      { id: "p1", full_name: "Eltern Eins" },
      { id: "p2", full_name: "Eltern Zwei" },
    ],
    parent_players: [
      { player_id: "a", parent_id: "p1" },
      { player_id: "a", parent_id: "p2" },
    ],
    subscription_players: [],
    entitlement_periods: [
      {
        player_id: "a",
        product_name: "Gruppe",
        starts_at: "2026-10-01T00:00Z",
        ends_at: "2026-11-01T00:00Z",
        status: "active",
      },
      {
        player_id: "a",
        product_name: "Einzel",
        starts_at: "2026-10-02T00:00Z",
        ends_at: "2026-11-02T00:00Z",
        status: "active",
      },
      {
        player_id: "a",
        product_name: "Zukunft",
        starts_at: "2027-10-01T00:00Z",
        ends_at: "2027-11-01T00:00Z",
        status: "active",
      },
    ],
  };
  mocks.read.mockImplementation((_db, table) => Promise.resolve(tables[table]));
  mocks.history.mockImplementation((_subs, periods) =>
    Promise.resolve(periods),
  );
  const data = await loadPlayerExport();
  expect(data).toHaveLength(2);
  expect(data[0]).toMatchObject({
    spielername: "Archiv Kind",
    archiviert: true,
    elternteile: ["Eltern Eins", "Eltern Zwei"],
    fuss: "links",
    groesse_cm: 140,
    entwicklungsziele: "Passen",
    aktive_monate: 1,
    profil_link: "https://portal.example.com/admin/spieler/a",
  });
  expect(data[0].abos.map((a) => a.art)).toEqual(["Gruppe", "Einzel"]);
  expect(data[1]).toMatchObject({
    elternteile: [],
    abos: [],
    aktive_monate: 0,
    fuss: null,
    groesse_cm: null,
  });
  expect(JSON.stringify(data)).not.toContain("PRIVATE");
  tables.players[0].development_goals = "Neue Ziele";
  expect((await loadPlayerExport())[0].entwicklungsziele).toBe("Neue Ziele");
  expect(await loadPlayerExport("b")).toHaveLength(1);
});
